import React, { useCallback, useMemo, useState } from 'react';
import DeckGL from '@deck.gl/react';
import { OrthographicView, type PickingInfo } from '@deck.gl/core';
import { PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';

import {
  AC,
  DEG,
  R_P,
  faceFanOutline,
  facePentagon,
  fanOutline,
  icoCorner,
  invTransfer,
  pentCorner,
  polar,
  transfer,
  type Pt,
} from './transfer';
import { buildGrid, type Cell } from './grid';

const MAX_RES = 5;
// Which icosa face (wedge [60k°, 60(k+1)°]) the "highlight one face" option
// emphasises. Face 1 sits at the top of the fan, well away from the seam.
const HIGHLIGHT_FACE = 1;

// Display transforms: the icosa fan (edge length 1) is scaled so both
// diagrams are the same size, and the two diagrams sit side by side.
const S = R_P / AC;
const ICO_C: Pt = [-370, 0];
const PENT_C: Pt = [310, 0];
const icoDisp = (p: Pt): Pt => [p[0] * S + ICO_C[0], p[1] * S + ICO_C[1]];
const pentDisp = (p: Pt): Pt => [p[0] + PENT_C[0], p[1] + PENT_C[1]];

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

const INITIAL_VIEW_STATE = { target: [0, 0, 0] as [number, number, number], zoom: -0.35 };

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

const toDisplay = (cells: Cell[]): DisplayCell[] =>
  cells.map((cell) => ({
    cell,
    pent: cell.polygon.map(pentDisp),
    ico: cell.icosaPolygon.map(icoDisp),
    hi: cell.highlightIcosa && cell.highlightIcosa.length >= 3
      ? cell.highlightIcosa.map(icoDisp)
      : undefined,
  }));

const App: React.FC = () => {
  const [resolution, setResolution] = useState(1);
  const [clip, setClip] = useState(true);
  const [extendFaces, setExtendFaces] = useState(false);
  const [showParent, setShowParent] = useState(false);
  const [showSectors, setShowSectors] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);

  const faceHighlightOn = extendFaces;
  const grid = useMemo(
    () =>
      toDisplay(
        buildGrid(resolution, {
          clipToFace: clip,
          extendFaces,
          highlightFace: faceHighlightOn ? HIGHLIGHT_FACE : undefined,
        }),
      ),
    [resolution, clip, extendFaces, faceHighlightOn],
  );
  const parentGrid = useMemo(
    () =>
      showParent && resolution > 0
        ? toDisplay(buildGrid(resolution - 1, { extendFaces }))
        : null,
    [showParent, resolution, extendFaces],
  );

  const staticGeometry = useMemo(() => {
    const face = closed(facePentagon().map(pentDisp));
    const fan = closed(fanOutline().map(icoDisp));
    const faceFan = closed(faceFanOutline().map(icoDisp));
    // The far edges of the five unfolded faces plus the icosa edges radiating
    // from the vertex — drawn when the view extends to full faces.
    const faceEdges: Pt[][] = [];
    for (let k = 1; k <= 4; k++) faceEdges.push([icoDisp([0, 0]), icoDisp(polar(k * 60 * DEG, 1))]);
    // The deleted 60° wedge between the two seam edges: kite-shaped to match
    // the fan outline, chord-bounded to match the full-face outline.
    const gap = [[0, 0] as Pt, polar(300 * DEG, 0.5), polar(330 * DEG, AC), polar(360 * DEG, 0.5)].map(icoDisp);
    const gapExtended = [[0, 0] as Pt, polar(300 * DEG, 1), polar(330 * DEG, Math.cos(30 * DEG)), polar(360 * DEG, 1)].map(icoDisp);
    const rays: Pt[][] = [];
    for (let b = 0; b < 10; b++) {
      rays.push([pentDisp([0, 0]), pentDisp(pentCorner(b))]);
      rays.push([icoDisp([0, 0]), icoDisp(icoCorner(b))]);
    }
    // The highlighted face triangle and, in the pentagon view, the kite fifth
    // that its near-vertex portion covers (between rays 72k° and 72(k+1)°).
    const hlTriangle = closed(
      [[0, 0] as Pt, polar(HIGHLIGHT_FACE * 60 * DEG, 1), polar((HIGHLIGHT_FACE + 1) * 60 * DEG, 1)].map(icoDisp),
    );
    const hlKite = [
      [0, 0] as Pt,
      pentCorner(2 * HIGHLIGHT_FACE),
      pentCorner(2 * HIGHLIGHT_FACE + 1),
      pentCorner(2 * HIGHLIGHT_FACE + 2),
    ].map(pentDisp);
    return { face, fan, faceFan, faceEdges, gap, gapExtended, rays, hlTriangle, hlKite };
  }, []);

  const labelY = extendFaces ? -430 : -285;
  const labels = [
    { pos: [ICO_C[0], labelY] as Pt, text: 'Icosahedron, unfolded at a vertex' },
    { pos: [PENT_C[0], labelY] as Pt, text: 'Dodecahedron face' },
  ];

  const handleHover = useCallback((info: PickingInfo) => {
    const datum = info.object as DisplayCell | undefined;
    if (!info.coordinate || !datum || info.index == null || info.index < 0) {
      setHover(null);
      return;
    }
    const [wx, wy] = info.coordinate;
    if ((info.layer?.id ?? '').startsWith('ico')) {
      const p: Pt = [(wx - ICO_C[0]) / S, (wy - ICO_C[1]) / S];
      setHover({ index: info.index, icoPt: [wx, wy], pentPt: pentDisp(transfer(p)) });
    } else {
      const q: Pt = [wx - PENT_C[0], wy - PENT_C[1]];
      setHover({ index: info.index, pentPt: [wx, wy], icoPt: icoDisp(invTransfer(q)) });
    }
  }, []);

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
    new PolygonLayer<{ poly: Pt[] }>({
      id: 'gap-wedge',
      data: [{ poly: extendFaces ? staticGeometry.gapExtended : staticGeometry.gap }],
      getPolygon: (d) => d.poly,
      getFillColor: GAP_FILL,
      stroked: false,
    }),
    extendFaces &&
      new PathLayer({
        id: 'face-edges',
        data: staticGeometry.faceEdges,
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
      new PolygonLayer<{ poly: Pt[] }>({
        id: 'pent-kite-wash',
        data: [{ poly: staticGeometry.hlKite }],
        getPolygon: (d) => d.poly,
        getFillColor: KITE_WASH,
        stroked: false,
      }),
    showSectors &&
      new PathLayer({
        id: 'sectors',
        data: staticGeometry.rays,
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
        { path: staticGeometry.face, width: 2.5 },
        { path: staticGeometry.fan, width: extendFaces ? 1.2 : 2.5 },
        ...(extendFaces ? [{ path: staticGeometry.faceFan, width: 2.5 }] : []),
        ...(faceHighlightOn ? [{ path: staticGeometry.hlTriangle, width: 3 }] : []),
      ],
      getPath: (d: { path: Pt[] }) => d.path,
      getColor: INK,
      widthUnits: 'pixels',
      getWidth: (d: { width: number }) => d.width,
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
      getPosition: (d: { pos: Pt }) => d.pos,
      getText: (d: { text: string }) => d.text,
      getSize: 14,
      sizeUnits: 'pixels',
      getColor: LABEL_COLOR,
    }),
  ].filter(Boolean);

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <DeckGL
        views={VIEW}
        initialViewState={INITIAL_VIEW_STATE}
        controller={true}
        layers={layers}
        useDevicePixels={2}
        onHover={handleHover}
        getCursor={({ isHovering }) => (isHovering ? 'crosshair' : 'grab')}
        style={{ background: '#fff' }}
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
            style={{ flex: 1 }}
          />
          <span style={sliderValueStyle}>{resolution}</span>
        </div>
        <div style={metaStyle}>
          {resolution % 2 === 1 ? 'Class III — rotated 19.1°' : 'Class II — aligned'}
          {' · '}
          {grid.length.toLocaleString()} cells
        </div>
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
        <div style={hintStyle}>Hover either diagram to map a point through the barycentric transfer.</div>
      </div>
    </div>
  );
};

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 20,
  left: 20,
  width: 280,
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
