import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { createClusterLayout } from './cluster-layout';

const ids = (count: number, seed = 'question') => Array.from({ length: count }, (_, index) => `${seed}:${index}`);
const axes = ['x', 'y', 'z'] as const;

function nearestDistances(points: THREE.Vector3[]) {
  let world = Infinity, projected = Infinity;
  for (let index = 0; index < points.length; index++) {
    for (let previous = 0; previous < index; previous++) {
      const delta = points[index].clone().sub(points[previous]);
      world = Math.min(world, delta.length());
      projected = Math.min(projected, Math.hypot(delta.x, delta.y), Math.hypot(delta.x, delta.z), Math.hypot(delta.y, delta.z));
    }
  }
  return { world, projected };
}

function covariance(points: THREE.Vector3[]) {
  const center = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(points.length);
  let xx = 0, yy = 0, zz = 0, xy = 0, xz = 0, yz = 0;
  for (const point of points) {
    const { x, y, z } = point.clone().sub(center);
    xx += x * x; yy += y * y; zz += z * z;
    xy += x * y; xz += x * z; yz += y * z;
  }
  return {
    variance: [xx, yy, zz],
    determinant: xx * yy * zz + 2 * xy * xz * yz - xx * yz * yz - yy * xz * xz - zz * xy * xy,
    product: xx * yy * zz,
  };
}

test('cluster anchors are finite, centered and separated, including empty and small skies', () => {
  for (const count of [0, 1, 2, 3, 4, 5, 10, 20]) {
    const layout = createClusterLayout(ids(count), { spacing: 172 });
    assert.equal(layout.length, count);
    assert.ok(layout.every(point => point.toArray().every(Number.isFinite)));
    const center = layout.reduce((sum, point) => sum.add(point), new THREE.Vector3());
    assert.ok(center.length() < 1e-8, 'camera orbit target remains the center of the cluster');
    if (count > 1) assert.ok(nearestDistances(layout).world >= 172 - 1e-8, 'galaxy nuclei have enough room for their physical disks');
  }
});

test('three galaxies retain principal-view area and avoid core overlap along ordinary orbit drags', () => {
  for (let seed = 0; seed < 8; seed++) {
    const layout = createClusterLayout(ids(3, `triangle:${seed}`));
    const normal = layout[1].clone().sub(layout[0]).cross(layout[2].clone().sub(layout[0]));
    const projectedAreas = axes.map(axis => Math.abs(normal[axis]) / 2);
    assert.ok(Math.min(...projectedAreas) / Math.max(...projectedAreas) > 0.32, 'side and top views preserve a broad triangle');
    assert.ok(Math.min(...projectedAreas) > 195 * 195 * 0.12, 'none of the principal projections is a narrow row');
    assert.ok(Math.max(...layout.map(point => point.length())) < 180, 'the small sky does not require a distant camera');
    const distance = (Math.max(...layout.map(point => point.length())) + 54) / Math.sin(THREE.MathUtils.degToRad(24)) * 1.05;
    for (const yaw of [-1.55, -0.8, -0.06, 0, 0.8, 1.55]) {
      for (const pitch of yaw === 0 || yaw === -0.06 ? [-1.25, -1, -0.87, -0.6, 0, 0.16, 0.6, 1, 1.25] : [0, 0.16]) {
        const view = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
        const projected = layout.map(point => point.clone().addScaledVector(view, -point.dot(view)).divideScalar(1 - point.dot(view) / distance));
        assert.ok(nearestDistances(projected).world > 72, 'near/far galaxy cores remain distinct throughout typical intermediate drags');
      }
    }
  }
});

test('larger clusters fill a balanced volume and remain dispersed across the principal projections', () => {
  for (const count of [4, 5, 10, 20]) {
    for (let seed = 0; seed < 6; seed++) {
      const layout = createClusterLayout(ids(count, `sky:${seed}`));
      const extents = axes.map(axis => Math.max(...layout.map(point => point[axis])) - Math.min(...layout.map(point => point[axis])));
      assert.ok(Math.min(...extents) / Math.max(...extents) > 0.7, 'depth is comparable to width and height');
      const { variance, determinant, product } = covariance(layout);
      assert.ok(Math.min(...variance) / Math.max(...variance) > 0.7, 'galaxies occupy every spatial axis');
      assert.ok(determinant / product > 0.5, 'a tilted disk with wide XYZ bounds is still rejected');
      assert.ok(nearestDistances(layout).projected > 33, 'principal views do not stack nuclei directly on top of each other');
      assert.ok(Math.max(...layout.map(point => point.length())) < 168 * Math.sqrt(count), 'the fit radius remains bounded as the sky grows');
    }
  }
});

test('anchors are deterministic per ID set and survive result sorting without camera-dependent rearrangement', () => {
  const originalIds = ids(10);
  const first = createClusterLayout(originalIds);
  assert.deepEqual(createClusterLayout(originalIds), first);
  const reorderedIds = [...originalIds].reverse();
  const reordered = createClusterLayout(reorderedIds);
  for (let index = 0; index < originalIds.length; index++) {
    assert.deepEqual(reordered[reorderedIds.indexOf(originalIds[index])], first[index]);
  }
  first[0].set(999, 999, 999);
  assert.notDeepEqual(createClusterLayout(originalIds)[0], first[0], 'renderers receive fresh vectors instead of mutable shared anchors');
  assert.notDeepEqual(createClusterLayout(ids(10, 'another-question')), createClusterLayout(originalIds));
});

test('spacing scales the same composition and invalid values fall back to a finite layout', () => {
  const base = createClusterLayout(ids(8), { spacing: 150 });
  const enlarged = createClusterLayout(ids(8), { spacing: 225 });
  for (let index = 0; index < base.length; index++) assert.ok(base[index].multiplyScalar(1.5).distanceTo(enlarged[index]) < 1e-8);
  for (const spacing of [0, -10, NaN, Infinity]) {
    assert.deepEqual(createClusterLayout(ids(3), { spacing }), createClusterLayout(ids(3)));
  }
});
