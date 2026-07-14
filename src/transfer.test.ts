import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AC,
  DEG,
  R_P,
  fold,
  icoCorner,
  invTransfer,
  invTransferCanonical,
  pentCorner,
  polar,
  transfer,
  unfold,
  type Pt,
} from './transfer.ts';

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

test('maps the origin to the origin', () => {
  assert.deepEqual(transfer([0, 0]), [0, 0]);
});

test('maps Schwarz corners to their duals: M→m, C→V on every boundary', () => {
  for (let b = 0; b < 10; b++) {
    assert.ok(
      dist(transfer(icoCorner(b)), pentCorner(b)) < 1e-9 * R_P,
      `boundary ${b} corner should transfer to its pentagon dual`,
    );
  }
});

test('is continuous across sector boundaries, including the cone seam', () => {
  const eps = 1e-8;
  // b = 0 is the seam: points just below the 0° ray map via the affine
  // continuation and must meet the sector-0 image.
  for (let b = 0; b < 10; b++) {
    for (const r of [0.13, 0.31, 0.52]) {
      const lo = transfer(polar(b * 30 * DEG - eps, r));
      const hi = transfer(polar(b * 30 * DEG + eps, r));
      assert.ok(dist(lo, hi) < 1e-4, `boundary ${b}, radius ${r}`);
    }
  }
});

test('is affine within a sector', () => {
  const p: Pt = [0.31, 0.05];
  const q: Pt = [0.44, 0.19];
  const mid: Pt = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const tp = transfer(p);
  const tq = transfer(q);
  const tmid = transfer(mid);
  assert.ok(dist(tmid, [(tp[0] + tq[0]) / 2, (tp[1] + tq[1]) / 2]) < 1e-9 * R_P);
});

test('sends a grid-aligned equilateral triangle to a 72/54/54 triangle', () => {
  // The oriented equilateral triangle (A, C@30°, C@90°) is the shape of every
  // hexagon sixth at even (Class II) resolutions; its image has apex 72° at
  // the origin and base angles 54°.
  const tri = [transfer([0, 0]), transfer(polar(30 * DEG, AC)), transfer(polar(90 * DEG, AC))];
  const angleAt = (i: number) => {
    const a = tri[(i + 2) % 3];
    const b = tri[i];
    const c = tri[(i + 1) % 3];
    const u = Math.atan2(a[1] - b[1], a[0] - b[0]);
    const v = Math.atan2(c[1] - b[1], c[0] - b[0]);
    let d = Math.abs(u - v);
    if (d > Math.PI) d = 2 * Math.PI - d;
    return d / DEG;
  };
  const angles = [angleAt(0), angleAt(1), angleAt(2)].sort((x, y) => x - y);
  assert.ok(Math.abs(angles[0] - 54) < 1e-9);
  assert.ok(Math.abs(angles[1] - 54) < 1e-9);
  assert.ok(Math.abs(angles[2] - 72) < 1e-9);
});

test('invTransfer inverts transfer across the whole cone', () => {
  for (let deg = 1; deg < 300; deg += 7) {
    for (const r of [0.08, 0.27, 0.5]) {
      const p = polar(deg * DEG, r);
      const q = transfer(p);
      const back = invTransfer(q);
      assert.ok(Math.hypot(back[0] - p[0], back[1] - p[1]) < 1e-9, `angle ${deg}, radius ${r}`);
    }
  }
});

test('invTransferCanonical inverts transfer on the canonical branch', () => {
  for (let deg = -40; deg < 120; deg += 6) {
    for (const r of [0.1, 0.35]) {
      const p = polar(deg * DEG, r);
      const q = transfer(p);
      const back = invTransferCanonical(q);
      assert.ok(Math.hypot(back[0] - p[0], back[1] - p[1]) < 1e-9, `angle ${deg}, radius ${r}`);
    }
  }
});

test('transfer inverts invTransfer around the full pentagon', () => {
  for (let deg = 3; deg < 360; deg += 11) {
    const q = polar(deg * DEG, 0.6 * R_P);
    const p = invTransfer(q);
    const fwd = transfer(p);
    assert.ok(Math.hypot(fwd[0] - q[0], fwd[1] - q[1]) < 1e-9 * R_P, `angle ${deg}`);
  }
});

test('fold interpolates identity → transfer (rescaled), with unfold as inverse', () => {
  const S = R_P / AC;
  for (let deg = 2; deg < 300; deg += 13) {
    for (const r of [0.15, 0.45]) {
      const p = polar(deg * DEG, r);
      const p0 = fold(p, 0);
      assert.ok(dist(p0, p) < 1e-12, 'fold at t=0 is the identity');
      const p1 = fold(p, 1);
      const q = transfer(p);
      assert.ok(dist(p1, [q[0] / S, q[1] / S]) < 1e-9, 'fold at t=1 matches transfer');
      for (const t of [0.3, 0.7]) {
        assert.ok(dist(unfold(fold(p, t), t), p) < 1e-9, `unfold inverts fold at t=${t}`);
      }
    }
  }
});

test('commutes with the five-fold symmetry: transfer∘rot60 = rot72∘transfer', () => {
  const rot = ([x, y]: Pt, a: number): Pt => [
    x * Math.cos(a) - y * Math.sin(a),
    x * Math.sin(a) + y * Math.cos(a),
  ];
  for (const p of [[0.2, 0.1], [0.4, 0.31], [0.05, 0.5]] as Pt[]) {
    const lhs = transfer(rot(p, 60 * DEG));
    const rhs = rot(transfer(p), 72 * DEG);
    assert.ok(dist(lhs, rhs) < 1e-9 * R_P);
  }
});
