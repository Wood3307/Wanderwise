import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { createCometField } from './comets';

function nucleus(field: ReturnType<typeof createCometField>) {
  return field.group.getObjectByName('comet-ice-nucleus') as THREE.Mesh;
}

test('sparse seeded comets stay in the periphery through a complete activity cycle', () => {
  const scale = 17;
  const field = createCometField({ seed: 'distant-visitors', scale, mobile: false });
  const second = createCometField({ seed: 'distant-visitors', scale, mobile: false });
  try {
    assert.equal(field.group.children.length, 2);
    assert.deepEqual(nucleus(field).position.toArray(), nucleus(second).position.toArray());
    assert.equal(field.group.children.filter(child => child.visible).length, 1);
    let visibleFrames = 0;
    const first = field.group.children[0];
    for (let frame = 0; frame < 1000; frame++) {
      field.update(frame * 0.05, false);
      if (first.visible) visibleFrames++;
      field.group.traverse(object => {
        assert.equal(object.userData.decoration, true);
        if (object instanceof THREE.Mesh) {
          const radial = Math.hypot(object.position.x, object.position.y) / scale;
          assert.ok(radial > 0.75 && radial < 1.4);
          assert.ok(object.position.z < -scale * 0.18);
        }
        if (object instanceof THREE.Points) {
          const position = object.geometry.getAttribute('position');
          assert.ok(position.count <= 40);
          for (let index = 0; index < position.count; index++) {
            const x = position.getX(index), y = position.getY(index), z = position.getZ(index);
            assert.ok([x, y, z].every(Number.isFinite));
            // A hidden, not-yet-used trail can still contain initialized zeros.
            if (!object.parent?.visible) continue;
            const radial = Math.hypot(x, y) / scale;
            assert.ok(radial > 0.75 && radial < 1.4);
          }
        }
      });
    }
    assert.ok(visibleFrames > 160 && visibleFrames < 500, `visible ${visibleFrames} / 1000 frames`);
  } finally { field.dispose(); second.dispose(); }
});

test('head, tails and fade freeze while reading and resume without a time jump', () => {
  const field = createCometField({ seed: 'motion', scale: 17, mobile: true });
  try {
    const head = nucleus(field);
    const initial = head.position.clone();
    field.update(0, false);
    field.update(0.1, false);
    const moved = head.position.clone();
    assert.ok(moved.distanceTo(initial) > 0 && moved.distanceTo(initial) < 0.05);
    const tail = field.group.getObjectByName('comet-dust-tail') as THREE.Points;
    const positions = Array.from(tail.geometry.getAttribute('position').array);
    const opacity = (tail.material as THREE.PointsMaterial).opacity;
    field.update(100, false, true);
    field.update(200, true);
    assert.deepEqual(head.position.toArray(), moved.toArray());
    assert.deepEqual(Array.from(tail.geometry.getAttribute('position').array), positions);
    assert.equal((tail.material as THREE.PointsMaterial).opacity, opacity);
    field.update(200.05, false);
    assert.ok(head.position.distanceTo(moved) > 0 && head.position.distanceTo(moved) < 0.025);
    field.update(NaN, false);
    assert.ok(head.position.toArray().every(Number.isFinite));
  } finally { field.dispose(); }
});

test('local positions survive parent transforms and decorative comets cannot intercept raycasts', () => {
  const field = createCometField({ seed: 'translated', scale: 65, mobile: true });
  try {
    const head = nucleus(field);
    const local = head.position.clone();
    const scene = new THREE.Scene();
    scene.position.set(20, 10, -5);
    field.group.position.set(5, 6, 7);
    field.group.scale.setScalar(2);
    scene.add(field.group);
    scene.updateMatrixWorld(true);
    assert.deepEqual(head.getWorldPosition(new THREE.Vector3()).toArray(), local.clone().multiplyScalar(2).add(new THREE.Vector3(25, 16, 2)).toArray());
    const raycaster = new THREE.Raycaster(new THREE.Vector3(), head.getWorldPosition(new THREE.Vector3()).normalize());
    assert.deepEqual(raycaster.intersectObject(field.group, true), []);
  } finally { field.dispose(); }
});

test('opacity is bounded and disposal releases each owned resource once', () => {
  const field = createCometField({ seed: 'cleanup', scale: 17, mobile: false });
  const scene = new THREE.Scene();
  scene.add(field.group);
  const resources = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>();
  field.group.traverse(object => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Sprite)) return;
    if (!(object instanceof THREE.Sprite)) resources.add(object.geometry);
    const material = object.material as THREE.MeshBasicMaterial | THREE.PointsMaterial | THREE.SpriteMaterial;
    resources.add(material);
    if (material.map) resources.add(material.map);
  });
  field.setOpacity(0.3);
  resources.forEach(resource => {
    if (resource instanceof THREE.Material) assert.ok(resource.opacity >= 0 && resource.opacity <= 0.3);
  });
  field.setOpacity(0);
  assert.equal(field.group.visible, false);
  field.setOpacity(100);
  assert.equal(field.group.visible, true);
  field.setOpacity(NaN);
  assert.equal(field.group.visible, false);
  let releases = 0;
  resources.forEach(resource => resource.addEventListener('dispose', () => { releases++; }));
  field.dispose();
  field.dispose();
  assert.equal(releases, resources.size);
  assert.equal(field.group.parent, null);
  assert.equal(field.group.children.length, 0);
});
