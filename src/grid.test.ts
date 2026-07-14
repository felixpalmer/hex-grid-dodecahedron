import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AC, DEG, R_P, facePentagon, fold, pentCorner, type Pt } from './transfer.ts';
import { buildGrid, polygonArea } from './grid.ts';

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const faceArea = polygonArea(facePentagon());

test('res 0 is exactly the face pentagon', () => {
  const cells = buildGrid(0);
  assert.equal(cells.length, 1);
  assert.equal(cells[0].kind, 'pentagon');
  assert.ok(Math.abs(polygonArea(cells[0].polygon) - faceArea) < 1e-6 * faceArea);
  for (const v of facePentagon()) {
    const nearest = Math.min(...cells[0].polygon.map((p) => dist(p, v)));
    assert.ok(nearest < 1e-6 * R_P, 'each face vertex is a res-0 polygon vertex');
  }
});

test('clipped cells tile the face exactly (area conservation, res 0–4)', () => {
  for (let res = 0; res <= 4; res++) {
    const total = buildGrid(res).reduce((sum, c) => sum + polygonArea(c.polygon), 0);
    assert.ok(
      Math.abs(total - faceArea) < 1e-6 * faceArea,
      `res ${res}: total ${total} vs face ${faceArea}`,
    );
  }
});

test('res 1 is one pentagon plus five in-face hexagons (plus boundary fragments)', () => {
  const cells = buildGrid(1);
  assert.equal(cells.filter((c) => c.kind === 'pentagon').length, 1);
  assert.equal(cells.filter((c) => c.kind === 'hex' && c.centerInFace).length, 5);
  assert.ok(cells.filter((c) => c.kind === 'hex' && !c.centerInFace).length > 0);
});

test('pentagon cell area shrinks by 1/7 per level', () => {
  for (let res = 1; res <= 3; res++) {
    const pent = buildGrid(res).find((c) => c.kind === 'pentagon')!;
    const expected = faceArea / 7 ** res;
    assert.ok(Math.abs(polygonArea(pent.polygon) - expected) < 1e-6 * expected);
  }
});

test('face corners are cell vertices at every resolution', () => {
  const V = pentCorner(1);
  for (let res = 1; res <= 3; res++) {
    const cells = buildGrid(res);
    let nearest = Infinity;
    for (const c of cells) {
      for (const p of c.polygon) nearest = Math.min(nearest, dist(p, V));
    }
    assert.ok(nearest < 1e-6 * R_P, `res ${res}: nearest polygon vertex ${nearest}`);
  }
});

test('interior hexagons at even res are six 72/54/54 triangles', () => {
  const cells = buildGrid(4);
  // Six-point polygons sit wholly inside one sector, so they are exact
  // affine images of a regular hexagon.
  const cell = cells.find((c) => c.kind === 'hex' && c.centerInFace && !c.clipped && c.polygon.length === 6);
  assert.ok(cell, 'expected at least one single-sector interior hexagon');
  const angleOf = (a: Pt, b: Pt, c: Pt) => {
    const u = Math.atan2(a[1] - b[1], a[0] - b[0]);
    const v = Math.atan2(c[1] - b[1], c[0] - b[0]);
    let d = Math.abs(u - v);
    if (d > Math.PI) d = 2 * Math.PI - d;
    return d / DEG;
  };
  for (let i = 0; i < 6; i++) {
    const p = cell!.polygon[i];
    const q = cell!.polygon[(i + 1) % 6];
    const angles = [
      angleOf(q, cell!.center, p),
      angleOf(cell!.center, p, q),
      angleOf(p, q, cell!.center),
    ].sort((x, y) => x - y);
    assert.ok(Math.abs(angles[0] - 54) < 1e-6, `triangle ${i}: ${angles}`);
    assert.ok(Math.abs(angles[1] - 54) < 1e-6, `triangle ${i}: ${angles}`);
    assert.ok(Math.abs(angles[2] - 72) < 1e-6, `triangle ${i}: ${angles}`);
  }
});

test('icosa polygons tile the unfolded fan (area conservation, res 0–3)', () => {
  // 5/6 of the res-0 hexagon: (5/6)·(3√3/2)·AC² with AC = 1/√3.
  const fanArea = (5 / 6) * (3 * Math.sqrt(3) / 2) * (1 / 3);
  for (let res = 0; res <= 3; res++) {
    const total = buildGrid(res).reduce((sum, c) => sum + polygonArea(c.icosaPolygon), 0);
    assert.ok(
      Math.abs(total - fanArea) < 1e-6 * fanArea,
      `res ${res}: total ${total} vs fan ${fanArea}`,
    );
  }
});

test('icosa hexagons are regular', () => {
  const res = 2;
  const R = (1 / Math.sqrt(3)) / Math.sqrt(7) ** res;
  const cell = buildGrid(res).find((c) => c.kind === 'hex' && c.centerInFace && !c.clipped)!;
  // Pulled-back boundary points may include collinear bend points on edges,
  // so check regularity via area and radius bounds instead of per-vertex.
  const hexArea = (3 * Math.sqrt(3) / 2) * R * R;
  assert.ok(Math.abs(polygonArea(cell.icosaPolygon) - hexArea) < 1e-9);
  for (const p of cell.icosaPolygon) {
    const r = Math.hypot(p[0] - cell.icosaCenter[0], p[1] - cell.icosaCenter[1]);
    assert.ok(r < R + 1e-9 && r > (R * Math.sqrt(3)) / 2 - 1e-9);
  }
});

test('extended grid tiles the five full icosa faces; pentagon side unchanged', () => {
  const fullFanArea = 5 * (Math.sqrt(3) / 4); // five unit equilateral triangles
  for (const res of [1, 2]) {
    const cells = buildGrid(res, { extendFaces: true });
    const icoTotal = cells.reduce((sum, c) => sum + polygonArea(c.icosaPolygon), 0);
    assert.ok(
      Math.abs(icoTotal - fullFanArea) < 1e-6 * fullFanArea,
      `res ${res}: icosa total ${icoTotal} vs ${fullFanArea}`,
    );
    // The pentagon view still shows exactly the face.
    const pentTotal = cells.reduce(
      (sum, c) => sum + (c.polygon.length >= 3 ? polygonArea(c.polygon) : 0),
      0,
    );
    assert.ok(Math.abs(pentTotal - faceArea) < 1e-6 * faceArea, `res ${res}: pent total ${pentTotal}`);
    // Extension-only cells exist and have no pentagon presence.
    assert.ok(cells.some((c) => c.polygon.length === 0 && c.icosaPolygon.length >= 3));
  }
});

test('highlighted-face pieces tile exactly one icosa triangle', () => {
  const triangleArea = Math.sqrt(3) / 4; // unit equilateral triangle
  for (const res of [1, 2]) {
    const cells = buildGrid(res, { extendFaces: true, highlightFace: 1 });
    const total = cells.reduce(
      (sum, c) => sum + (c.highlightIcosa && c.highlightIcosa.length >= 3 ? polygonArea(c.highlightIcosa) : 0),
      0,
    );
    assert.ok(
      Math.abs(total - triangleArea) < 1e-6 * triangleArea,
      `res ${res}: highlight total ${total} vs ${triangleArea}`,
    );
  }
});

test('central cell folds exactly onto its pentagon shape (no end-of-animation jump)', () => {
  const S = R_P / AC;
  for (const res of [1, 2]) {
    const pent = buildGrid(res).find((c) => c.kind === 'pentagon')!;
    // Every pentagon-space boundary point (including edge bend points) must
    // be hit by the fully folded icosa polygon — i.e. the icosa polygon
    // carries all sector-ray crossings so kinks animate instead of jumping.
    for (const q of pent.polygon) {
      const nearest = Math.min(
        ...pent.icosaPolygon.map((p) => {
          const f = fold(p, 1);
          return Math.hypot(f[0] * S - q[0], f[1] * S - q[1]);
        }),
      );
      assert.ok(nearest < 1e-6 * R_P, `res ${res}: pentagon point ${q} unmatched (${nearest})`);
    }
  }
});

test('odd resolutions are rotated ~19.1° relative to even ones', () => {
  // The pentagon cell's first vertex direction reflects the lattice rotation
  // in icosa space (the transfer distorts angles, so compare in icosa terms
  // via the known construction: even res vertex at 30°, odd at 30° + 19.1°;
  // in pentagon space both land in sector 0/1 but at different bearings).
  const bearing = (res: number) => {
    const pent = buildGrid(res).find((c) => c.kind === 'pentagon')!;
    const p = pent.polygon[0];
    return Math.atan2(p[1], p[0]) / DEG;
  };
  const even = bearing(2);
  const odd = bearing(1);
  assert.ok(Math.abs(even - 36) < 1e-6, `even-res pentagon vertex should sit at 36°, got ${even}`);
  assert.ok(odd > even + 10 && odd < even + 30, `odd-res pentagon should be rotated, got ${odd}`);
});
