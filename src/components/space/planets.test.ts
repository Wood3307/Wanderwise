import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { createPlanetarySystem, getPlanetKind } from './planets';

test('paragraphs become distinct three-dimensional planets with shared live anchors', () => {
  const system = createPlanetarySystem({ seed: 'a-real-answer', count: 6, mobile: false });
  try {
    assert.equal(system.planets.length, 6);
    assert.equal(new Set(system.planets.slice(0, 4).map(planet => planet.kind)).size, 4);
    const quadrants = new Set<string>();
    let ringFound = false;
    system.planets.forEach((planet, index) => {
      assert.equal(planet.index, index);
      assert.equal(planet.position, planet.object.position);
      assert.ok(planet.position.toArray().every(Number.isFinite));
      assert.ok(planet.position.length() > 6 && planet.position.length() < 14);
      assert.ok(planet.radius >= 0.55 && planet.radius <= 1.0);
      if (index < 4) quadrants.add(`${Math.sign(planet.position.x)},${Math.sign(planet.position.y)}`);
      assert.equal(planet.kind, getPlanetKind('a-real-answer', index));
      const body = planet.object.children.find(child => child.name.startsWith('planet-surface')) as THREE.Mesh;
      assert.ok(body.geometry instanceof THREE.SphereGeometry);
      assert.ok(body.material instanceof THREE.ShaderMaterial);
      assert.equal(body.geometry.parameters.widthSegments, 48);
      assert.equal(body.userData.paragraphIndex, index);
      if (planet.kind === 'ringed') {
        const rings = planet.object.getObjectByName('planet-icy-rings') as THREE.Mesh;
        assert.ok(rings.geometry instanceof THREE.RingGeometry);
        assert.notEqual(rings.rotation.x, 0);
        ringFound = true;
      }
    });
    assert.equal(quadrants.size, 4);
    assert.ok(system.planets[4].position.x > 12.5);
    assert.ok(system.planets[5].position.x < -12.5);
    assert.ok(Math.abs(system.planets[4].position.y) < 0.001);
    assert.ok(Math.abs(system.planets[5].position.y) < 0.001);
    assert.equal(ringFound, true);
    assert.ok((system.star.getObjectByName('stellar-photosphere') as THREE.Mesh).geometry instanceof THREE.SphereGeometry);
  } finally { system.dispose(); }
});

test('label kind resolution matches the physical surface across answer seeds and additional planets', () => {
  for (const seed of ['answer-one', 'answer-two', '知乎回答', '']) {
    const system = createPlanetarySystem({ seed, count: 10, mobile: true });
    try {
      assert.deepEqual(system.planets.map(planet => planet.kind), system.planets.map((_, index) => getPlanetKind(seed, index)));
      assert.equal(new Set(system.planets.slice(0, 4).map(planet => planet.kind)).size, 4);
    } finally { system.dispose(); }
  }
});

test('seeded systems are repeatable and cap geometry work for malformed or excessive counts', () => {
  const first = createPlanetarySystem({ seed: 'stable', count: 4, mobile: true });
  const second = createPlanetarySystem({ seed: 'stable', count: 4, mobile: true });
  try {
    assert.deepEqual(first.planets.map(planet => [planet.kind, planet.position.toArray(), planet.radius]), second.planets.map(planet => [planet.kind, planet.position.toArray(), planet.radius]));
    const body = first.planets[0].object.children[0] as THREE.Mesh<THREE.SphereGeometry>;
    assert.equal(body.geometry.parameters.widthSegments, 32);
  } finally { first.dispose(); second.dispose(); }
  for (const [count, expected] of [[Infinity, 0], [NaN, 0], [-5, 0], [3.8, 3], [500, 10]]) {
    const system = createPlanetarySystem({ seed: 'bounded', count, mobile: true });
    assert.equal(system.planets.length, expected);
    system.dispose();
  }
});

test('orbit anchors move slowly, freeze during reading, and resume without a time jump', () => {
  const system = createPlanetarySystem({ seed: 'motion', count: 4, mobile: true });
  try {
    const anchor = system.planets[0].position;
    const initial = anchor.clone();
    system.update(0, false);
    system.update(0.1, false);
    assert.ok(anchor.distanceTo(initial) > 0);
    assert.ok(anchor.distanceTo(initial) < 0.01);
    const atPause = anchor.clone();
    system.update(100, false, true);
    assert.deepEqual(anchor.toArray(), atPause.toArray());
    system.update(110, true);
    assert.deepEqual(anchor.toArray(), atPause.toArray());
    system.update(110.05, false);
    assert.ok(anchor.distanceTo(atPause) > 0);
    assert.ok(anchor.distanceTo(atPause) < 0.01);
    assert.equal(system.planets[0].object.position, anchor);
  } finally { system.dispose(); }
});

test('central light tracks group transforms and opacity reaches every visible material', () => {
  const system = createPlanetarySystem({ seed: 'lighting', count: 4, mobile: true });
  try {
    const scene = new THREE.Scene();
    scene.position.set(2, 3, 4);
    system.group.position.set(6, 8, 10);
    system.group.scale.setScalar(2);
    scene.add(system.group);
    system.update(0, false);
    system.setOpacity(0.35);
    system.group.traverse(object => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Sprite || object instanceof THREE.LineLoop)) return;
      const material = object.material as THREE.Material;
      if (material instanceof THREE.ShaderMaterial) {
        assert.equal(material.uniforms.uOpacity.value, 0.35);
        assert.deepEqual(material.uniforms.uStarPosition.value.toArray(), [8, 11, 14]);
      } else {
        assert.ok(material.opacity > 0 && material.opacity <= 0.35);
      }
    });
    system.setOpacity(0);
    assert.equal(system.group.visible, false);
    system.setOpacity(4);
    assert.equal(system.group.visible, true);
  } finally { system.dispose(); }
});

test('disposal releases shared resources once and detaches the system', () => {
  const system = createPlanetarySystem({ seed: 'cleanup', count: 6, mobile: true });
  const scene = new THREE.Scene();
  scene.add(system.group);
  const resources = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>();
  system.group.traverse(object => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Sprite || object instanceof THREE.LineLoop)) return;
    // THREE.Sprite's geometry is a library-owned singleton shared with other
    // scenes; only the module's own mesh/line geometries should be disposed.
    if (!(object instanceof THREE.Sprite)) resources.add(object.geometry);
    const material = object.material as THREE.Material;
    resources.add(material);
    if (material instanceof THREE.SpriteMaterial && material.map) resources.add(material.map);
  });
  let releases = 0;
  resources.forEach(resource => resource.addEventListener('dispose', () => { releases++; }));
  system.dispose();
  system.dispose();
  assert.equal(releases, resources.size);
  assert.equal(system.group.parent, null);
  assert.equal(system.group.children.length, 0);
});
