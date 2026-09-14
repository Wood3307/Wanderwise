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

test("tidal infall preserves its source, accelerates directly inward, and closes exactly at the horizon", () => {
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
  assert.equal(pose(0.44).opacity, 0, "whole bodies dissolve before the main infall");
  assert.ok(pose(0.15).opacity > 0.5 && pose(0.15).opacity < 1, "the visible source gradually gives way to stellar fragments");
  for (const p of [0.12, 0.25, 0.5, 0.8]) {
    const sample = sampleCollapse({ position, target, normal, orientation: new THREE.Quaternion().setFromEuler(new THREE.Euler(1, 0.3, -2)), progress: p, index: 0, count: 1 });
    assert.deepEqual(sample.rotation.toArray(), [0, 0, 0, 1], "an intact galaxy never turns sideways before entry");
    assert.equal(sample.scale.x, sample.scale.y, "the intact model is not stretched into a flat ribbon");
  }
  const direct = target.clone().sub(position).normalize();
  for (const p of [0.1, 0.3, 0.6]) {
    const direction = pose(p).position.clone().sub(position).normalize();
    assert.ok(direction.distanceTo(direct) < 1e-10, "early motion is straight toward the eye");
  }
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
      let previousDistance = source.distanceTo(target);
      for (let index = 0; index <= 250; index++) {
        const sample = sampleCollapse({ position: source, target, normal: direction, progress: index / 250, index: 0, count: 1 });
        const distance = sample.position.distanceTo(target);
        assert.ok(distance <= previousDistance + 1e-8, "every trajectory moves monotonically inward, including the late curl");
        previousDistance = distance;
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
      assert.equal(particles.geometry.getAttribute("position").count, mobile ? 1980 : 4680);
      for (const phase of ["collapse", "birth"] as const) {
        for (const p of [0, 0.08, 0.2, 0.4, 0.7, 0.93, 1, NaN]) {
          effect.update(frame(phase, p));
          assert.equal(particles.geometry.drawRange.count, (mobile ? 660 : 1560) * (phase === "collapse" ? 3 : 1), "birth retains its previous particle budget");
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
      assert.ok(mesh.geometry.getAttribute("position").count <= (mobile ? 3120 : 13680));
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

test("dissociation starts on the preserved galaxy geometry and releases grains in a continuous accelerating flow", () => {
  const effect = createSearchTransition({ mobile: true });
  const sourcePositions = new Float32Array([-145, -62, 12, -125, -59, 14, -136, -43, 8]);
  const sourceColors = new Float32Array([0.2, 0.6, 1, 0.9, 0.3, 0.6, 1, 0.8, 0.4]);
  const savedPositions = sourcePositions.slice();
  const savedColors = sourceColors.slice();
  const input = {
    ...frame("collapse", 0),
    anchors: [{ id: "sampled-arms", position, fragmentPositions: sourcePositions, fragmentColors: sourceColors }],
  };
  const particles = effect.group.getObjectByName("tidal-stellar-fragments") as THREE.Points;
  const positions = particles.geometry.getAttribute("position");
  const colors = particles.geometry.getAttribute("color");
  const intensities = particles.geometry.getAttribute("intensity");
  const point = new THREE.Vector3();
  try {
    effect.update(input);
    for (let index = 0; index < 660; index++) {
      const sample = index % 3;
      assert.deepEqual(Array.from(positions.array.slice(index * 3, index * 3 + 3)), Array.from(sourcePositions.slice(sample * 3, sample * 3 + 3)));
      assert.deepEqual(Array.from(colors.array.slice(index * 3, index * 3 + 3)), Array.from(sourceColors.slice(sample * 3, sample * 3 + 3)));
    }
    const previous = new Float64Array(positions.count);
    for (let index = 0; index < positions.count; index++) previous[index] = point.fromBufferAttribute(positions, index).distanceTo(target);
    for (let step = 1; step <= 70; step++) {
      effect.update({ ...input, progress: step / 70 });
      for (let index = 0; index < positions.count; index++) {
        const distance = point.fromBufferAttribute(positions, index).distanceTo(target);
        assert.ok(distance <= previous[index] + 0.00005, "source grains and their trailing glints never drift away from capture");
        previous[index] = distance;
      }
    }
    effect.update({ ...input, progress: 0.44 });
    assert.equal(pose(0.44).opacity, 0);
    assert.ok(intensities.getX(0) > 0.4, "fragments remain luminous after the original galaxy has fully dissolved");
    const forwardGrain = point.fromBufferAttribute(positions, 0).distanceTo(target);
    const trailingGrain = point.fromBufferAttribute(positions, 660).distanceTo(target);
    assert.ok(trailingGrain > forwardGrain, "a dim trailing glint follows each moving grain");
    assert.ok(intensities.getX(0) > intensities.getX(660));
    assert.deepEqual(sourcePositions, savedPositions);
    assert.deepEqual(sourceColors, savedColors);
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
