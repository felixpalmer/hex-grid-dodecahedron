// Two planar "spaces" and the piecewise-affine transfer between them.
//
// Icosa space — the neighbourhood of an icosahedron vertex A (origin), icosa
// edge length 1, unfolded flat. Around A sit five 60° face wedges (300°
// total: a cone with a 60° angular deficit). Each wedge splits into two
// Schwarz half-triangles (A, M, C): M = icosa edge midpoint (|AM| = 1/2),
// C = face centroid (|AC| = 1/√3); angles 30° at A, 90° at M, 60° at C.
//
// Pentagon space — the dodecahedron face: a regular pentagon centred at O
// (origin) with circumradius R_P. Its ten Schwarz half-triangles are
// (O, m, V): m = edge midpoint (apothem A_P), V = face vertex; angles 36° at
// O, 90° at m, 54° at V.
//
// Dual correspondence: A↔O, M↔m, C↔V. The transfer map carries barycentric
// coordinates from an icosa half-triangle to the matching pentagon
// half-triangle — ten 30° sectors onto ten 36° sectors. Sector corners
// alternate along boundaries b = 0, 1, 2, …: even boundaries carry the
// midpoint-type corner (M/m), odd boundaries the far corner (C/V).

export const DEG = Math.PI / 180;

export type Pt = [number, number];

// Icosa space (edge length 1).
export const AM = 0.5;
export const AC = 1 / Math.sqrt(3);
export const ICO_SECTOR = 30 * DEG;

// Pentagon space (world units).
export const R_P = 220;
export const A_P = R_P * Math.cos(36 * DEG);
export const PENT_SECTOR = 36 * DEG;

export const SQRT7 = Math.sqrt(7);
// Aperture-7 Class III rotation, ≈ 19.106605°.
export const ROT = Math.atan(Math.sqrt(3) / 5);

export const polar = (angle: number, dist: number): Pt => [
  dist * Math.cos(angle),
  dist * Math.sin(angle),
];

const isEven = (b: number) => ((b % 2) + 2) % 2 === 0;

// Corner on sector boundary b. Valid for any integer b, including negative
// or ≥ 10: the affine continuation past the cone seam keeps the transfer
// continuous for polygon vertices that dip just outside a canonical wedge.
export const icoCorner = (b: number): Pt => polar(b * ICO_SECTOR, isEven(b) ? AM : AC);
export const pentCorner = (b: number): Pt => polar(b * PENT_SECTOR, isEven(b) ? A_P : R_P);

// Sector index of an icosa-space point. The angle is taken on a [−45°, 315°)
// branch: exact over the whole cone [0°, 300°], with affine continuation on
// (−45°, 0°) below the seam and (300°, 315°) above it — the continuation is
// genuinely multivalued (the cone unrolls), so a branch cut must go
// somewhere, and this puts it inside the deleted wedge where no cell
// geometry is ever evaluated.
export function sectorIndex([x, y]: Pt): number {
  let phi = Math.atan2(y, x);
  if (phi < -Math.PI / 4) phi += 2 * Math.PI;
  return Math.floor(phi / ICO_SECTOR);
}

// Pentagon-space sector index on the [−54°, 306°) branch — the exact image
// of sectorIndex's [−45°, 315°) icosa branch (angles scale by 36/30 at the
// cut). Used when pulling canonical-wedge geometry back to icosa space,
// where points may dip slightly below the seam.
export function pentSectorIndex([x, y]: Pt): number {
  let phi = Math.atan2(y, x);
  if (phi < -0.3 * Math.PI) phi += 2 * Math.PI;
  return Math.floor(phi / PENT_SECTOR);
}

// Barycentric map of p through sector k: corners of the source space map to
// the same-index corners of the target space, the apex (origin) to the apex.
function mapBySector(p: Pt, k: number, from: (b: number) => Pt, to: (b: number) => Pt): Pt {
  const [x, y] = p;
  const [sx1, sy1] = from(k);
  const [sx2, sy2] = from(k + 1);
  // Barycentric coordinates with the apex at the origin: p = b1·s1 + b2·s2.
  const det = sx1 * sy2 - sx2 * sy1;
  const b1 = (x * sy2 - sx2 * y) / det;
  const b2 = (sx1 * y - x * sy1) / det;
  const [tx1, ty1] = to(k);
  const [tx2, ty2] = to(k + 1);
  return [b1 * tx1 + b2 * tx2, b1 * ty1 + b2 * ty2];
}

// Piecewise-affine transfer, icosa space → pentagon space.
export function transfer(p: Pt): Pt {
  if (p[0] === 0 && p[1] === 0) return [0, 0];
  return mapBySector(p, sectorIndex(p), icoCorner, pentCorner);
}

// Inverse transfer on the canonical branch — exact partner of `transfer` for
// canonical-wedge cell geometry (pentagon angles ≈ (−45°, 120°)).
export function invTransferCanonical(p: Pt): Pt {
  if (p[0] === 0 && p[1] === 0) return [0, 0];
  return mapBySector(p, pentSectorIndex(p), pentCorner, icoCorner);
}

// Global inverse transfer, pentagon space → icosa space. Single-valued over
// the whole plane (the branch ambiguity exists only on the cone side): use
// this for arbitrary points, e.g. mapping a hovered face position.
export function invTransfer(p: Pt): Pt {
  const [x, y] = p;
  if (x === 0 && y === 0) return [0, 0];
  let phi = Math.atan2(y, x);
  if (phi < 0) phi += 2 * Math.PI;
  const k = Math.min(Math.floor(phi / PENT_SECTOR), 9);
  return mapBySector(p, k, pentCorner, icoCorner);
}

// --- Folding the fan closed ---------------------------------------------
//
// A continuous interpolation between the unfolded icosa fan (t = 0) and the
// pentagon (t = 1), in icosa units: sector boundaries sweep from 30b° to
// 36b°, edge-midpoint corners slide from |AM| to the pentagon apothem
// (AC·cos36°), centroid corners stay put. fold(p, 1) equals transfer(p)
// rescaled by AC/R_P, so the folded fan coincides with the face diagram.

const FOLD_M_END = AC * Math.cos(36 * DEG);

const foldCorner = (t: number) => (b: number): Pt =>
  polar(
    b * (ICO_SECTOR + t * (PENT_SECTOR - ICO_SECTOR)),
    isEven(b) ? AM + t * (FOLD_M_END - AM) : AC,
  );

export function fold(p: Pt, t: number): Pt {
  if (t === 0 || (p[0] === 0 && p[1] === 0)) return p;
  return mapBySector(p, sectorIndex(p), icoCorner, foldCorner(t));
}

// Inverse of fold at the same t, on the global branch — for mapping hovered
// points on the (partially) folded fan back to icosa space.
export function unfold(q: Pt, t: number): Pt {
  if (t === 0 || (q[0] === 0 && q[1] === 0)) return q;
  let phi = Math.atan2(q[1], q[0]);
  if (phi < 0) phi += 2 * Math.PI;
  const sector = ICO_SECTOR + t * (PENT_SECTOR - ICO_SECTOR);
  const k = Math.min(Math.floor(phi / sector), 9);
  return mapBySector(q, k, foldCorner(t), icoCorner);
}

// The dodecahedron face outline: vertices sit on the odd sector boundaries,
// counter-clockwise.
export const facePentagon = (): Pt[] => [1, 3, 5, 7, 9].map(pentCorner);

// Outline of the unfolded icosa-space fan (the preimage of the face): five
// sixths of the res-0 hexagon, with the deleted 60° wedge open between the
// two seam edges. Interior edge-midpoint corners are collinear with their
// neighbouring centroids, so only the centroids and seam endpoints appear.
export const fanOutline = (): Pt[] => [
  [0, 0],
  icoCorner(0),
  icoCorner(1),
  icoCorner(3),
  icoCorner(5),
  icoCorner(7),
  icoCorner(9),
  icoCorner(10),
];

// Outline of the five complete icosahedron faces unfolded around the vertex:
// out to the far corners B_k (the other icosa vertices, at edge length 1).
export const faceFanOutline = (): Pt[] => {
  const out: Pt[] = [[0, 0]];
  for (let k = 0; k <= 5; k++) out.push(polar(k * 60 * DEG, 1));
  return out;
};

// The image of the full-face fan under the transfer: a convex decagon in
// pentagon space (far corners B_k land on even rays at twice the apothem;
// far edges bend on odd rays at 1.5·R_P). Clipping cells against this in
// pentagon space and pulling back is equivalent to clipping against the
// full-face fan in icosa space, where the region is not convex at the apex.
export const extendedClipDecagon = (): Pt[] => {
  const out: Pt[] = [];
  for (let b = 0; b < 10; b++) {
    out.push(polar(b * PENT_SECTOR, b % 2 === 0 ? 2 * A_P : 1.5 * R_P));
  }
  return out;
};
