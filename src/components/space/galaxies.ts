import * as THREE from 'three';

/** Morphology describes geometry, rather than a different tint on the same cloud. */
export type GalaxyMorphology = 'spiral' | 'barred-spiral' | 'elliptical' | 'lenticular' | 'irregular';

export interface GalaxySpec {
  kind: GalaxyMorphology;
  label: string;
  radius: number;
  rotation: THREE.Euler;
  phase: number;
  arms: number;
  winding: number;
  flattening: number;
}

export interface GalaxyOptions {
  seed: string;
  color: string;
  relevance: number;
  mobile: boolean;
  pixelRatio: number;
}

const TAU = Math.PI * 2;
const kinds: GalaxyMorphology[] = ['barred-spiral', 'elliptical', 'lenticular', 'spiral', 'irregular'];
const labels: Record<GalaxyMorphology, string> = {
  spiral: '螺旋星系', 'barred-spiral': '棒旋星系', elliptical: '椭圆星系',
  lenticular: '透镜星系', irregular: '不规则星系',
};

function randomFrom(seed: string) {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const normal = (random: () => number) => Math.sqrt(-2 * Math.log(Math.max(0.000001, random()))) * Math.cos(TAU * random());

export function getGalaxySpec(id: string, index: number): GalaxySpec {
  const random = randomFrom(id);
  const kind = kinds[((index % kinds.length) + kinds.length) % kinds.length];
  return {
    kind, label: labels[kind], radius: 54,
    // The disk starts in XY. A lenticular galaxy is deliberately seen obliquely,
    // showing its thin disk and bulge, while retaining usable answer spacing.
    rotation: new THREE.Euler(
      kind === 'lenticular' ? 1.14 : (random() - 0.5) * 0.72,
      (random() - 0.5) * 0.46,
      kind === 'lenticular' ? -0.24 + random() * 0.3 : (random() - 0.5) * 0.8,
    ),
    phase: random() * TAU,
    arms: kind === 'barred-spiral' ? 2 : 3,
    winding: kind === 'barred-spiral' ? 5.7 : 6.1 + random() * 0.65,
    flattening: kind === 'elliptical' ? 0.66 + random() * 0.1 : 1,
  };
}

/** Shared by arm stars, dark dust ribbons and answer stars. */
function armPoint(spec: GalaxySpec, radius: number, arm: number, angularOffset = 0): THREE.Vector3 {
  const t = radius / spec.radius;
  const barEnd = spec.kind === 'barred-spiral' ? 0.28 : 0.1;
  const angle = spec.phase + (arm * TAU) / spec.arms + Math.max(0, t - barEnd) * spec.winding + angularOffset;
  return new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
}

function irregularClump(spec: GalaxySpec, index: number): THREE.Vector3 {
  const angle = spec.phase + index * 2.399963;
  const radius = spec.radius * [0.64, 0.49, 0.79, 0.56, 0.76, 0.36][index % 6];
  return new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.83, Math.sin(index * 2.1) * 5);
}

export function answerLocalPosition(spec: GalaxySpec, index: number, count: number): THREE.Vector3 {
  const safeCount = Math.max(1, count);
  const safeIndex = Math.max(0, index);
  if (spec.kind === 'spiral' || spec.kind === 'barred-spiral') {
    const tiers = Math.ceil(safeCount / spec.arms);
    const tier = Math.floor(safeIndex / spec.arms);
    const radius = spec.radius * (0.49 + 0.4 * (tier + 0.5) / tiers);
    const position = armPoint(spec, radius, safeIndex % spec.arms);
    position.z = 1.3 + Math.sin(safeIndex * 1.9) * 1.1;
    return position;
  }
  if (spec.kind === 'irregular') {
    const point = irregularClump(spec, safeIndex % 6);
    if (safeIndex >= 6) point.multiplyScalar(1 + Math.floor(safeIndex / 6) * 0.16);
    return point;
  }
  const angle = spec.phase + ((safeIndex + 0.2) / safeCount) * TAU;
  const radius = spec.radius * (safeCount < 3 ? 0.68 : 0.65 + (safeIndex % 2) * 0.17);
  return new THREE.Vector3(
    Math.cos(angle) * radius,
    Math.sin(angle) * radius * spec.flattening,
    spec.kind === 'lenticular' ? 1.2 : Math.sin(angle * 2.3) * 5,
  );
}

interface ParticleData { positions: number[]; colors: number[]; sizes: number[]; }
const particles = (): ParticleData => ({ positions: [], colors: [], sizes: [] });
function addParticle(data: ParticleData, position: THREE.Vector3, color: THREE.Color, size: number) {
  data.positions.push(position.x, position.y, position.z);
  data.colors.push(color.r, color.g, color.b);
  data.sizes.push(size);
}

function particleMaterial(pixelRatio: number, soft: boolean, dust = false) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    blending: dust ? THREE.NormalBlending : THREE.AdditiveBlending,
    uniforms: { uOpacity: { value: 1 }, uTime: { value: 0 }, uPixelRatio: { value: pixelRatio } },
    vertexShader: `
      attribute float size;
      attribute vec3 color;
      varying vec3 vColor;
      varying vec2 vCloudOffset;
      uniform float uPixelRatio;
      uniform float uTime;
      void main() {
        vColor = color;
        vCloudOffset = position.xy * 0.37;
        vec4 point = modelViewMatrix * vec4(position, 1.0);
        float scintillation = 0.985 + 0.015 * sin(uTime * 0.36 + position.x * 1.7 + position.z);
        gl_PointSize = clamp(size * (550.0 / max(5.0, -point.z)) * uPixelRatio * scintillation, ${soft ? '1.0, 230.0' : '0.95, 22.0'} * uPixelRatio);
        gl_Position = projectionMatrix * point;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying vec2 vCloudOffset;
      uniform float uOpacity;
      float noiseHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
      float cloudNoise(vec2 p) {
        vec2 cell = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(noiseHash(cell), noiseHash(cell + vec2(1, 0)), f.x), mix(noiseHash(cell + vec2(0, 1)), noiseHash(cell + vec2(1)), f.x), f.y);
      }
      void main() {
        float radius = length(gl_PointCoord - vec2(0.5));
        if (radius > 0.5) discard;
        float alpha = ${soft ? 'exp(-radius * radius * 16.0) * (1.0 - smoothstep(0.32, 0.5, radius))' : 'exp(-radius * radius * 48.0) + exp(-radius * radius * 13.0) * 0.17'};
        ${soft ? 'vec2 cloudUv = gl_PointCoord * 6.0 + vCloudOffset; alpha *= (0.5 + 0.5 * cloudNoise(cloudUv)) * (0.6 + 0.4 * cloudNoise(cloudUv * 3.3));' : ''}
        gl_FragColor = vec4(vColor, alpha * uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

function particleCloud(data: ParticleData, material: THREE.ShaderMaterial) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(data.colors, 3));
  geometry.setAttribute('size', new THREE.Float32BufferAttribute(data.sizes, 1));
  return new THREE.Points(geometry, material);
}

function nucleusTexture() {
  const side = 96;
  const pixels = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const r = Math.hypot((x + 0.5) / side - 0.5, (y + 0.5) / side - 0.5) * 2;
      const alpha = Math.exp(-r * r * 9) * Math.pow(Math.max(0, 1 - r), 1.5);
      const index = (y * side + x) * 4;
      pixels[index] = pixels[index + 1] = pixels[index + 2] = 255;
      pixels[index + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new THREE.DataTexture(pixels, side, side, THREE.RGBAFormat);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function createGalaxy(spec: GalaxySpec, options: GalaxyOptions) {
  const group = new THREE.Group();
  group.name = `galaxy:${options.seed}:${spec.kind}`;
  const random = randomFrom(`${options.seed}:morphology`);
  const brightness = 0.2 + Math.pow(THREE.MathUtils.clamp(options.relevance > 1 ? options.relevance / 100 : options.relevance, 0, 1), 2.25) * 1.45;
  const cream = new THREE.Color('#ffe6bd');
  const oldStars = new THREE.Color('#e9c8a1');
  const blue = new THREE.Color('#9abbec').lerp(new THREE.Color(options.color), 0.15);
  const ice = new THREE.Color('#d5e7f5');
  const pink = new THREE.Color('#d78dac');
  const starData = particles(), hazeData = particles(), dustData = particles();
  const starCount = options.mobile ? 2500 : 5000;

  for (let i = 0; i < starCount; i++) {
    let position: THREE.Vector3;
    let color: THREE.Color;
    const coreFraction = spec.kind === 'elliptical' ? 1 : spec.kind === 'lenticular' ? 0.43 : spec.kind === 'irregular' ? 0.13 : 0.25;
    const inCore = random() < coreFraction;
    if (inCore) {
      const radius = spec.radius * Math.pow(random(), spec.kind === 'elliptical' ? 1.5 : 2) * (spec.kind === 'elliptical' ? 0.94 : 0.34);
      const angle = random() * TAU;
      const z = random() * 2 - 1;
      const xy = Math.sqrt(1 - z * z);
      position = new THREE.Vector3(Math.cos(angle) * radius * xy, Math.sin(angle) * radius * xy * spec.flattening, z * radius * 0.57);
      color = oldStars.clone().lerp(cream, random() * 0.75);
    } else if (spec.kind === 'spiral' || spec.kind === 'barred-spiral') {
      const radius = spec.radius * (0.13 + Math.pow(random(), 0.67) * 0.87);
      const arm = Math.floor(random() * spec.arms);
      const t = radius / spec.radius;
      const scatter = random() < 0.16 ? random() * TAU : normal(random) * (0.05 + 0.09 * t);
      position = armPoint(spec, radius, arm, scatter);
      position.z = normal(random) * (0.42 + (1 - t) * 1.05);
      color = blue.clone().lerp(ice, random() * 0.75);
      if (random() < 0.12) color.lerp(pink, 0.7);
      // Bright older stars in the physical bar join the two winding arms.
      if (spec.kind === 'barred-spiral' && random() < 0.2) {
        const along = (random() * 2 - 1) * spec.radius * 0.31;
        const across = normal(random) * 1.15;
        position.set(Math.cos(spec.phase) * along - Math.sin(spec.phase) * across, Math.sin(spec.phase) * along + Math.cos(spec.phase) * across, normal(random) * 1.1);
        color = cream.clone().lerp(oldStars, random());
      }
    } else if (spec.kind === 'lenticular') {
      const radius = spec.radius * Math.sqrt(random());
      const angle = random() * TAU;
      position = new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, normal(random) * 0.5);
      color = oldStars.clone().lerp(ice, random() * 0.48);
    } else {
      const clump = Math.floor(random() * 6);
      position = irregularClump(spec, clump);
      const spread = 3.6 + (clump % 3) * 1.9;
      position.add(new THREE.Vector3(normal(random) * spread, normal(random) * spread * 0.8, normal(random) * 2.5));
      color = blue.clone().lerp(clump % 3 === 0 ? pink : ice, 0.35 + random() * 0.45);
    }
    const intensity = 0.35 + random() * 0.65;
    color.multiplyScalar(intensity);
    const rarity = random();
    const size = rarity > 0.996 ? 1.4 + random() * 0.75 : rarity > 0.91 ? 0.62 + random() * 0.5 : 0.28 + random() * 0.43;
    addParticle(starData, position, color, size);
  }

  // Soft interstellar light traces the same volume as the stellar population.
  // Separate dark lanes interrupt the arms; they are geometry, not a flat decal.
  if (spec.kind === 'spiral' || spec.kind === 'barred-spiral') {
    const samples = options.mobile ? 90 : 155;
    for (let arm = 0; arm < spec.arms; arm++) {
      for (let i = 0; i < samples; i++) {
        const armStart = spec.kind === 'barred-spiral' ? 0.34 : 0.22;
        const radius = spec.radius * (armStart + (i / (samples - 1)) * (0.97 - armStart));
        const position = armPoint(spec, radius, arm);
        position.x += normal(random) * 3;
        position.y += normal(random) * 3;
        position.z = -0.8;
        const color = blue.clone().lerp(cream, Math.max(0, 1 - radius / (spec.radius * 0.48)) * 0.35);
        const densityWeight = 0.28 + (radius / spec.radius) * 0.72;
        const cloudBreakup = 0.62 + 0.38 * Math.sin(i * 0.31 + arm * 1.7);
        addParticle(hazeData, position, color.multiplyScalar((0.062 + random() * 0.062) * densityWeight * cloudBreakup), 28 + random() * 19);
        const dustPosition = armPoint(spec, radius, arm, -0.12);
        dustPosition.z = 0.7;
        if (radius > spec.radius * 0.34) addParticle(dustData, dustPosition, new THREE.Color('#080b11'), 7.5 + random() * 3.5);
        if (i % 9 === 2) {
          const knot = position.clone().add(new THREE.Vector3(normal(random) * 0.9, normal(random) * 0.9, 0.8));
          addParticle(hazeData, knot, pink.clone().multiplyScalar(0.48), 5.5 + random() * 2.5);
        }
      }
    }
    if (spec.kind === 'barred-spiral') {
      for (let i = 0; i < 36; i++) {
        const along = (i / 35 * 2 - 1) * spec.radius * 0.29;
        const fade = Math.exp(-Math.pow(along / (spec.radius * 0.19), 2));
        addParticle(hazeData, new THREE.Vector3(Math.cos(spec.phase) * along, Math.sin(spec.phase) * along, 0), cream.clone().multiplyScalar(0.11 * fade), 23);
      }
    }
    for (let i = 0; i < (options.mobile ? 180 : 360); i++) {
      const radius = spec.radius * Math.sqrt((i + 0.5) / (options.mobile ? 180 : 360));
      const angle = i * 2.399963;
      const color = blue.clone().lerp(oldStars, Math.max(0, 1 - radius / (spec.radius * 0.7)));
      addParticle(hazeData, new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, -2), color.multiplyScalar(0.013), 43 + random() * 10);
    }
  } else if (spec.kind === 'lenticular') {
    for (let i = 0; i < 530; i++) {
      const angle = i * 2.399963;
      const radius = spec.radius * Math.sqrt((i + 0.5) / 530);
      addParticle(hazeData, new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, -0.65), oldStars.clone().multiplyScalar(0.06 * Math.exp(-radius * radius / (spec.radius * spec.radius))), 43);
    }
  } else if (spec.kind === 'elliptical') {
    for (let i = 0; i < 550; i++) {
      const radius = spec.radius * Math.sqrt((i + 0.5) / 550) * 0.94;
      const angle = i * 2.399963;
      const intensity = 0.18 * Math.exp(-radius * radius / (spec.radius * spec.radius) * 4.5);
      addParticle(hazeData, new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius * spec.flattening, Math.sin(i * 0.5) * 2), oldStars.clone().multiplyScalar(intensity), 40);
    }
  } else {
    for (let clump = 0; clump < 6; clump++) {
      for (let i = 0; i < 38; i++) {
        const position = irregularClump(spec, clump).add(new THREE.Vector3(normal(random) * 4.8, normal(random) * 3.9, normal(random) * 1.5));
        addParticle(hazeData, position, (clump % 3 === 0 ? pink : blue).clone().multiplyScalar(0.23), 18 + random() * 9);
        if (i % 3 === 0) addParticle(dustData, position.clone().add(new THREE.Vector3(-2.5, -1, 2)), new THREE.Color('#080b12'), 7);
      }
    }
  }

  const materialEntries: { material: THREE.ShaderMaterial | THREE.SpriteMaterial; opacity: number }[] = [];
  const extraGeometries: THREE.BufferGeometry[] = [];
  const hazeMaterial = particleMaterial(options.pixelRatio, true);
  const starsMaterial = particleMaterial(options.pixelRatio, false);
  const dustMaterial = particleMaterial(options.pixelRatio, true, true);
  const haze = particleCloud(hazeData, hazeMaterial);
  const stars = particleCloud(starData, starsMaterial);
  const dust = particleCloud(dustData, dustMaterial);
  haze.renderOrder = 0;
  stars.renderOrder = 2;
  dust.renderOrder = 3;
  group.add(haze, stars, dust);
  materialEntries.push({ material: hazeMaterial, opacity: brightness * 0.23 }, { material: starsMaterial, opacity: brightness * 0.86 }, { material: dustMaterial, opacity: 0.085 });

  if (spec.kind === 'lenticular') {
    // Extinction lies IN the disk: it becomes a fine band from an edge-on view.
    // Billboarded dust points would retain their diameter and form a black pill.
    const geometry = new THREE.RingGeometry(spec.radius * 0.49, spec.radius * 0.76, 128);
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uOpacity: { value: 0.2 }, uTime: { value: 0 } },
      vertexShader: `varying vec2 vDiskPosition; void main() { vDiskPosition = position.xy / ${spec.radius.toFixed(1)}; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        varying vec2 vDiskPosition; uniform float uOpacity;
        void main() {
          float radius = length(vDiskPosition);
          float band = smoothstep(0.49, 0.58, radius) * (1.0 - smoothstep(0.66, 0.76, radius));
          gl_FragColor = vec4(vec3(0.018, 0.022, 0.03), band * uOpacity);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    const extinction = new THREE.Mesh(geometry, material);
    extinction.position.z = 0.85;
    extinction.renderOrder = 3;
    group.add(extinction);
    extraGeometries.push(geometry);
    materialEntries.push({ material, opacity: 0.34 });
  }

  const texture = nucleusTexture();
  if (spec.kind !== 'irregular') {
    const bulge = spec.kind === 'elliptical' ? 1.5 : spec.kind === 'lenticular' ? 1.3 : 1;
    for (const [size, opacity, tint] of [[45 * bulge, 0.18, '#e6bd92'], [19 * bulge, 0.4, '#ffe3b8'], [5.5, 0.72, '#fff2d8']] as const) {
      const material = new THREE.SpriteMaterial({ map: texture, color: tint, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(size, size * (spec.kind === 'elliptical' ? spec.flattening : 1), 1);
      sprite.renderOrder = 1;
      group.add(sprite);
      materialEntries.push({ material, opacity: opacity * brightness });
    }
  } else {
    const material = new THREE.SpriteMaterial({ map: texture, color: '#b5d6f4', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(11, 11, 1);
    group.add(sprite);
    materialEntries.push({ material, opacity: brightness * 0.25 });
  }

  let disposed = false;
  const setOpacity = (opacity: number) => {
    const visibleOpacity = THREE.MathUtils.clamp(opacity, 0, 1);
    group.visible = visibleOpacity > 0.001;
    for (const entry of materialEntries) {
      if (entry.material instanceof THREE.ShaderMaterial) entry.material.uniforms.uOpacity.value = entry.opacity * visibleOpacity;
      else entry.material.opacity = entry.opacity * visibleOpacity;
    }
  };
  setOpacity(1);
  group.userData.morphology = spec.kind;
  group.userData.particleCount = starData.sizes.length + hazeData.sizes.length + dustData.sizes.length;

  return {
    group,
    setOpacity,
    update(time: number, reducedMotion: boolean) {
      for (const { material } of materialEntries) {
        if (material instanceof THREE.ShaderMaterial) material.uniforms.uTime.value = reducedMotion ? 0 : time;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const object of [stars, haze, dust]) object.geometry.dispose();
      for (const geometry of extraGeometries) geometry.dispose();
      for (const { material } of materialEntries) material.dispose();
      texture.dispose();
      group.clear();
    },
  };
}
