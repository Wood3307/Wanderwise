import * as THREE from "three";

export interface CometField {
  group: THREE.Group;
  update: (time: number, reducedMotion: boolean, paused?: boolean) => void;
  setOpacity: (opacity: number) => void;
  /** Begin a fresh arrival after a short fade-in delay. */
  restart: () => void;
  dispose: () => void;
}

function seededRandom(seed: string) {
  let state =
    Array.from(seed).reduce(
      (hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619),
      2166136261,
    ) >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** An owned, analytic texture; comet creation also works without a DOM/WebGL context. */
function createComaTexture() {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const radius = Math.hypot(
        ((x + 0.5) / size) * 2 - 1,
        ((y + 0.5) / size) * 2 - 1,
      );
      const index = (y * size + x) * 4;
      data[index] = data[index + 1] = data[index + 2] = 255;
      data[index + 3] = Math.round(
        Math.pow(Math.max(0, 1 - radius), 2.5) * 255,
      );
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

interface Trail {
  positions: THREE.BufferAttribute;
  material: THREE.PointsMaterial;
  count: number;
  dust: boolean;
}

interface Comet {
  group: THREE.Group;
  nucleus: THREE.Mesh;
  coma: THREE.Sprite;
  trails: Trail[];
  cycle: number;
  phase: number;
  duration: number;
  angle: number;
  radius: number;
  tilt: number;
  velocity: number;
  opacity: number;
}

/**
 * Sparse background visitors in the same 3D space as the selected galaxy or
 * planetary system. Paths stay outside the core, and both tails follow the
 * head through its orbit; no screen-space overlay or knowledge hit target.
 * `scale` is the outer radius of the scene this field accompanies.
 */
export function createCometField(options: {
  seed: string;
  scale: number;
  mobile: boolean;
  /** The galaxy ambience stays subtle; article systems receive a single bright visitor. */
  mode?: "galaxy" | "system";
}): CometField {
  if (options.mode === "system") return createSystemComet(options);
  const { mobile } = options;
  const scale = Number.isFinite(options.scale)
    ? THREE.MathUtils.clamp(options.scale, 0.1, 5000)
    : 17;
  const random = seededRandom(`${options.seed}:comet-field`);
  const group = new THREE.Group();
  group.name = "peripheral-comet-field";
  group.userData.decoration = true;
  const texture = createComaTexture();
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const nucleusGeometry = new THREE.IcosahedronGeometry(scale * 0.0027, 1);
  geometries.add(nucleusGeometry);
  const comets: Comet[] = [];
  let opacity = 1;
  let motionTime = 0;
  let lastTime: number | undefined;
  let disposed = false;

  function makeTrail(dust: boolean): { object: THREE.Points; trail: Trail } {
    const count = mobile ? 24 : 36;
    const geometry = new THREE.BufferGeometry();
    const positions = new THREE.BufferAttribute(
      new Float32Array(count * 3),
      3,
    ).setUsage(THREE.DynamicDrawUsage);
    const colors = new Float32Array(count * 3);
    const color = new THREE.Color(dust ? "#d5bfa4" : "#82cadd");
    for (let index = 0; index < count; index++) {
      const distance = index / (count - 1);
      const fade = Math.pow(1 - distance, dust ? 1.6 : 1.1);
      colors[index * 3] = color.r * fade;
      colors[index * 3 + 1] = color.g * fade;
      colors[index * 3 + 2] = color.b * fade;
    }
    geometry.setAttribute("position", positions);
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    // Fixed local bounds avoid a bounding-sphere calculation on every frame.
    geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(),
      scale * 1.6,
    );
    const material = new THREE.PointsMaterial({
      map: texture,
      size: scale * (dust ? 0.021 : 0.008),
      vertexColors: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    geometries.add(geometry);
    materials.add(material);
    const object = new THREE.Points(geometry, material);
    object.name = dust ? "comet-dust-tail" : "comet-ion-tail";
    return { object, trail: { positions, material, count, dust } };
  }

  for (let index = 0; index < (mobile ? 1 : 2); index++) {
    const cometGroup = new THREE.Group();
    cometGroup.name = `peripheral-comet-${index}`;
    const nucleusMaterial = new THREE.MeshBasicMaterial({
      color: "#d7e9ea",
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const comaMaterial = new THREE.SpriteMaterial({
      map: texture,
      color: index === 0 ? "#7ec8dd" : "#b7c7e8",
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    materials.add(nucleusMaterial);
    materials.add(comaMaterial);
    const nucleus = new THREE.Mesh(nucleusGeometry, nucleusMaterial);
    nucleus.name = "comet-ice-nucleus";
    const coma = new THREE.Sprite(comaMaterial);
    coma.name = "comet-coma";
    coma.scale.setScalar(scale * 0.035);
    const dust = makeTrail(true);
    const ion = makeTrail(false);
    cometGroup.add(nucleus, coma, dust.object, ion.object);
    group.add(cometGroup);
    const duration = 10 + random() * 2;
    const cycle = 36 + random() * 12;
    comets.push({
      group: cometGroup,
      nucleus,
      coma,
      trails: [dust.trail, ion.trail],
      duration,
      cycle,
      // A small, already-faded-in visitor is present on first entry; the other
      // starts well outside its visible interval instead of appearing in sync.
      phase: index === 0 ? 2.4 + random() * 1.5 : duration + 8 + random() * 4,
      angle: (index === 0 ? 0.3 : Math.PI + 0.35) + random() * 0.6,
      radius: scale * (0.98 + random() * 0.14),
      tilt: random() * Math.PI * 2,
      velocity: (0.014 + random() * 0.004) * (index === 0 ? 1 : -1),
      opacity: 0,
    });
  }

  function applyOpacity(comet: Comet) {
    const alpha = opacity * comet.opacity;
    comet.group.visible = alpha > 0.001;
    (comet.nucleus.material as THREE.MeshBasicMaterial).opacity = alpha * 0.74;
    comet.coma.material.opacity = alpha * 0.34;
    comet.trails.forEach((trail) => {
      trail.material.opacity = alpha * (trail.dust ? 0.13 : 0.25);
    });
  }

  function updateComet(comet: Comet) {
    const age = (motionTime + comet.phase) % comet.cycle;
    const progress = Math.min(age, comet.duration);
    const fadeIn = THREE.MathUtils.smoothstep(age, 0, 1.8);
    const fadeOut =
      1 - THREE.MathUtils.smoothstep(age, comet.duration - 2.5, comet.duration);
    comet.opacity = fadeIn * fadeOut;
    applyOpacity(comet);
    const angle = comet.angle + progress * comet.velocity;
    const radius = comet.radius;
    const z = scale * (-0.24 + Math.sin(angle * 0.7 + comet.tilt) * 0.055);
    comet.nucleus.position.set(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius * 0.87,
      z,
    );
    comet.coma.position.copy(comet.nucleus.position);
    if (!comet.group.visible) return;

    for (const trail of comet.trails) {
      for (let index = 0; index < trail.count; index++) {
        const distance = index / (trail.count - 1);
        // Ion trails are narrow. The dust fans gently outward with a little
        // curvature, never stretching toward the central reading position.
        const angleBehind =
          angle -
          Math.sign(comet.velocity) * distance * (trail.dust ? 0.115 : 0.14);
        const spread = trail.dust
          ? Math.sin(index * 2.399 + comet.tilt) * distance * 0.003
          : 0;
        const tailRadius =
          radius +
          scale * (distance * distance * (trail.dust ? 0.018 : 0.008) + spread);
        trail.positions.setXYZ(
          index,
          Math.cos(angleBehind) * tailRadius,
          Math.sin(angleBehind) * tailRadius * 0.87,
          z +
            scale *
              (trail.dust ? 0.005 : 0.002) *
              distance *
              Math.sin(comet.tilt + distance * 2),
        );
      }
      trail.positions.needsUpdate = true;
    }
  }

  group.traverse((object) => {
    object.userData.decoration = true;
    // Decorative visitors must not steal a galaxy, answer or paragraph click.
    object.raycast = () => {};
  });
  comets.forEach(updateComet);

  return {
    group,
    update(time, reducedMotion, paused = false) {
      if (disposed) return;
      const currentTime = Number.isFinite(time) ? time : (lastTime ?? 0);
      const delta =
        lastTime === undefined
          ? 0
          : Math.max(0, Math.min(0.1, currentTime - lastTime));
      lastTime = currentTime;
      if (reducedMotion || paused || delta === 0) return;
      motionTime += delta;
      comets.forEach(updateComet);
    },
    setOpacity(value) {
      if (disposed) return;
      opacity = Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0;
      group.visible = opacity > 0.001;
      comets.forEach(applyOpacity);
    },
    restart() {
      if (disposed) return;
      motionTime = 0;
      lastTime = undefined;
      comets.forEach(updateComet);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      texture.dispose();
      group.removeFromParent();
      group.clear();
    },
  };
}

const cometPalettes = [
  { name: "glacial", ion: "#88e5ff", dust: "#c7dcff", coma: "#aeeaff" },
  { name: "amethyst", ion: "#c2acff", dust: "#f2c1ea", coma: "#decaff" },
  { name: "rose-gold", ion: "#ffd2a0", dust: "#eab5cb", coma: "#ffe4ce" },
  { name: "jade", ion: "#8eedda", dust: "#bbe3ec", coma: "#c4fff0" },
  { name: "sapphire", ion: "#91baff", dust: "#bac1f3", coma: "#c4dbff" },
] as const;

/** Premultiplied-looking soft edges without a large image or a postprocessing pass. */
function createRibbonTexture() {
  const width = 64;
  const height = 16;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const across = ((y + 0.5) / height) * 2 - 1;
    for (let x = 0; x < width; x++) {
      const along = x / (width - 1);
      const alpha =
        Math.pow(1 - along, 1.45) *
        Math.exp(-across * across * 5.5) *
        (1 - Math.pow(Math.abs(across), 4));
      const index = (y * width + x) * 4;
      data[index] = data[index + 1] = data[index + 2] = 255;
      data[index + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * One short visit at a time: a resolved core, curved ion ribbon and scattered
 * dust. All buffers are reused. The caller faces this local XY flight plane
 * toward the camera at the selected article's world position, so the path
 * stays outside the reading core even while the user orbits the star system.
 * This is a decorative mesh field, not a screen overlay or a hit target.
 */
function createSystemComet(options: {
  seed: string;
  scale: number;
  mobile: boolean;
}): CometField {
  const scale = Number.isFinite(options.scale)
    ? THREE.MathUtils.clamp(options.scale, 0.1, 5000)
    : 17;
  const random = seededRandom(`${options.seed}:system-visitor`);
  const palette = cometPalettes[Math.floor(random() * cometPalettes.length)];
  const initialAngle = random() * Math.PI * 2;
  const direction = random() > 0.5 ? 1 : -1;
  const duration = 6.2 + random() * 1.1;
  const cycle = 21 + random() * 6;
  const delay = 0.7 + random() * 0.55;
  const group = new THREE.Group();
  group.name = "peripheral-comet-field";
  group.userData.cometPalette = palette.name;
  group.userData.cometActive = false;
  group.userData.cometProgress = 0;
  const visitor = new THREE.Group();
  visitor.name = "peripheral-comet-0";
  group.add(visitor);
  const textures = [createComaTexture(), createRibbonTexture()];
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const bounds = new THREE.Sphere(
    new THREE.Vector3(),
    scale * (options.mobile ? 1.8 : 1.5),
  );

  const coreGeometry = new THREE.SphereGeometry(scale * 0.0058, 8, 6);
  const coreMaterial = new THREE.MeshBasicMaterial({
    color: "#effaff",
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const core = new THREE.Mesh(coreGeometry, coreMaterial);
  core.name = "comet-ice-nucleus";
  const comaMaterial = new THREE.SpriteMaterial({
    map: textures[0],
    color: palette.coma,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const coma = new THREE.Sprite(comaMaterial);
  coma.name = "comet-coma";
  coma.scale.setScalar(scale * 0.085);
  visitor.add(core, coma);
  geometries.add(coreGeometry);
  materials.add(coreMaterial);
  materials.add(comaMaterial);

  const segments = options.mobile ? 24 : 32;
  function makeRibbon(dust: boolean) {
    const geometry = new THREE.BufferGeometry();
    const positions = new THREE.BufferAttribute(
      new Float32Array((segments + 1) * 6),
      3,
    ).setUsage(THREE.DynamicDrawUsage);
    const uv = new Float32Array((segments + 1) * 4);
    const indices = new Uint16Array(segments * 6);
    for (let index = 0; index <= segments; index++) {
      uv.set([index / segments, 0, index / segments, 1], index * 4);
      if (index < segments) {
        const a = index * 2;
        indices.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], index * 6);
      }
    }
    geometry.setAttribute("position", positions);
    geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.boundingSphere = bounds;
    const material = new THREE.MeshBasicMaterial({
      map: textures[1],
      color: dust ? palette.dust : palette.ion,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const object = new THREE.Mesh(geometry, material);
    object.name = dust ? "comet-dust-ribbon" : "comet-ion-ribbon";
    visitor.add(object);
    geometries.add(geometry);
    materials.add(material);
    return { positions, material, dust };
  }
  const ribbons = [makeRibbon(true), makeRibbon(false)];
  const dustCount = options.mobile ? 16 : 24;
  const dustGeometry = new THREE.BufferGeometry();
  const dustPositions = new THREE.BufferAttribute(
    new Float32Array(dustCount * 3),
    3,
  ).setUsage(THREE.DynamicDrawUsage);
  const dustColors = new Float32Array(dustCount * 3);
  const dustColor = new THREE.Color(palette.dust);
  for (let index = 0; index < dustCount; index++) {
    const fade = Math.pow(1 - index / dustCount, 1.8);
    dustColors.set(
      [dustColor.r * fade, dustColor.g * fade, dustColor.b * fade],
      index * 3,
    );
  }
  dustGeometry.setAttribute("position", dustPositions);
  dustGeometry.setAttribute("color", new THREE.BufferAttribute(dustColors, 3));
  dustGeometry.boundingSphere = bounds;
  const dustMaterial = new THREE.PointsMaterial({
    map: textures[0],
    size: scale * 0.018,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const dust = new THREE.Points(dustGeometry, dustMaterial);
  dust.name = "comet-stardust";
  visitor.add(dust);
  geometries.add(dustGeometry);
  materials.add(dustMaterial);

  let motionTime = 0;
  let lastTime: number | undefined;
  let opacity = 1;
  let envelope = 0;
  let reduced = false;
  let disposed = false;

  function applyOpacity() {
    const alpha = opacity * envelope;
    group.visible = !reduced && opacity > 0.001;
    visitor.visible = !reduced && alpha > 0.001;
    group.userData.cometActive = group.visible && visitor.visible;
    coreMaterial.opacity = alpha * 0.96;
    comaMaterial.opacity = alpha * 0.9;
    ribbons[0].material.opacity = alpha * 0.55;
    ribbons[1].material.opacity = alpha * 0.9;
    dustMaterial.opacity = alpha * 0.54;
  }

  function updateMobileGeometry(progress: number, pass: number, z: number) {
    // On a narrow screen the article title and its controls extend below the
    // star. Keep EVERY visit in the quiet space below them: alternating its
    // direction never rotates this flight lane back through the reading hub.
    const travelDirection = direction * (pass % 2 === 0 ? 1 : -1);
    const travel = -0.45 + progress * 1.14;
    const laneHeight = 1.2 + Math.sin(pass * 2.399963) * 0.012;
    const headX = travelDirection * travel;
    core.position.set(
      scale * headX,
      -scale * (laneHeight + 0.14 * headX * headX),
      z,
    );
    coma.position.copy(core.position);
    for (const ribbon of ribbons) {
      for (let index = 0; index <= segments; index++) {
        const distance = index / segments;
        const x =
          travelDirection * (travel - distance * (ribbon.dust ? 0.46 : 0.52));
        const y = -(
          laneHeight +
          0.14 * x * x +
          (ribbon.dust ? 0.015 * distance * distance : 0)
        );
        const nx = 0.28 * x;
        const length = Math.hypot(nx, 1);
        const width =
          scale *
          (ribbon.dust ? 0.014 : 0.0044) *
          (0.45 + distance * 2.2) *
          Math.sqrt(1 - distance);
        const dx = (nx / length) * width;
        const dy = width / length;
        ribbon.positions.setXYZ(index * 2, scale * x - dx, scale * y - dy, z);
        ribbon.positions.setXYZ(
          index * 2 + 1,
          scale * x + dx,
          scale * y + dy,
          z,
        );
      }
      ribbon.positions.needsUpdate = true;
    }
    for (let index = 0; index < dustCount; index++) {
      const distance = (index + 0.4) / dustCount;
      const x = travelDirection * (travel - distance * 0.5);
      const scatter = Math.sin(index * 2.399 + progress * 3) * 0.008 * distance;
      dustPositions.setXYZ(
        index,
        scale * x,
        -scale *
          (laneHeight + 0.14 * x * x + 0.02 * distance * distance + scatter),
        z + scale * Math.cos(index * 1.7) * distance * 0.006,
      );
    }
    dustPositions.needsUpdate = true;
  }

  function updateVisitor() {
    const pass = Math.floor(motionTime / cycle);
    const age = (motionTime % cycle) - delay;
    const progress = THREE.MathUtils.clamp(age / duration, 0, 1);
    envelope =
      THREE.MathUtils.smoothstep(age, 0, 0.8) *
      (1 - THREE.MathUtils.smoothstep(age, duration - 1.5, duration));
    group.userData.cometProgress = progress;
    applyOpacity();
    if (!visitor.visible) return;
    // A new peripheral arc each visit. Radius always leaves a broad central
    // reading corridor; the tail bends outward instead of crossing the hub.
    const angle = initialAngle + pass * 2.399963 + direction * progress * 1.24;
    const radius = scale * (0.965 + Math.sin(angle * 2 + 0.7) * 0.022);
    const z = -scale * 0.23;
    if (options.mobile) {
      updateMobileGeometry(progress, pass, z);
      return;
    }
    core.position.set(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius * 0.83,
      z,
    );
    coma.position.copy(core.position);
    for (const ribbon of ribbons) {
      for (let index = 0; index <= segments; index++) {
        const distance = index / segments;
        const theta =
          angle - direction * distance * (ribbon.dust ? 0.49 : 0.57);
        const trailRadius =
          radius + scale * distance * distance * (ribbon.dust ? 0.032 : 0.012);
        const cosine = Math.cos(theta);
        const sine = Math.sin(theta);
        const x = cosine * trailRadius;
        const y = sine * trailRadius * 0.83;
        const nx = cosine * 0.83;
        const ny = sine;
        const length = Math.hypot(nx, ny);
        const width =
          scale *
          (ribbon.dust ? 0.014 : 0.0044) *
          (0.45 + distance * 2.2) *
          Math.sqrt(1 - distance);
        const dx = (nx / length) * width;
        const dy = (ny / length) * width;
        ribbon.positions.setXYZ(index * 2, x - dx, y - dy, z);
        ribbon.positions.setXYZ(index * 2 + 1, x + dx, y + dy, z);
      }
      ribbon.positions.needsUpdate = true;
    }
    for (let index = 0; index < dustCount; index++) {
      const distance = (index + 0.4) / dustCount;
      const theta = angle - direction * distance * 0.55;
      const scatter = Math.sin(index * 2.399 + progress * 3) * 0.014 * distance;
      const trailRadius =
        radius + scale * (distance * distance * 0.04 + scatter);
      dustPositions.setXYZ(
        index,
        Math.cos(theta) * trailRadius,
        Math.sin(theta) * trailRadius * 0.83,
        z + scale * Math.cos(index * 1.7) * distance * 0.006,
      );
    }
    dustPositions.needsUpdate = true;
  }

  group.traverse((object) => {
    object.userData.decoration = true;
    object.raycast = () => {};
  });
  updateVisitor();
  return {
    group,
    update(time, reducedMotion, paused = false) {
      if (disposed) return;
      const current = Number.isFinite(time) ? time : (lastTime ?? 0);
      const delta =
        lastTime === undefined
          ? 0
          : THREE.MathUtils.clamp(current - lastTime, 0, 0.1);
      lastTime = current;
      reduced = reducedMotion;
      if (reducedMotion || paused || delta === 0) {
        applyOpacity();
        return;
      }
      motionTime += delta;
      updateVisitor();
    },
    setOpacity(value) {
      if (disposed) return;
      opacity = Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0;
      applyOpacity();
    },
    restart() {
      if (disposed) return;
      motionTime = 0;
      lastTime = undefined;
      updateVisitor();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      textures.forEach((texture) => texture.dispose());
      group.removeFromParent();
      group.clear();
    },
  };
}
