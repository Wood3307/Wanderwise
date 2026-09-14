import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { createParallelLayout, createParallelPortal, getParallelPortalSpec, PARALLEL_PORTAL_KINDS } from './parallel-portals';

test('a topic sky includes five stable aperture geometries with varied inclinations', () => {
  const specs = Array.from({ length: 13 }, (_, index) => getParallelPortalSpec(`topic:${index}`, index));
  assert.deepEqual(new Set(specs.map(spec => spec.kind)), new Set(PARALLEL_PORTAL_KINDS));
  for (let index = 0; index < specs.length; index++) {
    assert.deepEqual(getParallelPortalSpec(`topic:${index}`, index), specs[index]);
    assert.ok(specs[index].radius >= 3.7 && specs[index].radius <= 4.3);
    assert.ok(specs[index].inclination > .5 && specs[index].inclination <= .96);
  }
  assert.notEqual(specs[0].rotation, specs[5].rotation, 'repeated families retain individual shapes');
});

test('thirteen destinations have bounded draw calls and complete, independent cleanup', () => {
  for (const mobile of [false, true]) {
    const portals = Array.from({ length: 13 }, (_, index) => createParallelPortal(`topic:${index}`, index, { mobile }));
    let draws = 0, vertices = 0, geometryDisposals = 0, materialDisposals = 0;
    for (const portal of portals) {
      portal.group.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        draws++;
        vertices += object.geometry.getAttribute('position').count;
        assert.ok(!Array.isArray(object.material));
        const material = object.material as THREE.ShaderMaterial;
        assert.equal(material.depthWrite, false, 'a transparent aura never occludes nearby topics');
        assert.equal(material.defines.DETAIL_OCTAVES, mobile ? 3 : 4);
        object.geometry.addEventListener('dispose', () => geometryDisposals++);
        material.addEventListener('dispose', () => materialDisposals++);
      });
    }
    assert.equal(draws, 13);
    assert.equal(vertices, 52);
    for (const portal of portals) {
      portal.dispose();
      portal.dispose();
      assert.equal(portal.group.children.length, 0);
    }
    assert.equal(geometryDisposals, 13);
    assert.equal(materialDisposals, 13);
  }
});

test('animation and hover keep physical text anchors fixed and reduced motion truly still', () => {
  const portal = createParallelPortal('stable-world-anchor', 2);
  const mesh = portal.group.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  const anchor = new THREE.Vector3(13, -8, 21);
  portal.group.position.copy(anchor);
  portal.update(30, false, true);
  assert.equal(mesh.material.uniforms.uTime.value, 30);
  assert.equal(mesh.material.uniforms.uHighlight.value, 1);
  assert.deepEqual(portal.group.position, anchor);
  portal.update(80, true, false);
  assert.equal(mesh.material.uniforms.uTime.value, 0);
  assert.equal(mesh.material.uniforms.uHighlight.value, 0);
  portal.update(Number.NaN, false);
  assert.equal(mesh.material.uniforms.uTime.value, 0);
  portal.dispose();
  portal.update(700, false, true);
  assert.equal(mesh.material.uniforms.uTime.value, 0, 'released materials are not animated');
});

test('orbitable topic anchors keep separation, depth and identity after relevance reordering', () => {
  const ids = Array.from({ length: 13 }, (_, index) => `topic:${index}`);
  const points = createParallelLayout(ids);
  const reversed = createParallelLayout(ids.slice().reverse(), true).reverse();
  assert.deepEqual(points, reversed);
  for (const axis of ['x', 'y', 'z'] as const) {
    const coordinates = points.map(point => point[axis]);
    assert.ok(Math.max(...coordinates) - Math.min(...coordinates) > 30, `${axis} has real depth`);
    assert.ok(Math.abs(coordinates.reduce((sum, value) => sum + value, 0)) < 1e-8);
  }
  for (let index = 0; index < points.length; index++) {
    assert.ok(points[index].toArray().every(Number.isFinite));
    for (let previous = 0; previous < index; previous++) assert.ok(points[index].distanceTo(points[previous]) >= 19 - 1e-8);
  }
  assert.deepEqual(createParallelLayout([]), []);
  assert.deepEqual(createParallelLayout(['only']), [new THREE.Vector3()]);
});
