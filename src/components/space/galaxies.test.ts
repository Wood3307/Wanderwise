import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { answerLocalPosition, createGalaxy, getGalaxySpec } from './galaxies';

const options = { seed: 'readable-universe', color: '#b9d6f4', relevance: 0.85, mobile: false, pixelRatio: 1.5 };

test('galaxy seeds are repeatable and a five-question sky contains five physical morphologies', () => {
  const specs = Array.from({ length: 5 }, (_, index) => getGalaxySpec(`question:${index}`, index));
  assert.equal(new Set(specs.map(spec => spec.kind)).size, 5);
  assert.deepEqual(getGalaxySpec('question:2', 2), specs[2]);
  for (const [index, spec] of specs.entries()) {
    const first = createGalaxy(spec, { ...options, seed: `question:${index}` });
    const second = createGalaxy(spec, { ...options, seed: `question:${index}` });
    const firstStars = first.group.children[1] as THREE.Points;
    const secondStars = second.group.children[1] as THREE.Points;
    assert.deepEqual(firstStars.geometry.getAttribute('position').array, secondStars.geometry.getAttribute('position').array);
    assert.ok(first.group.userData.particleCount < 9200, 'ten desktop galaxies remain below 92,000 particles');
    first.dispose();
    second.dispose();
  }
});

test('fine stellar populations have bounded mobile geometry and cover every spiral arm', () => {
  for (const mobile of [false, true]) {
    for (let morphology = 0; morphology < 5; morphology++) {
      const spec = getGalaxySpec('fine-grains', morphology);
      const galaxy = createGalaxy(spec, { ...options, mobile });
      assert.ok(galaxy.group.userData.particleCount < (mobile ? 4600 : 9200));
      const detail = galaxy.group.getObjectByName('galaxy-detail-stars') as THREE.Points;
      assert.ok(detail instanceof THREE.Points);
      for (const attribute of Object.values(detail.geometry.attributes)) {
        assert.ok(Array.from(attribute.array).every(Number.isFinite));
      }
      if (spec.kind === 'spiral' || spec.kind === 'barred-spiral') {
        const bins = Array.from({ length: spec.arms }, () => new Array<number>(12).fill(0));
        const positions = detail.geometry.getAttribute('position');
        const start = spec.kind === 'barred-spiral' ? 0.29 : 0.18;
        const barEnd = spec.kind === 'barred-spiral' ? 0.28 : 0.1;
        for (let i = 0; i < positions.count; i++) {
          const x = positions.getX(i), y = positions.getY(i);
          const t = Math.hypot(x, y) / spec.radius;
          const winding = spec.phase + Math.max(0, t - barEnd) * spec.winding;
          const angle = ((Math.atan2(y, x) - winding) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
          const arm = Math.round(angle / (Math.PI * 2 / spec.arms)) % spec.arms;
          const bin = Math.min(11, Math.floor((t - start) / (0.98 - start) * 12));
          assert.ok(bin >= 0);
          bins[arm][bin]++;
        }
        assert.ok(bins.flat().every(count => count >= (mobile ? 20 : 60)), 'fine particles fill each radial section of every arm');
      }
      galaxy.dispose();
    }
  }
});

test('overview detail fades away at close range and preserves relevance brightness ordering', () => {
  const spec = getGalaxySpec('brightness', 0);
  const dim = createGalaxy(spec, { ...options, relevance: 0.2 });
  const bright = createGalaxy(spec, { ...options, relevance: 0.9 });
  const stars = (galaxy: typeof dim) => galaxy.group.children[1] as THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  for (const galaxy of [dim, bright]) {
    const detail = galaxy.group.getObjectByName('galaxy-detail-stars') as THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
    const overviewOpacity = stars(galaxy).material.uniforms.uOpacity.value;
    galaxy.setDetailVisibility(0);
    assert.equal(detail.visible, false);
    assert.equal(detail.material.uniforms.uOpacity.value, 0);
    assert.ok(Math.abs(stars(galaxy).material.uniforms.uOpacity.value * 1.12 - overviewOpacity) < 1e-12);
    galaxy.setDetailVisibility(0.5);
    assert.equal(detail.visible, true);
    const detailOpacity = detail.material.uniforms.uOpacity.value;
    galaxy.setOpacity(0.5);
    assert.equal(detail.material.uniforms.uOpacity.value, detailOpacity / 2);
  }
  assert.ok(stars(bright).material.uniforms.uOpacity.value > stars(dim).material.uniforms.uOpacity.value * 3);
  dim.dispose();
  bright.dispose();
});

test('answers occupy distinct finite physical locations, including the single-answer case', () => {
  for (let morphology = 0; morphology < 5; morphology++) {
    const spec = getGalaxySpec('question', morphology);
    for (let count = 1; count <= 12; count++) {
      const positions = Array.from({ length: count }, (_, index) => answerLocalPosition(spec, index, count));
      for (let index = 0; index < count; index++) {
        const point = positions[index];
        assert.ok(point.toArray().every(Number.isFinite));
        assert.ok(point.length() > 10 && point.length() < spec.radius * 1.3);
        for (let previous = 0; previous < index; previous++) assert.ok(point.distanceTo(positions[previous]) > 2);
      }
    }
  }
});

test('spiral answers sit on the same winding equation used by the visible arms', () => {
  for (const morphology of [0, 3]) {
    const spec = getGalaxySpec('same-arm', morphology);
    for (let index = 0; index < 8; index++) {
      const position = answerLocalPosition(spec, index, 8);
      const radius = Math.hypot(position.x, position.y);
      const barEnd = spec.kind === 'barred-spiral' ? 0.28 : 0.1;
      const angle = spec.phase + (index % spec.arms) * Math.PI * 2 / spec.arms + Math.max(0, radius / spec.radius - barEnd) * spec.winding;
      assert.ok(Math.abs(position.x - Math.cos(angle) * radius) < 0.000001);
      assert.ok(Math.abs(position.y - Math.sin(angle) * radius) < 0.000001);
    }
  }
});

test('elliptical galaxies have a volumetric stellar population and lenticular outskirts stay thin', () => {
  const thickness: number[] = [];
  for (const index of [1, 2]) {
    const spec = getGalaxySpec('shape', index);
    const galaxy = createGalaxy(spec, options);
    const positions = (galaxy.group.children[1] as THREE.Points).geometry.getAttribute('position');
    const outer: number[] = [];
    for (let i = 0; i < positions.count; i++) {
      if (Math.hypot(positions.getX(i), positions.getY(i)) > spec.radius * 0.45) outer.push(Math.abs(positions.getZ(i)));
    }
    thickness.push(outer.reduce((sum, value) => sum + value, 0) / outer.length);
    galaxy.dispose();
  }
  assert.ok(thickness[0] > thickness[1] * 5, 'ellipticals are genuinely volumetric, rather than recolored spiral disks');
});

test('galaxy animation does not mutate world anchors or vertex buffers and can be fully disposed', () => {
  const spec = getGalaxySpec('stable', 0);
  const galaxy = createGalaxy(spec, options);
  const stars = galaxy.group.children[1] as THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  const buffer = stars.geometry.getAttribute('position');
  const original = Array.from(buffer.array);
  galaxy.update(20, false);
  assert.equal(stars.material.uniforms.uTime.value, 20);
  galaxy.update(25, true);
  assert.equal(stars.material.uniforms.uTime.value, 0);
  assert.deepEqual(Array.from(buffer.array), original);
  galaxy.setOpacity(0);
  assert.equal(galaxy.group.visible, false);
  galaxy.setOpacity(0.5);
  assert.equal(galaxy.group.visible, true);
  galaxy.dispose();
  assert.equal(galaxy.group.children.length, 0);
  galaxy.dispose();
});
