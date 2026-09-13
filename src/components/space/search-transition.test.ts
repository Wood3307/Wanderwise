import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import {
  createSearchTransition,
  sampleBirth,
  sampleCollapse,
  type SearchTransitionFrame,
} from "./search-transition";

const position = new THREE.Vector3(-135, -58, 12);
const target = new THREE.Vector3(180, 104, 0);
const normal = new THREE.Vector3(0, 0, -1);
const pose = (progress: number, index = 0, count = 6) =>
  sampleCollapse({ position, target, normal, progress, index, count });

test("tidal infall preserves its source, accelerates, and closes exactly at the horizon", () => {
  assert.ok(pose(0).position.distanceTo(position) < 1e-10);
  assert.deepEqual(pose(0).scale.toArray(), [1, 1, 1]);
  assert.ok(pose(0).rotation.angleTo(new THREE.Quaternion()) < 1e-10);
  assert.equal(pose(0).opacity, 1);
  for (let index = 0; index < 6; index++) {
    assert.deepEqual(pose(1, index).position.toArray(), target.toArray());
    assert.deepEqual(pose(1, index).scale.toArray(), [0, 0, 0]);
    assert.equal(pose(1, index).opacity, 0);
  }
  const speed = (p: number) => pose(p + 0.005).position.distanceTo(pose(p).position);
  assert.ok(speed(0.4) > speed(0.1) * 2, "infall accelerates before capture");
  assert.ok(pose(0.55).scale.x > pose(0.55).scale.y * 2, "a narrow tidal major axis forms");
  assert.ok(pose(0.97).position.distanceTo(target) < position.distanceTo(target) * 0.09);
  assert.ok(pose(0.5, 5).progress < pose(0.5, 0).progress, "galaxies start in a small cascade");
  assert.deepEqual(position.toArray(), [-135, -58, 12], "saved source transforms stay immutable");
});

test("collapse remains bounded through oblique views, degenerate targets and invalid progress", () => {
  for (const direction of [normal, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0.2, -0.7, -0.5), new THREE.Vector3()]) {
    for (const source of [position, target, new THREE.Vector3(0, 300, -80)]) {
      for (const progress of [-1, NaN, Infinity, ...Array.from({ length: 81 }, (_, i) => i / 80), 2]) {
        const sample = sampleCollapse({ position: source, target, normal: direction, progress, index: 2, count: 3 });
        assert.ok([...sample.position.toArray(), ...sample.rotation.toArray(), ...sample.scale.toArray(), sample.opacity].every(Number.isFinite));
        assert.ok(sample.position.distanceTo(target) <= source.distanceTo(target) * 1.025 + 0.0001, "no wide-radius orbit beyond the original scene");
        assert.ok(sample.opacity >= 0 && sample.opacity <= 1);
        assert.ok(sample.scale.toArray().every((value) => value >= 0 && value <= 2.65));
        assert.ok(Math.abs(sample.rotation.length() - 1) < 1e-8);
      }
    }
  }
});

test("new galaxies assemble monotonically with a soft stagger and fully recover their scale", () => {
  for (let index = 0; index < 16; index++) {
    assert.deepEqual(sampleBirth(0, index, 16), { scale: 0, opacity: 0 });
    assert.deepEqual(sampleBirth(1, index, 16), { scale: 1, opacity: 1 });
    let previous = sampleBirth(0, index, 16);
    for (let frame = 1; frame <= 80; frame++) {
      const next = sampleBirth(frame / 80, index, 16);
      assert.ok(next.scale >= previous.scale && next.scale <= 1);
      assert.ok(next.opacity >= previous.opacity && next.opacity <= 1);
      previous = next;
    }
  }
  assert.ok(sampleBirth(0.4, 0, 12).opacity > sampleBirth(0.4, 11, 12).opacity);
  assert.deepEqual(sampleBirth(NaN, 0, 1), { scale: 0, opacity: 0 });
});

function frame(phase: SearchTransitionFrame["phase"], progress: number): SearchTransitionFrame {
  const camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.1, 3000);
  camera.position.set(20, 30, 600);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return {
    camera,
    target,
    center: new THREE.Vector3(),
    phase,
    progress,
    time: progress * 1.8,
    anchors: Array.from({ length: 48 }, (_, index) => ({
      id: `galaxy-${index}`,
      position: new THREE.Vector3(Math.sin(index * 2.4) * 170, Math.cos(index * 2.4) * 110, Math.sin(index * 1.6) * 60),
      radius: 28,
      color: ["#98cfff", "#e2a2de", "#ffdda1"][index % 3],
    })),
  };
}

test("mobile and desktop transitions use four bounded batches and all uploaded attributes remain finite", () => {
  for (const mobile of [false, true]) {
    const effect = createSearchTransition({ mobile, pixelRatio: 2 });
    try {
      assert.equal(effect.group.children.length, 4);
      assert.equal(effect.group.visible, false);
      const particles = effect.group.getObjectByName("tidal-stellar-fragments") as THREE.Points;
      assert.equal(particles.geometry.getAttribute("position").count, mobile ? 660 : 1560);
      for (const phase of ["collapse", "birth"] as const) {
        for (const p of [0, 0.08, 0.2, 0.4, 0.7, 0.93, 1, NaN]) {
          effect.update(frame(phase, p));
          effect.group.traverse((object) => {
            assert.equal(object.userData.decoration, true);
            if (!(object instanceof THREE.Mesh || object instanceof THREE.Points)) return;
            for (const attribute of Object.values((object.geometry as THREE.BufferGeometry).attributes)) {
              assert.ok(Array.from(attribute.array).every(Number.isFinite));
            }
          });
        }
      }
      const mesh = effect.group.getObjectByName("tidal-accretion-silk") as THREE.Mesh;
      assert.ok(mesh.geometry.getAttribute("position").count <= (mobile ? 1600 : 9200));
      effect.update(frame("collapse", 1));
      const intensities = particles.geometry.getAttribute("intensity");
      assert.ok(Array.from(intensities.array).every((alpha) => alpha === 0));
      effect.update(frame("birth", 1));
      assert.ok(Array.from(intensities.array).every((alpha) => alpha === 0));
      const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 600), new THREE.Vector3(0, 0, -1));
      assert.deepEqual(raycaster.intersectObject(effect.group, true), []);
    } finally {
      effect.dispose();
    }
  }
});

test("waiting keeps only the accretion glow and does not upload fresh particle buffers", () => {
  const effect = createSearchTransition({ mobile: false });
  try {
    effect.update(frame("collapse", 0.8));
    const particles = effect.group.getObjectByName("tidal-stellar-fragments") as THREE.Points;
    const positions = particles.geometry.getAttribute("position") as THREE.BufferAttribute;
    const version = positions.version;
    effect.update(frame("wait", 1));
    effect.update({ ...frame("wait", 1), time: 48 });
    assert.equal(positions.version, version);
    assert.deepEqual(effect.group.children.filter((child) => child.visible).map((child) => child.name), ["existing-black-hole-accretion"]);
    effect.update(frame("idle", 0));
    assert.equal(effect.group.visible, false);
    effect.update({ ...frame("collapse", 0.5), anchors: [] });
    assert.equal(particles.visible, false);
  } finally {
    effect.dispose();
  }
});

test("interrupted search cleanup disposes every resource exactly once and detaches the effect", () => {
  const effect = createSearchTransition({ mobile: true });
  const scene = new THREE.Scene();
  scene.add(effect.group);
  effect.update(frame("birth", 0.24));
  const resources = new Set<THREE.BufferGeometry | THREE.Material>();
  effect.group.traverse((object) => {
    if (!(object instanceof THREE.Points || object instanceof THREE.Mesh)) return;
    resources.add(object.geometry);
    resources.add(object.material as THREE.Material);
  });
  let disposed = 0;
  resources.forEach((resource) => resource.addEventListener("dispose", () => disposed++));
  effect.dispose();
  effect.dispose();
  effect.update(frame("collapse", 0.5));
  assert.equal(disposed, resources.size);
  assert.equal(effect.group.parent, null);
  assert.equal(effect.group.children.length, 0);
  assert.equal(effect.group.visible, false);
});
