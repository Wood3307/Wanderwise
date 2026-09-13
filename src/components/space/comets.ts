import * as THREE from "three";

export interface CometField {
  group: THREE.Group;
  update: (time: number, reducedMotion: boolean, paused?: boolean) => void;
  setOpacity: (opacity: number) => void;
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
}): CometField {
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
