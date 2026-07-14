import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import DeckGL from '@deck.gl/react';
import {OrthographicView, type PickingInfo} from '@deck.gl/core';
import {PathLayer, PolygonLayer, ScatterplotLayer, TextLayer} from '@deck.gl/layers';

import {
  AC,
  DEG,
  R_P,
  facePentagon,
  fold,
  icoCorner,
  invTransfer,
  pentCorner,
  polar,
  transfer,
  unfold,
  type Pt,
} from './transfer';
import {buildGrid, sphereCellCount, type Cell} from './grid';

const MAX_RES = 5;
// Which icosa face (wedge [60k°, 60(k+1)°]) the "highlight one face" option
// emphasises. Face 1 sits at the top of the fan, well away from the seam.
const HIGHLIGHT_FACE = 1;

// Display transforms: the icosa fan (edge length 1) is scaled so both
// diagrams are the same size. On wide screens the diagrams sit side by
// side; on portrait screens they stack vertically.
const S = R_P / AC;

interface Layout {
  ico: Pt;
  pent: Pt;
}

const icoDispAt =
  (l: Layout) =>
    (p: Pt): Pt => [p[0] * S + l.ico[0], p[1] * S + l.ico[1]];
const pentDispAt =
  (l: Layout) =>
    (q: Pt): Pt => [q[0] + l.pent[0], q[1] + l.pent[1]];

const WHITE_RGBA: [number, number, number, number] = [255, 255, 255, 255];
const INK: [number, number, number] = [25, 25, 25];
const PENT_FILL: [number, number, number, number] = [242, 122, 80, 170];
const HEX_FILL: [number, number, number, number] = [0, 0, 0, 8];
const FRAGMENT_FILL: [number, number, number, number] = [90, 110, 140, 45];
const INK_FAINT: [number, number, number, number] = [25, 25, 25, 36];
const PENT_FILL_FAINT: [number, number, number, number] = [242, 122, 80, 40];
const HEX_FILL_FAINT: [number, number, number, number] = [0, 0, 0, 3];
const FRAGMENT_FILL_FAINT: [number, number, number, number] = [90, 110, 140, 12];
const KITE_WASH: [number, number, number, number] = [70, 120, 200, 24];
const PARENT_LINE: [number, number, number, number] = [205, 45, 45, 230];
const SECTOR_LINE: [number, number, number, number] = [70, 120, 200, 110];
const GAP_FILL: [number, number, number, number] = [205, 45, 45, 16];
const HIGHLIGHT_FILL: [number, number, number, number] = [255, 193, 61, 150];
const DOT_FILL: [number, number, number, number] = [200, 30, 30, 255];
const LABEL_COLOR: [number, number, number, number] = [110, 110, 110, 255];

const INITIAL_VIEW_STATE = {target: [0, 0, 0] as [number, number, number], zoom: -0.35};

// flipY: false keeps math-convention y-up, so the counter-clockwise vertex
// order actually renders counter-clockwise on screen.
const VIEW = new OrthographicView({
  id: 'ortho',
  clear: true,
  clearColor: WHITE_RGBA,
  flipY: false,
});

const closed = (poly: Pt[]): Pt[] => [...poly, poly[0]];

interface DisplayCell {
  cell: Cell;
  pent: Pt[];
  ico: Pt[];
  // Piece of the cell on the highlighted icosa face, display coords.
  hi?: Pt[];
}

interface Hover {
  index: number;
  pentPt: Pt;
  icoPt: Pt;
}

const toDisplay = (cells: Cell[], t: number, layout: Layout): DisplayCell[] => {
  const icoDisp = icoDispAt(layout);
  const pentDisp = pentDispAt(layout);
  const icoFold = (p: Pt) => icoDisp(fold(p, t));
  return cells.map((cell) => ({
    cell,
    pent: cell.polygon.map(pentDisp),
    // At t=1 the fold equals the transfer, so the central cell's seam-split
    // "pac-man" would close with a zero-width stroke along the vanished cut;
    // swap in its seamless pentagon-space boundary instead.
    ico:
      t === 1 && cell.kind === 'pentagon'
        ? cell.polygon.map((q): Pt => [q[0] + layout.ico[0], q[1] + layout.ico[1]])
        : cell.icosaPolygon.map(icoFold),
    hi:
      cell.highlightIcosa && cell.highlightIcosa.length >= 3
        ? cell.highlightIcosa.map(icoFold)
        : undefined,
  }));
};

// easeInOutCubic
const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

const App: React.FC = () => {
  const [resolution, setResolution] = useState(1);
  const [clip, setClip] = useState(true);
  const [extendFaces, setExtendFaces] = useState(false);
  const [foldIco, setFoldIco] = useState(false);
  const [foldT, setFoldT] = useState(0);
  const [showParent, setShowParent] = useState(false);
  const [showSectors, setShowSectors] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);

  // Portrait viewports stack the diagrams vertically.
  const [viewport, setViewport] = useState<[number, number]>(() => [
    window.innerWidth,
    window.innerHeight,
  ]);
  useEffect(() => {
    const onResize = () => setViewport([window.innerWidth, window.innerHeight]);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const stacked = viewport[0] < viewport[1];

  const layout = useMemo<Layout>(() => {
    if (!stacked) return {ico: [-440, 0], pent: [370, 0]};
    return extendFaces ? {ico: [0, 340], pent: [0, -410]} : {ico: [0, 330], pent: [0, -295]};
  }, [stacked, extendFaces]);

  // Fit the stacked layout to the screen below the control panel; the
  // side-by-side zoom matches the original design. Applied via the DeckGL
  // key, which remounts the view when the orientation flips.
  const initialViewState = useMemo(() => {
    if (!stacked) return INITIAL_VIEW_STATE;
    const panelPx = 280;
    const halfX = extendFaces ? 470 : 320;
    const halfY = extendFaces ? 760 : 650;
    const availH = Math.max(300, viewport[1] - panelPx);
    const zoom = Math.min(
      Math.log2(viewport[0] / (2.15 * halfX)),
      Math.log2(availH / (2.05 * halfY)),
    );
    // Centre the diagrams in the area below the panel: the world point at the
    // viewport centre sits half the panel height above the content centre.
    const target: [number, number, number] = [0, panelPx / 2 / 2 ** zoom, 0];
    return {target, zoom};
  }, [stacked, extendFaces, viewport]);

  // Animate foldT toward the checkbox target.
  const foldTRef = useRef(foldT);
  foldTRef.current = foldT;
  useEffect(() => {
    const from = foldTRef.current;
    const target = foldIco ? 1 : 0;
    if (from === target) return;
    const duration = Math.max(250, 1100 * Math.abs(target - from));
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const u = Math.min(1, (now - start) / duration);
      setFoldT(u === 1 ? target : from + (target - from) * ease(u));
      if (u < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [foldIco]);

  const faceHighlightOn = extendFaces;
  const cells = useMemo(
    () =>
      buildGrid(resolution, {
        clipToFace: clip,
        extendFaces,
        highlightFace: faceHighlightOn ? HIGHLIGHT_FACE : undefined,
      }),
    [resolution, clip, extendFaces, faceHighlightOn],
  );
  const grid = useMemo(() => toDisplay(cells, foldT, layout), [cells, foldT, layout]);
  const parentCells = useMemo(
    () => (showParent && resolution > 0 ? buildGrid(resolution - 1, {extendFaces}) : null),
    [showParent, resolution, extendFaces],
  );
  const parentGrid = useMemo(
    () => (parentCells ? toDisplay(parentCells, foldT, layout) : null),
    [parentCells, foldT, layout],
  );

  const geom = useMemo(() => {
    const t = foldT;
    const icoDisp = icoDispAt(layout);
    const pentDisp = pentDispAt(layout);
    const f = (p: Pt) => icoDisp(fold(p, t));
    const A = icoDisp([0, 0]);
    const face = closed(facePentagon().map(pentDisp));

    // Fan outline, split into the outer boundary and the two seam edges (the
    // cut faces) so the cut can fade out as the fold closes. Every boundary
    // corner is included: interior ones are collinear at t = 0 and t = 1 but
    // bend slightly mid-fold.
    const fanCorners: Pt[] = [];
    for (let b = 0; b <= 10; b++) fanCorners.push(f(icoCorner(b)));
    const seamWidth = extendFaces ? 1.2 : 2.5;
    const seams = [
      {path: [A, fanCorners[0]], width: seamWidth},
      {path: [fanCorners[10], A], width: seamWidth},
    ];

    // Full-face fan: far corners B_k plus the chord midpoints (collinear at
    // t = 0, becoming the decagon's odd-ray corners at t = 1).
    const faceFanOuter: Pt[] = [];
    for (let k = 0; k < 5; k++) {
      faceFanOuter.push(f(polar(k * 60 * DEG, 1)));
      faceFanOuter.push(f(polar((k * 60 + 30) * DEG, Math.cos(30 * DEG))));
    }
    faceFanOuter.push(f(polar(300 * DEG, 1)));
    if (extendFaces) {
      seams.push({path: [A, faceFanOuter[0]], width: 2.5});
      seams.push({path: [faceFanOuter[10], A], width: 2.5});
    }

    // Icosa edges radiating from the vertex, when full faces are shown.
    const faceEdges: Pt[][] = [];
    for (let k = 1; k <= 4; k++) faceEdges.push([A, f(polar(k * 60 * DEG, 1))]);

    // The shrinking gap wedge, built directly in folded coordinates.
    const gapStart = 300 + 60 * t;
    const half = ((360 - gapStart) / 2) * DEG;
    const apothem = AC * Math.cos(36 * DEG);
    const d1 = extendFaces ? 1 + t * (2 * apothem - 1) : 0.5 + t * (apothem - 0.5);
    const dMid = extendFaces ? d1 * Math.cos(half) : d1 / Math.cos(half);
    const gap = [
      [0, 0] as Pt,
      polar(gapStart * DEG, d1),
      polar(gapStart * DEG + half, dMid),
      polar(360 * DEG, d1),
    ].map(icoDisp);

    const rays: Pt[][] = [];
    for (let b = 0; b < 10; b++) {
      rays.push([pentDisp([0, 0]), pentDisp(pentCorner(b))]);
      rays.push([A, f(icoCorner(b))]);
    }

    // The highlighted face triangle and, in the pentagon view, the kite fifth
    // that its near-vertex portion covers (between rays 72k° and 72(k+1)°).
    const hlTriangle = closed(
      [
        [0, 0] as Pt,
        polar(HIGHLIGHT_FACE * 60 * DEG, 1),
        polar((HIGHLIGHT_FACE * 60 + 30) * DEG, Math.cos(30 * DEG)),
        polar((HIGHLIGHT_FACE + 1) * 60 * DEG, 1),
      ].map(f),
    );
    const hlKite = [
      [0, 0] as Pt,
      pentCorner(2 * HIGHLIGHT_FACE),
      pentCorner(2 * HIGHLIGHT_FACE + 1),
      pentCorner(2 * HIGHLIGHT_FACE + 2),
    ].map(pentDisp);
    return {face, fanOuter: fanCorners, seams, faceFanOuter, faceEdges, gap, rays, hlTriangle, hlKite};
  }, [foldT, extendFaces, layout]);

  const icoLabelY = layout.ico[1] - (extendFaces ? 430 : 285);
  const labels = [
    {pos: [layout.ico[0], icoLabelY] as Pt, text: 'Icosahedron, unfolded at a vertex'},
    {
      pos: [layout.pent[0], stacked ? layout.pent[1] - 285 : icoLabelY] as Pt,
      text: 'Dodecahedron face',
    },
  ];

  const handleHover = useCallback(
    (info: PickingInfo) => {
      const datum = info.object as DisplayCell | undefined;
      if (!info.coordinate || !datum || info.index == null || info.index < 0) {
        setHover(null);
        return;
      }
      const [wx, wy] = info.coordinate;
      if ((info.layer?.id ?? '').startsWith('ico')) {
        const p = unfold([(wx - layout.ico[0]) / S, (wy - layout.ico[1]) / S], foldT);
        setHover({index: info.index, icoPt: [wx, wy], pentPt: pentDispAt(layout)(transfer(p))});
      } else {
        const q: Pt = [wx - layout.pent[0], wy - layout.pent[1]];
        setHover({
          index: info.index,
          pentPt: [wx, wy],
          icoPt: icoDispAt(layout)(fold(invTransfer(q), foldT)),
        });
      }
    },
    [foldT, layout],
  );

  const hovered = hover ? grid[hover.index] : null;

  const cellLayerProps = {
    data: grid,
    getFillColor: (d: DisplayCell) =>
      d.cell.kind === 'pentagon' ? PENT_FILL : d.cell.centerInFace ? HEX_FILL : FRAGMENT_FILL,
    getLineColor: INK,
    filled: true,
    stroked: true,
    lineWidthUnits: 'pixels' as const,
    getLineWidth: 1,
    pickable: true,
  };
  // When one face is highlighted, the rest of the icosa pattern goes faint.
  const icoCellLayerProps = faceHighlightOn
    ? {
      ...cellLayerProps,
      getFillColor: (d: DisplayCell) =>
        d.cell.kind === 'pentagon'
          ? PENT_FILL_FAINT
          : d.cell.centerInFace
            ? HEX_FILL_FAINT
            : FRAGMENT_FILL_FAINT,
      getLineColor: INK_FAINT,
    }
    : cellLayerProps;

  const layers = [
    foldT < 1 &&
    new PolygonLayer<{poly: Pt[]}>({
      id: 'gap-wedge',
      data: [{poly: geom.gap}],
      getPolygon: (d) => d.poly,
      getFillColor: [GAP_FILL[0], GAP_FILL[1], GAP_FILL[2], Math.round(GAP_FILL[3] * (1 - foldT))],
      stroked: false,
    }),
    extendFaces &&
    new PathLayer({
      id: 'face-edges',
      data: geom.faceEdges,
      getPath: (d: Pt[]) => d,
      getColor: [25, 25, 25, 70] as [number, number, number, number],
      widthUnits: 'pixels',
      getWidth: 1,
    }),
    new PolygonLayer<DisplayCell>({
      id: 'ico-cells',
      getPolygon: (d) => d.ico,
      ...icoCellLayerProps,
    }),
    new PolygonLayer<DisplayCell>({
      id: 'pent-cells',
      getPolygon: (d) => d.pent,
      ...cellLayerProps,
    }),
    faceHighlightOn &&
    new PolygonLayer<DisplayCell>({
      id: 'ico-face-pieces',
      data: grid.filter((d) => d.hi),
      getPolygon: (d) => d.hi!,
      getFillColor: (d) =>
        d.cell.kind === 'pentagon' ? PENT_FILL : d.cell.centerInFace ? HEX_FILL : FRAGMENT_FILL,
      getLineColor: INK,
      filled: true,
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 1,
    }),
    faceHighlightOn &&
    new PolygonLayer<{poly: Pt[]}>({
      id: 'pent-kite-wash',
      data: [{poly: geom.hlKite}],
      getPolygon: (d) => d.poly,
      getFillColor: KITE_WASH,
      stroked: false,
    }),
    showSectors &&
    new PathLayer({
      id: 'sectors',
      data: geom.rays,
      getPath: (d: Pt[]) => d,
      getColor: SECTOR_LINE,
      widthUnits: 'pixels',
      getWidth: 1,
    }),
    parentGrid &&
    new PathLayer({
      id: 'parent-outline',
      data: parentGrid.flatMap((d) => [d.pent, d.ico]),
      getPath: (d: Pt[]) => closed(d),
      getColor: PARENT_LINE,
      widthUnits: 'pixels',
      getWidth: 2,
    }),
    hovered &&
    new PolygonLayer({
      id: 'highlight',
      data: [hovered.pent, hovered.ico],
      getPolygon: (d: Pt[]) => d,
      getFillColor: HIGHLIGHT_FILL,
      getLineColor: INK,
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 1.5,
      pickable: false,
    }),
    new PathLayer({
      id: 'outlines',
      data: [
        {path: geom.face, width: 2.5},
        {path: geom.fanOuter, width: extendFaces ? 1.2 : 2.5},
        ...(extendFaces ? [{path: geom.faceFanOuter, width: 2.5}] : []),
        ...(faceHighlightOn ? [{path: geom.hlTriangle, width: 3}] : []),
      ],
      getPath: (d: {path: Pt[]}) => d.path,
      getColor: INK,
      widthUnits: 'pixels',
      getWidth: (d: {width: number}) => d.width,
    }),
    foldT < 1 &&
    new PathLayer({
      id: 'seam-edges',
      data: geom.seams,
      getPath: (d: {path: Pt[]}) => d.path,
      getColor: [INK[0], INK[1], INK[2], Math.round(255 * (1 - foldT))] as [number, number, number, number],
      widthUnits: 'pixels',
      getWidth: (d: {width: number}) => d.width,
    }),
    hover &&
    new ScatterplotLayer({
      id: 'hover-dots',
      data: [hover.pentPt, hover.icoPt],
      getPosition: (d: Pt) => d,
      getFillColor: DOT_FILL,
      getLineColor: WHITE_RGBA,
      stroked: true,
      radiusUnits: 'pixels',
      getRadius: 5,
      lineWidthUnits: 'pixels',
      getLineWidth: 1.5,
    }),
    new TextLayer({
      id: 'labels',
      data: labels,
      getPosition: (d: {pos: Pt}) => d.pos,
      getText: (d: {text: string}) => d.text,
      getSize: 14,
      sizeUnits: 'pixels',
      getColor: LABEL_COLOR,
    }),
  ].filter(Boolean);

  const infoContent = (
    <>
      <div style={introStyle}>
        In hexagonal indexing systems (e.g. h3, igeo7) hexagons are laid out on the faces of an
        icosahedron, and described as <i>Icosahedral</i>.
      </div>

      <div style={introStyle}>
        It is geometrically equivalent to lay them out on the dual solid, the dodecahedron, leading to the same result on the sphere.
      </div>
      <div style={introStyle}>
        While the hexagons are skewed on the dodecahedron, it shows where the 12 pentagonal cells
        come from and why the total number of cells is divisible by 12. Thus, it is arguably more appropriate to describe such systems as <i>Dodecahedral</i>
      </div>
    </>
  );

  const optionsContent = (
    <>
      <label style={checkboxRowStyle}>
        <input
          type="checkbox"
          checked={clip}
          onChange={(e) => {
            setClip(e.target.checked);
            setHover(null);
          }}
        />
        Clip cells to face
      </label>
      <label style={checkboxRowStyle}>
        <input
          type="checkbox"
          checked={extendFaces}
          onChange={(e) => {
            setExtendFaces(e.target.checked);
            setHover(null);
          }}
        />
        Show icosahedron face
      </label>
      <label style={checkboxRowStyle}>
        <input
          type="checkbox"
          checked={foldIco}
          onChange={(e) => {
            setFoldIco(e.target.checked);
            setHover(null);
          }}
        />
        Fold into pentagon
      </label>
      <label style={checkboxRowStyle}>
        <input
          type="checkbox"
          checked={showParent}
          onChange={(e) => setShowParent(e.target.checked)}
          disabled={resolution === 0}
        />
        Show parent level (res {Math.max(0, resolution - 1)})
      </label>
      <label style={checkboxRowStyle}>
        <input
          type="checkbox"
          checked={showSectors}
          onChange={(e) => setShowSectors(e.target.checked)}
        />
        Show Schwarz sectors
      </label>
    </>
  );

  const hintContent = (
    <div style={hintStyle}>Hover either diagram to map a point through the barycentric transfer.</div>
  );

  return (
    <div style={{position: 'absolute', inset: 0}}>
      <DeckGL
        key={stacked ? 'stacked' : 'wide'}
        views={VIEW}
        initialViewState={initialViewState}
        controller={true}
        layers={layers}
        useDevicePixels={2}
        onHover={handleHover}
        getCursor={({isHovering}) => (isHovering ? 'crosshair' : 'grab')}
        style={{background: '#fff'}}
      />

      <div style={panelStyle}>
        <div style={titleStyle}>Hex grid on a dodecahedron face</div>
        <div style={sliderRowStyle}>
          <label style={sliderLabelStyle}>Resolution</label>
          <input
            type="range"
            min={0}
            max={MAX_RES}
            step={1}
            value={resolution}
            onChange={(e) => {
              setResolution(Number(e.target.value));
              setHover(null);
            }}
            style={{flex: 1}}
          />
          <span style={sliderValueStyle}>{resolution}</span>
        </div>
        <div style={metaStyle}>
          {resolution % 2 === 1 ? 'Class III — rotated 19.1°' : 'Class II — aligned'}
          {' · '}
          {sphereCellCount(resolution).toLocaleString()} cells on sphere (12 ×{' '}
          {(sphereCellCount(resolution) / 12).toLocaleString()})
        </div>
        {stacked ? (
          <>
            <button
              style={sectionHeaderStyle}
              onClick={() => setShowInfo((v) => !v)}
              aria-expanded={showInfo}
            >
              <span style={chevronStyle}>{showInfo ? '▾' : '▸'}</span> Info
            </button>
            {showInfo && (
              <>
                {infoContent}
                {hintContent}
              </>
            )}
            <button
              style={sectionHeaderStyle}
              onClick={() => setShowOptions((v) => !v)}
              aria-expanded={showOptions}
            >
              <span style={chevronStyle}>{showOptions ? '▾' : '▸'}</span> Options
            </button>
            {showOptions && optionsContent}
          </>
        ) : (
          <>
            {infoContent}
            {optionsContent}
            {hintContent}
          </>
        )}
      </div>
    </div>
  );
};

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 20,
  left: 20,
  width: 340,
  maxWidth: 'calc(100vw - 40px)',
  boxSizing: 'border-box',
  padding: 20,
  background: 'rgba(255,255,255,0.92)',
  border: '1px solid #e0e0e0',
  borderRadius: 12,
  color: '#222',
  boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const titleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#333',
};

const sectionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '2px 0',
  border: 'none',
  background: 'none',
  textAlign: 'left',
  fontSize: 12,
  fontWeight: 600,
  color: '#444',
  cursor: 'pointer',
};

const chevronStyle: React.CSSProperties = {
  width: 12,
  fontSize: 11,
  color: '#888',
};

const sliderRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const sliderLabelStyle: React.CSSProperties = {
  width: 66,
  fontSize: 12,
  color: '#555',
};

const sliderValueStyle: React.CSSProperties = {
  width: 16,
  fontSize: 12,
  color: '#333',
  textAlign: 'right',
};

const introStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#555',
  lineHeight: 1.5,
};

const metaStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#777',
};

const checkboxRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
  color: '#444',
};

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#999',
  lineHeight: 1.4,
};

export default App;
