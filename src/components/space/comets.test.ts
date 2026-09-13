import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { createCometField } from "./comets";

function nucleus(field: ReturnType<typeof createCometField>) {
  return field.group.getObjectByName("comet-ice-nucleus") as THREE.Mesh;
}

test("sparse seeded comets stay in the periphery through a complete activity cycle", () => {
  const scale = 17;
  const field = createCometField({
    seed: "distant-visitors",
    scale,
    mobile: false,
  });
  const second = createCometField({
    seed: "distant-visitors",
    scale,
    mobile: false,
  });
  try {
    assert.equal(field.group.children.length, 2);
    assert.deepEqual(
      nucleus(field).position.toArray(),
      nucleus(second).position.toArray(),
    );
    assert.equal(
      field.group.children.filter((child) => child.visible).length,
      1,
    );
    let visibleFrames = 0;
    const first = field.group.children[0];
    for (let frame = 0; frame < 1000; frame++) {
      field.update(frame * 0.05, false);
      if (first.visible) visibleFrames++;
      field.group.traverse((object) => {
        assert.equal(object.userData.decoration, true);
        if (object instanceof THREE.Mesh) {
          const radial =
            Math.hypot(object.position.x, object.position.y) / scale;
          assert.ok(radial > 0.75 && radial < 1.4);
          assert.ok(object.position.z < -scale * 0.18);
        }
        if (object instanceof THREE.Points) {
          const position = object.geometry.getAttribute("position");
          assert.ok(position.count <= 40);
          for (let index = 0; index < position.count; index++) {
            const x = position.getX(index),
              y = position.getY(index),
              z = position.getZ(index);
            assert.ok([x, y, z].every(Number.isFinite));
            // A hidden, not-yet-used trail can still contain initialized zeros.
            if (!object.parent?.visible) continue;
            const radial = Math.hypot(x, y) / scale;
            assert.ok(radial > 0.75 && radial < 1.4);
          }
        }
      });
    }
    assert.ok(
      visibleFrames > 160 && visibleFrames < 500,
      `visible ${visibleFrames} / 1000 frames`,
    );
  } finally {
    field.dispose();
    second.dispose();
  }
});

test("head, tails and fade freeze while reading and resume without a time jump", () => {
  const field = createCometField({ seed: "motion", scale: 17, mobile: true });
  try {
    const head = nucleus(field);
    const initial = head.position.clone();
    field.update(0, false);
    field.update(0.1, false);
    const moved = head.position.clone();
    assert.ok(
      moved.distanceTo(initial) > 0 && moved.distanceTo(initial) < 0.05,
    );
    const tail = field.group.getObjectByName("comet-dust-tail") as THREE.Points;
    const positions = Array.from(tail.geometry.getAttribute("position").array);
    const opacity = (tail.material as THREE.PointsMaterial).opacity;
    field.update(100, false, true);
    field.update(200, true);
    assert.deepEqual(head.position.toArray(), moved.toArray());
    assert.deepEqual(
      Array.from(tail.geometry.getAttribute("position").array),
      positions,
    );
    assert.equal((tail.material as THREE.PointsMaterial).opacity, opacity);
    field.update(200.05, false);
    assert.ok(
      head.position.distanceTo(moved) > 0 &&
        head.position.distanceTo(moved) < 0.025,
    );
    field.update(NaN, false);
    assert.ok(head.position.toArray().every(Number.isFinite));
  } finally {
    field.dispose();
  }
});

test("local positions survive parent transforms and decorative comets cannot intercept raycasts", () => {
  const field = createCometField({
    seed: "translated",
    scale: 65,
    mobile: true,
  });
  try {
    const head = nucleus(field);
    const local = head.position.clone();
    const scene = new THREE.Scene();
    scene.position.set(20, 10, -5);
    field.group.position.set(5, 6, 7);
    field.group.scale.setScalar(2);
    scene.add(field.group);
    scene.updateMatrixWorld(true);
    assert.deepEqual(
      head.getWorldPosition(new THREE.Vector3()).toArray(),
      local
        .clone()
        .multiplyScalar(2)
        .add(new THREE.Vector3(25, 16, 2))
        .toArray(),
    );
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(),
      head.getWorldPosition(new THREE.Vector3()).normalize(),
    );
    assert.deepEqual(raycaster.intersectObject(field.group, true), []);
  } finally {
    field.dispose();
  }
});

test("opacity is bounded and disposal releases each owned resource once", () => {
  const field = createCometField({ seed: "cleanup", scale: 17, mobile: false });
  const scene = new THREE.Scene();
  scene.add(field.group);
  const resources = new Set<
    THREE.BufferGeometry | THREE.Material | THREE.Texture
  >();
  field.group.traverse((object) => {
    if (!(
      object instanceof THREE.Mesh ||
      object instanceof THREE.Points ||
      object instanceof THREE.Sprite
    ))
      return;
    if (!(object instanceof THREE.Sprite)) resources.add(object.geometry);
    const material = object.material as
      THREE.MeshBasicMaterial | THREE.PointsMaterial | THREE.SpriteMaterial;
    resources.add(material);
    if (material.map) resources.add(material.map);
  });
  field.setOpacity(0.3);
  resources.forEach((resource) => {
    if (resource instanceof THREE.Material)
      assert.ok(resource.opacity >= 0 && resource.opacity <= 0.3);
  });
  field.setOpacity(0);
  assert.equal(field.group.visible, false);
  field.setOpacity(100);
  assert.equal(field.group.visible, true);
  field.setOpacity(NaN);
  assert.equal(field.group.visible, false);
  let releases = 0;
  resources.forEach((resource) =>
    resource.addEventListener("dispose", () => {
      releases++;
    }),
  );
  field.dispose();
  field.dispose();
  assert.equal(releases, resources.size);
  assert.equal(field.group.parent, null);
  assert.equal(field.group.children.length, 0);
});

test("article systems show a single substantial curved visitor, with quiet gaps and stable colors", () => {
  const field = createCometField({
    seed: "article-a",
    scale: 17,
    mobile: false,
    mode: "system",
  });
  const same = createCometField({
    seed: "article-a",
    scale: 17,
    mobile: false,
    mode: "system",
  });
  try {
    assert.equal(field.group.children.length, 1);
    assert.equal(
      field.group.userData.cometPalette,
      same.group.userData.cometPalette,
    );
    assert.equal(
      field.group.userData.cometActive,
      false,
      "entry starts with a short quiet delay",
    );
    field.update(0, false);
    const head = nucleus(field);
    const headPositions: THREE.Vector3[] = [];
    let visibleFrames = 0;
    let arrivals = 0;
    let wasVisible = false;
    const ribbon = field.group.getObjectByName(
      "comet-ion-ribbon",
    ) as THREE.Mesh;
    const position = ribbon.geometry.getAttribute("position");
    const originalArray = position.array;
    for (let frame = 1; frame <= 1200; frame++) {
      field.update(frame * 0.05, false);
      const active = field.group.userData.cometActive;
      if (active) {
        visibleFrames++;
        if (!wasVisible) arrivals++;
        assert.equal(
          field.group.children.filter((child) => child.visible).length,
          1,
        );
        assert.ok((ribbon.material as THREE.MeshBasicMaterial).opacity >= 0);
        if (frame < 120) headPositions.push(head.position.clone());
        const near = new THREE.Vector3().fromBufferAttribute(position, 0);
        const far = new THREE.Vector3().fromBufferAttribute(
          position,
          position.count - 1,
        );
        assert.ok(
          near.distanceTo(far) > 7,
          "resolved tail spans a visible arc rather than a few dots",
        );
        const middle = new THREE.Vector3().fromBufferAttribute(
          position,
          Math.floor(position.count / 4) * 2,
        );
        const chord = new THREE.Line3(near, far);
        assert.ok(
          chord
            .closestPointToPoint(middle, true, new THREE.Vector3())
            .distanceTo(middle) > 0.3,
          "tail has visible curvature",
        );
      }
      wasVisible = active;
    }
    assert.ok(arrivals >= 2 && arrivals <= 3);
    assert.ok(
      visibleFrames > 200 && visibleFrames < 430,
      `sparse duty cycle: ${visibleFrames}/1200`,
    );
    assert.ok(
      headPositions[0].distanceTo(headPositions.at(-1)!) > 9,
      "comet actually crosses the periphery",
    );
    assert.equal(
      position.array,
      originalArray,
      "the live position buffer is reused",
    );
    field.restart();
    assert.equal(field.group.userData.cometActive, false);
    for (let frame = 0; frame < 50; frame++)
      field.update(100 + frame * 0.05, false);
    assert.equal(
      field.group.userData.cometActive,
      true,
      "a new depth entry gets a fresh visitor",
    );
  } finally {
    field.dispose();
    same.dispose();
  }
  const palettes = new Set<string>();
  for (let index = 0; index < 24; index++) {
    const sample = createCometField({
      seed: `different-article-${index}`,
      scale: 17,
      mobile: true,
      mode: "system",
    });
    palettes.add(sample.group.userData.cometPalette);
    sample.dispose();
  }
  assert.ok(
    palettes.size >= 4,
    "article seeds produce genuinely different comet palettes",
  );
});

test("article ribbons stay clear of the central reading corridor from desktop and mobile camera directions", () => {
  const field = createCometField({
    seed: "projection-safe",
    scale: 17,
    mobile: false,
    mode: "system",
  });
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 2000);
  const directions = [
    [0, 0, 1],
    [1, 0.4, 0],
    [-1, -0.4, 0],
    [0.1, 1, 0.1],
    [0.1, -1, 0.1],
    [0, 0, -1],
  ];
  try {
    field.update(0, false);
    for (let frame = 1; frame < 125; frame++) {
      field.update(frame * 0.05, false);
      if (!field.group.userData.cometActive) continue;
      for (const aspect of [16 / 10, 390 / 844]) {
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
        for (const direction of directions) {
          camera.position
            .fromArray(direction)
            .normalize()
            .multiplyScalar(38 * Math.max(1, 0.96 / aspect));
          camera.lookAt(0, 0, 0);
          camera.updateMatrixWorld();
          field.group.quaternion.copy(camera.quaternion);
          field.group.updateMatrixWorld(true);
          field.group.traverse((object) => {
            if (
              !(
                object instanceof THREE.Mesh || object instanceof THREE.Points
              ) ||
              object === nucleus(field)
            )
              return;
            const positions = object.geometry.getAttribute("position");
            for (let index = 0; index < positions.count; index++) {
              const ndc = object
                .localToWorld(
                  new THREE.Vector3().fromBufferAttribute(positions, index),
                )
                .project(camera);
              const shortAxisRadius = Math.hypot(
                ndc.x * Math.max(1, aspect),
                ndc.y * Math.max(1, 1 / aspect),
              );
              assert.ok(
                shortAxisRadius > 0.65 && shortAxisRadius < 1.2,
                `peripheral radius ${shortAxisRadius}`,
              );
              assert.ok(ndc.z > -1 && ndc.z < 1);
            }
          });
        }
      }
    }
  } finally {
    field.dispose();
  }
});

test("article comet motion, trails and fades pause together and reduced motion hides the field", () => {
  const field = createCometField({
    seed: "reader-pause",
    scale: 17,
    mobile: true,
    mode: "system",
  });
  try {
    for (let frame = 0; frame <= 50; frame++) field.update(frame * 0.05, false);
    assert.equal(field.group.userData.cometActive, true);
    const position = nucleus(field).position.clone();
    const ribbon = field.group.getObjectByName(
      "comet-dust-ribbon",
    ) as THREE.Mesh;
    const material = ribbon.material as THREE.MeshBasicMaterial;
    const array = Array.from(ribbon.geometry.getAttribute("position").array);
    const opacity = material.opacity;
    field.update(200, false, true);
    field.update(300, false, true);
    assert.deepEqual(nucleus(field).position.toArray(), position.toArray());
    assert.deepEqual(
      Array.from(ribbon.geometry.getAttribute("position").array),
      array,
    );
    assert.equal(material.opacity, opacity);
    field.update(400, true);
    field.setOpacity(0.85);
    assert.equal(
      field.group.visible,
      false,
      "opacity changes cannot re-enable reduced-motion animation",
    );
    field.update(400.05, false);
    assert.equal(field.group.visible, true);
    assert.ok(nucleus(field).position.distanceTo(position) > 0);
    assert.ok(
      nucleus(field).position.distanceTo(position) < 0.2,
      "resume does not jump across the orbit",
    );
    field.update(NaN, false);
    assert.ok(nucleus(field).position.toArray().every(Number.isFinite));
    const raycaster = new THREE.Raycaster();
    assert.deepEqual(raycaster.intersectObject(field.group, true), []);
  } finally {
    field.dispose();
  }
});

test("article comet uses five drawables and bounded buffers, and releases all geometry, materials and textures once", () => {
  for (const mobile of [false, true]) {
    const field = createCometField({
      seed: "system-cleanup",
      scale: 17,
      mobile,
      mode: "system",
    });
    const resources = new Set<
      THREE.BufferGeometry | THREE.Material | THREE.Texture
    >();
    let drawables = 0;
    let dynamicVertices = 0;
    field.group.traverse((object) => {
      if (!(
        object instanceof THREE.Mesh ||
        object instanceof THREE.Points ||
        object instanceof THREE.Sprite
      ))
        return;
      drawables++;
      if (!(object instanceof THREE.Sprite)) {
        resources.add(object.geometry);
        const position = object.geometry.getAttribute("position");
        if (
          position instanceof THREE.BufferAttribute &&
          position.usage === THREE.DynamicDrawUsage
        )
          dynamicVertices += position.count;
      }
      const material = object.material as
        THREE.MeshBasicMaterial | THREE.PointsMaterial | THREE.SpriteMaterial;
      resources.add(material);
      if (material.map) resources.add(material.map);
    });
    assert.equal(drawables, 5);
    assert.equal(dynamicVertices, mobile ? 116 : 156);
    assert.equal(
      [...resources].filter((resource) => resource instanceof THREE.Texture)
        .length,
      2,
    );
    let releases = 0;
    resources.forEach((resource) =>
      resource.addEventListener("dispose", () => releases++),
    );
    field.dispose();
    field.dispose();
    field.restart();
    field.update(1, false);
    assert.equal(releases, resources.size);
    assert.equal(field.group.children.length, 0);
  }
});

test("every mobile comet visit stays below the article controls and above the bottom toolbar", () => {
  const field = createCometField({
    seed: "mobile-reading-lane",
    scale: 17,
    mobile: true,
    mode: "system",
  });
  const camera = new THREE.PerspectiveCamera(48, 390 / 844, 0.1, 2000);
  const directions = [
    [0, 0, 1],
    [1, 0.4, 0],
    [0.1, -1, 0.1],
  ];
  let arrivals = 0;
  let wasActive = false;
  try {
    field.update(0, false);
    for (let frame = 1; frame <= 1100; frame++) {
      field.update(frame * 0.1, false);
      const active = !!field.group.userData.cometActive;
      if (active && !wasActive) arrivals++;
      wasActive = active;
      if (!active) continue;
      for (const [width, height] of [
        [390, 844],
        [375, 812],
        [412, 915],
      ]) {
        const aspect = width / height;
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
        for (const direction of directions) {
          camera.position
            .fromArray(direction)
            .normalize()
            .multiplyScalar(38 * Math.max(1, 0.96 / aspect));
          camera.lookAt(0, 0, 0);
          camera.updateMatrixWorld();
          field.group.quaternion.copy(camera.quaternion);
          field.group.updateMatrixWorld(true);
          field.group.traverse((object) => {
            if (!(
              object instanceof THREE.Mesh || object instanceof THREE.Points
            ))
              return;
            const positions = object.geometry.getAttribute("position");
            for (let index = 0; index < positions.count; index++) {
              const ndc = object
                .localToWorld(
                  new THREE.Vector3().fromBufferAttribute(positions, index),
                )
                .project(camera);
              const x = (ndc.x * 0.5 + 0.5) * width;
              const y = (-ndc.y * 0.5 + 0.5) * height;
              assert.ok(
                x > 0 && x < width,
                `whole tail stays onscreen: x=${x}`,
              );
              assert.ok(
                y > height / 2 + width * 0.55 && y < height / 2 + width * 0.7,
                `quiet mobile lane: y=${y} in ${width}x${height}`,
              );
              if (width === 390)
                assert.ok(
                  y > 630 && y < 700,
                  "matches the real title/control/toolbar positions",
                );
            }
          });
        }
      }
    }
    assert.ok(arrivals >= 4, "later visits also use the safe lower lane");
  } finally {
    field.dispose();
  }
});
