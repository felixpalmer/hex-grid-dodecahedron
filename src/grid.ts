// Aperture-7 hex grid laid out on the dodecahedron face.
//
// Cells are generated as a plain hexagonal lattice in icosa space (where the
// grid is the familiar H3-style diagram: cell circumradius shrinks by 1/√7
// per level, odd levels rotated by ~19.1066°), then pushed through the
// piecewise-affine transfer onto the pentagon face. Only cells whose centre
// falls in the canonical 60° wedge are generated; the other four fifths are
// 72° rotations in pentagon space (valid because transfer∘rot60 = rot72∘transfer
// and every level's lattice is 6-fold symmetric about the origin).

import {
  AC,
  A_P,
  DEG,
  ICO_SECTOR,
  PENT_SECTOR,
  R_P,
  ROT,
  SQRT7,
  extendedClipDecagon,
  facePentagon,
  invTransfer,
  invTransferCanonical,
  pentSectorIndex,
  polar,
  sectorIndex,
  transfer,
  type Pt,
} from './transfer.ts';

export interface Cell {
  kind: 'pentagon' | 'hex';
  // Pentagon-space cell centre.
  center: Pt;
  // Pentagon-space boundary, counter-clockwise, implicitly closed. Empty for
  // cells that exist only in the extended (full icosa faces) region and have
  // no presence on this dodecahedron face.
  polygon: Pt[];
  // The same cell in icosa space (the unfolded fan around the icosahedron
  // vertex, edge length 1). Cells straddling the cone seam hang across the
  // open 60° wedge rather than being cut at it.
  icosaPolygon: Pt[];
  // Icosa-space cell centre.
  icosaCenter: Pt;
  // Whether the cell centre lies inside the face (false for the boundary
  // fragments of cells owned by neighbouring faces).
  centerInFace: boolean;
  // Whether the face boundary cut this cell's polygon.
  clipped: boolean;
  // Icosa-space piece of this cell lying on the highlighted face triangle
  // (only when GridOptions.highlightFace is set; empty if disjoint).
  highlightIcosa?: Pt[];
}

export interface GridOptions {
  // Cut cell polygons at the face boundary (default). When false, boundary
  // cells keep their full outline and overhang the face.
  clipToFace?: boolean;
  // Extend the icosa-space view from the pentagon's preimage (the Schwarz
  // kites near the vertex) to the five complete icosahedron faces. The grid
  // is the same lattice continued — for even (Class II) resolutions this
  // coincides with mirroring the Schwarz sectors; at odd (Class III)
  // resolutions the lattice keeps its 19.1° chirality across sector
  // boundaries, as a real aperture-7 system does. The pentagon-space view is
  // unaffected: cells outside the face get an empty `polygon`.
  extendFaces?: boolean;
  // Wedge index (0–4) of one icosahedron face — the triangle spanning icosa
  // angles [60k°, 60(k+1)°] — whose portion of each cell is reported in
  // `highlightIcosa`, for emphasising a single face in the display. Pieces
  // are clipped to the same region as the rest of the grid, so combine with
  // extendFaces to get the complete triangle.
  highlightFace?: number;
}

export const rotate = ([x, y]: Pt, angle: number): Pt => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x * c - y * s, x * s + y * c];
};

export function polygonArea(poly: Pt[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    sum += ax * by - bx * ay;
  }
  return sum / 2;
}

export function pointInConvex(p: Pt, poly: Pt[]): boolean {
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    if ((bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax) < 0) return false;
  }
  return true;
}

function intersect(p: Pt, q: Pt, a: Pt, b: Pt): Pt {
  const d1x = q[0] - p[0];
  const d1y = q[1] - p[1];
  const d2x = b[0] - a[0];
  const d2y = b[1] - a[1];
  const denom = d1x * d2y - d1y * d2x;
  const t = ((a[0] - p[0]) * d2y - (a[1] - p[1]) * d2x) / denom;
  return [p[0] + t * d1x, p[1] + t * d1y];
}

// Sutherland–Hodgman clip of a polygon against a convex counter-clockwise
// clip polygon.
export function clipConvex(subject: Pt[], clip: Pt[]): Pt[] {
  let out = subject;
  for (let i = 0; i < clip.length && out.length > 0; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const inside = ([px, py]: Pt) => (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]) >= 0;
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const cur = input[j];
      const prev = input[(j + input.length - 1) % input.length];
      const curIn = inside(cur);
      const prevIn = inside(prev);
      if (curIn) {
        if (!prevIn) out.push(intersect(prev, cur, a, b));
        out.push(cur);
      } else if (prevIn) {
        out.push(intersect(prev, cur, a, b));
      }
    }
  }
  return out;
}

const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// The transfer maps are affine per sector, so a straight segment maps to a
// polyline bent exactly where it crosses sector rays. Emit the start point
// plus those exact crossings (the end point belongs to the next edge).
function sampleEdge(
  a: Pt,
  b: Pt,
  out: Pt[],
  sectorSize: number,
  indexOf: (p: Pt) => number,
): void {
  out.push(a);
  const ka = indexOf(a);
  const kb = indexOf(b);
  if (ka === kb) return;
  const crossings: { t: number; p: Pt }[] = [];
  for (let m = Math.min(ka, kb) + 1; m <= Math.max(ka, kb); m++) {
    const dx = Math.cos(m * sectorSize);
    const dy = Math.sin(m * sectorSize);
    const ca = dx * a[1] - dy * a[0];
    const cb = dx * b[1] - dy * b[0];
    const t = ca / (ca - cb);
    if (t > 1e-12 && t < 1 - 1e-12) crossings.push({ t, p: lerp(a, b, t) });
  }
  crossings.sort((u, v) => u.t - v.t);
  for (const c of crossings) out.push(c.p);
}

function withRayCrossings(
  verts: Pt[],
  sectorSize: number,
  indexOf: (p: Pt) => number,
): Pt[] {
  const boundary: Pt[] = [];
  for (let e = 0; e < verts.length; e++) {
    sampleEdge(verts[e], verts[(e + 1) % verts.length], boundary, sectorSize, indexOf);
  }
  return boundary;
}

// Icosa-space cell boundary → exact pentagon-space polygon.
function transferPolygon(verts: Pt[]): Pt[] {
  return withRayCrossings(verts, ICO_SECTOR, sectorIndex).map(transfer);
}

// Pentagon-space polygon (canonical position) → exact icosa-space polygon.
function pullBackPolygon(pentPoly: Pt[]): Pt[] {
  return withRayCrossings(pentPoly, PENT_SECTOR, pentSectorIndex).map(invTransferCanonical);
}

// Same, on the global [0°, 360°) branch — for polygons in final (rotated)
// position anywhere on the pentagon, e.g. highlighted-face pieces.
const pentSectorGlobal = ([x, y]: Pt): number => {
  let phi = Math.atan2(y, x);
  if (phi < 0) phi += 2 * Math.PI;
  return Math.min(Math.floor(phi / PENT_SECTOR), 9);
};

function pullBackPolygonGlobal(pentPoly: Pt[]): Pt[] {
  return withRayCrossings(pentPoly, PENT_SECTOR, pentSectorGlobal).map(invTransfer);
}

export function buildGrid(res: number, opts: GridOptions = {}): Cell[] {
  const clipToFace = opts.clipToFace ?? true;
  const extendFaces = opts.extendFaces ?? false;
  const R = AC / SQRT7 ** res;
  const theta = res % 2 === 1 ? ROT : 0;
  const face = facePentagon();
  const minArea = Math.abs(polygonArea(face)) * 1e-9;
  const cells: Cell[] = [];

  // Central pentagon cell: five of the six vertices of the hexagon centred
  // at the origin (the sixth falls in the deleted 60° wedge). One seam-free
  // edge is transferred, then replicated by the five-fold symmetry — the
  // fifth copy is exactly the closing edge across the seam.
  const seamFreeEdge: Pt[] = [];
  sampleEdge(polar(theta + 30 * DEG, R), polar(theta + 90 * DEG, R), seamFreeEdge, ICO_SECTOR, sectorIndex);
  const edge = seamFreeEdge.map(transfer);
  const pentPoly: Pt[] = [];
  for (let k = 0; k < 5; k++) {
    for (const p of edge) pentPoly.push(rotate(p, k * 72 * DEG));
  }
  // In the unfolded fan the central cell is a "pac-man" of five hexagon
  // sixths. Its closing edge crosses the cone seam, so it is split there:
  // from the seam point s' on the 0° ray, over the five vertices, to the
  // matching seam point s on the 300° ray, then back to the apex. (At res 0
  // this is exactly the fan outline.)
  const v4 = polar(theta + 270 * DEG, R);
  const v5 = polar(theta + 330 * DEG, R);
  const s = intersect(v4, v5, [0, 0], polar(300 * DEG, 1));
  const pentIcosaCorners: Pt[] = [[0, 0], rotate(s, -300 * DEG)];
  for (let j = 0; j < 5; j++) pentIcosaCorners.push(polar(theta + (30 + 60 * j) * DEG, R));
  pentIcosaCorners.push(s);
  // Insert sector-ray crossings like every hex cell has: the edges are
  // straight in icosa space but kink there under the fold animation.
  const pentIcosa = withRayCrossings(pentIcosaCorners, ICO_SECTOR, sectorIndex);
  cells.push({
    kind: 'pentagon',
    center: [0, 0],
    polygon: pentPoly,
    icosaPolygon: pentIcosa,
    icosaCenter: [0, 0],
    centerInFace: true,
    clipped: false,
  });

  // Hexagon cells: lattice centres in the canonical wedge [0°, 60°), close
  // enough to the origin for their polygon to reach the displayed region
  // (radius AC for the face's preimage, 1 = the far icosa vertices when
  // extended to full faces).
  const clipRegion = extendFaces ? extendedClipDecagon() : face;
  // Pentagon-space image of the highlighted face triangle: a convex slice of
  // the extended decagon, so pieces can be cut with the convex clipper and
  // pulled back. (Face 4 abuts the cone seam; its pieces would land wrapped —
  // prefer faces 0–3.)
  const hf = opts.highlightFace;
  const hlQuad: Pt[] | null =
    hf == null
      ? null
      : [
          [0, 0],
          polar(hf * 72 * DEG, 2 * A_P),
          polar((hf * 72 + 36) * DEG, 1.5 * R_P),
          polar((hf + 1) * 72 * DEG, 2 * A_P),
        ];
  const highlightPiece = (pentSpacePoly: Pt[]): Pt[] => {
    if (!hlQuad) return [];
    const piece = clipConvex(pentSpacePoly, hlQuad);
    if (piece.length < 3 || polygonArea(piece) < minArea) return [];
    return pullBackPolygonGlobal(piece);
  };
  if (hlQuad) cells[0].highlightIcosa = highlightPiece(pentPoly);
  const spacing = Math.sqrt(3) * R;
  const u = polar(theta, spacing);
  const v = polar(theta + 60 * DEG, spacing);
  const maxDist = (extendFaces ? 1 : AC) + 2 * R;
  const range = Math.ceil(maxDist / spacing) + 1;
  const vertexOffsets: Pt[] = [];
  for (let j = 0; j < 6; j++) vertexOffsets.push(polar(theta + (30 + 60 * j) * DEG, R));

  for (let i = -range; i <= range; i++) {
    for (let j = -range; j <= range; j++) {
      if (i === 0 && j === 0) continue;
      const c: Pt = [i * u[0] + j * v[0], i * u[1] + j * v[1]];
      if (Math.hypot(c[0], c[1]) > maxDist) continue;
      let phi = Math.atan2(c[1], c[0]);
      if (phi < 0) phi += 2 * Math.PI;
      if (phi >= 60 * DEG) continue;

      const verts: Pt[] = vertexOffsets.map(([ox, oy]) => [c[0] + ox, c[1] + oy]);
      const mapped = transferPolygon(verts);
      const regionClip = clipConvex(mapped, clipRegion);
      if (regionClip.length < 3) continue;
      const regionArea = polygonArea(regionClip);
      if (regionArea < minArea) continue;
      const faceClip = extendFaces ? clipConvex(mapped, face) : regionClip;
      const faceClipArea = faceClip.length >= 3 ? polygonArea(faceClip) : 0;
      const wasClipped = faceClipArea < polygonArea(mapped) - minArea;
      const centerP = transfer(c);
      const centerInFace = pointInConvex(centerP, face);
      const poly = faceClipArea >= minArea ? (clipToFace ? faceClip : mapped) : [];
      const icosaPoly = pullBackPolygon(clipToFace ? regionClip : mapped);

      for (let k = 0; k < 5; k++) {
        const a = k * 72 * DEG;
        const ia = k * 60 * DEG;
        const cell: Cell = {
          kind: 'hex',
          center: rotate(centerP, a),
          polygon: poly.map((p) => rotate(p, a)),
          icosaPolygon: icosaPoly.map((p) => rotate(p, ia)),
          icosaCenter: rotate(c, ia),
          centerInFace,
          clipped: wasClipped,
        };
        if (hlQuad) cell.highlightIcosa = highlightPiece(regionClip.map((p) => rotate(p, a)));
        cells.push(cell);
      }
    }
  }

  return cells;
}
