import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { sampleStellarFragments } from './fragments';

test('disintegration samples actual visible stars in world space and excludes extinction dust', () => {
  const root = new THREE.Group();
  root.position.set(30, -20, 7); root.rotation.z = Math.PI / 3; root.scale.setScalar(.6);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([1,2,3, 3,4,5, -3,-2,-1], 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute([1,.5,.2, .2,.6,1, .4,.1,.9], 3));
  const material = new THREE.PointsMaterial({ blending: THREE.AdditiveBlending });
  const stars = new THREE.Points(geometry, material); stars.position.x = 9;
  root.add(stars);
  const dustGeometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3000).fill(999), 3));
  const dustMaterial = new THREE.PointsMaterial({ blending: THREE.NormalBlending });
  root.add(new THREE.Points(dustGeometry, dustMaterial));
  const captured = sampleStellarFragments(root, 3);
  assert.equal(captured.fragmentPositions?.length, 9);
  for (let index = 0; index < 3; index++) {
    const expected = new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('position'), index).applyMatrix4(stars.matrixWorld);
    const actual = new THREE.Vector3().fromArray(captured.fragmentPositions!, index * 3);
    assert.ok(actual.distanceTo(expected) < 1e-5);
  }
  assert.deepEqual(captured.fragmentColors, geometry.getAttribute('color').array);
  stars.visible = false;
  assert.deepEqual(sampleStellarFragments(root, 3), {});
  assert.deepEqual(sampleStellarFragments(root, NaN), {});
  geometry.dispose(); material.dispose(); dustGeometry.dispose(); dustMaterial.dispose();
});
