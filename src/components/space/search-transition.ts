import * as THREE from "three";

export type SearchTransitionPhase = "idle" | "collapse" | "wait" | "birth";

export interface TransitionAnchor {
  id: string;
  position: THREE.Vector3;
  color?: string;
  /** Visible body radius in the same world units as position. */
  radius?: number;
  /** Preserved visible stellar geometry, packed world-space xyz coordinates. */
  fragmentPositions?: Float32Array;
  /** Optional matching linear RGB colors from the original geometry. */
  fragmentColors?: Float32Array;
}

export interface SearchTransitionFrame {
  phase: SearchTransitionPhase;
  progress: number;
  time: number;
  camera: THREE.PerspectiveCamera;
  /** World point projecting onto the existing background black hole. */
  target: THREE.Vector3;
  /** World point at the center of the incoming cluster. */
  center: THREE.Vector3;
  /** Snapshot positions, never the positions already distorted by this effect. */
  anchors: readonly TransitionAnchor[];
}

const TAU = Math.PI * 2;
const clamp = (value: number) =>
  Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0;
const smooth = (value: number, start = 0, end = 1) => {
  const p = clamp((value - start) / Math.max(0.000001, end - start));
  return p * p * (3 - 2 * p);
};

function phaseFor(progress: number, index: number, count: number) {
  const delay = (Math.max(0, index) / Math.max(1, count - 1)) * 0.095;
  return clamp((clamp(progress) - delay) / (1 - delay));
}

/**
 * Gravity draws detached material directly inward. Angular momentum only
 * becomes apparent very close to capture, where the remaining radius is tiny.
 * A rotation of an exactly shrinking radius guarantees monotonic approach;
 * there is no initial sideways orbit or bend away from the black hole.
 */
function infall(
  out: THREE.Vector3,
  source: THREE.Vector3,
  target: THREE.Vector3,
  normal: THREE.Vector3,
  progress: number,
) {
  const p = clamp(progress);
  if (p === 0) return out.copy(source);
  if (p === 1) return out.copy(target);
  const remaining = 1 - Math.pow(p, 1.8);
  const dx = source.x - target.x;
  const dy = source.y - target.y;
  const dz = source.z - target.z;
  const axial = dx * normal.x + dy * normal.y + dz * normal.z;
  const px = dx - normal.x * axial;
  const py = dy - normal.y * axial;
  const pz = dz - normal.z * axial;
  const tx = normal.y * pz - normal.z * py;
  const ty = normal.z * px - normal.x * pz;
  const tz = normal.x * py - normal.y * px;
  const turn = smooth(p, 0.7, 1) * 0.22 + smooth(p, 0.92, 1) * 0.62;
  const radial = remaining * Math.cos(turn);
  const tangential = remaining * Math.sin(turn);
  out.set(
    target.x + px * radial + tx * tangential + normal.x * axial * remaining,
    target.y + py * radial + ty * tangential + normal.y * axial * remaining,
    target.z + pz * radial + tz * tangential + normal.z * axial * remaining,
  );
  return out;
}

export interface CollapsePose {
  position: THREE.Vector3;
  scale: THREE.Vector3;
  rotation: THREE.Quaternion;
  opacity: number;
  progress: number;
}

/** Apply to a preserved base transform; do not repeatedly multiply prior frames. */
export function sampleCollapse(options: {
  position: THREE.Vector3;
  target: THREE.Vector3;
  normal: THREE.Vector3;
  /** Accepted for the preserved caller contract; whole bodies no longer turn. */
  orientation?: THREE.Quaternion;
  progress: number;
  index: number;
  count: number;
}): CollapsePose {
  const p = phaseFor(options.progress, options.index, options.count);
  const normal = options.normal.clone();
  if (normal.lengthSq() < 0.000001) normal.set(0, 0, -1);
  normal.normalize();
  const shrink = Math.max(0, 1 - Math.pow(p, 2.4));
  const point = infall(new THREE.Vector3(), options.position, options.target, normal, p);
  return {
    position: point,
    // The intact galaxy dissolves early instead of rotating into a stretched
    // cardboard silhouette. Actual sampled stars carry the rest of the fall.
    scale: new THREE.Vector3(shrink, shrink, shrink),
    rotation: new THREE.Quaternion(),
    opacity: 1 - smooth(p, 0.035, 0.43),
    progress: p,
  };
}

/** Calm, staggered assembly behind the single expanding supernova wave. */
export function sampleBirth(progress: number, index: number, count: number) {
  const p = clamp(progress);
  const delay = 0.12 + (Math.max(0, index) / Math.max(1, count - 1)) * 0.18;
  const assembly = smooth(p, delay, 0.93);
  return {
    scale: assembly === 0 ? 0 : 0.035 + 0.965 * (1 - Math.pow(1 - assembly, 2)),
    opacity: smooth(p, delay, Math.min(0.88, delay + 0.46)),
  };
}

function seededRandom(seed: string) {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const pointVertex = `
  attribute float size;
  attribute float intensity;
  attribute vec3 color;
  varying float vIntensity;
  varying vec3 vColor;
  uniform float uPixelRatio;
  void main() {
    vIntensity = intensity;
    vColor = color;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(size * 500.0 / max(1.0, -mv.z), 0.75, 18.0) * uPixelRatio;
    gl_Position = projectionMatrix * mv;
  }
`;
const pointFragment = `
  varying float vIntensity;
  varying vec3 vColor;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float r = length(p);
    if (r > 0.5) discard;
    float core = exp(-r * r * 64.0);
    float halo = exp(-r * r * 13.0) * 0.32;
    float cross = exp(-abs(p.x) * 74.0 - abs(p.y) * 12.0)
                + exp(-abs(p.y) * 74.0 - abs(p.x) * 12.0);
    gl_FragColor = vec4(vColor, (core + halo + cross * 0.09) * vIntensity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
const planeVertex = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

function transparentShader(options: THREE.ShaderMaterialParameters) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    ...options,
  });
}

export interface SearchTransitionEffect {
  group: THREE.Group;
  update: (frame: SearchTransitionFrame) => void;
  dispose: () => void;
}

/**
 * Four fixed draw batches: small stellar fragments, two-sided tidal silk,
 * the existing black-hole's accretion glow, and one supernova shock front.
 * No textures, network requests, per-frame allocations, timers or hit targets.
 */
export function createSearchTransition(options: {
  mobile: boolean;
  pixelRatio?: number;
}): SearchTransitionEffect {
  const group = new THREE.Group();
  group.name = "knowledge-search-transition";
  group.visible = false;
  // Keep the praised supernova's seeds and draw count exactly as before. Infall
  // adds two trailing glints per grain in the same fixed GPU draw batch.
  const birthParticleCount = options.mobile ? 660 : 1560;
  const particleCount = birthParticleCount * 3;
  const maxStreams = options.mobile ? 10 : 20;
  const ribbonCount = options.mobile ? 2 : 3;
  const segments = options.mobile ? 26 : 38;
  const random = seededRandom("wanderwise-tidal-fragments-v8");
  const seeds = Array.from({ length: birthParticleCount }, () => ({
    angle: random() * TAU,
    radial: Math.sqrt(random()),
    depth: random() - 0.5,
    phase: random(),
    speed: 0.45 + random() * 0.8,
    size: 0.55 + Math.pow(random(), 2.5) * 2.8,
  }));
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const particleGeometry = new THREE.BufferGeometry();
  const positions = new THREE.BufferAttribute(new Float32Array(particleCount * 3), 3)
    .setUsage(THREE.DynamicDrawUsage);
  const colors = new THREE.BufferAttribute(new Float32Array(particleCount * 3), 3)
    .setUsage(THREE.DynamicDrawUsage);
  const sizes = new THREE.BufferAttribute(new Float32Array(particleCount), 1)
    .setUsage(THREE.DynamicDrawUsage);
  const intensities = new THREE.BufferAttribute(new Float32Array(particleCount), 1)
    .setUsage(THREE.DynamicDrawUsage);
  particleGeometry.setAttribute("position", positions);
  particleGeometry.setAttribute("color", colors);
  particleGeometry.setAttribute("size", sizes);
  particleGeometry.setAttribute("intensity", intensities);
  const particleMaterial = transparentShader({
    uniforms: { uPixelRatio: { value: Math.min(2, Math.max(1, options.pixelRatio || 1)) } },
    vertexShader: pointVertex,
    fragmentShader: pointFragment,
  });
  const fragments = new THREE.Points(particleGeometry, particleMaterial);
  fragments.name = "tidal-stellar-fragments";
  group.add(fragments);
  geometries.add(particleGeometry);
  materials.add(particleMaterial);

  const ribbonGeometry = new THREE.BufferGeometry();
  const ribbonVertices = maxStreams * ribbonCount * segments * 6;
  const ribbonPositions = new THREE.BufferAttribute(new Float32Array(ribbonVertices * 3), 3)
    .setUsage(THREE.DynamicDrawUsage);
  const ribbonColors = new THREE.BufferAttribute(new Float32Array(ribbonVertices * 3), 3)
    .setUsage(THREE.DynamicDrawUsage);
  const ribbonIntensities = new THREE.BufferAttribute(new Float32Array(ribbonVertices), 1)
    .setUsage(THREE.DynamicDrawUsage);
  const ribbonEdges = new THREE.BufferAttribute(new Float32Array(ribbonVertices), 1);
  const ribbonFlow = new THREE.BufferAttribute(new Float32Array(ribbonVertices), 1)
    .setUsage(THREE.DynamicDrawUsage);
  ribbonGeometry.setAttribute("position", ribbonPositions);
  ribbonGeometry.setAttribute("color", ribbonColors);
  ribbonGeometry.setAttribute("intensity", ribbonIntensities);
  ribbonGeometry.setAttribute("edge", ribbonEdges);
  ribbonGeometry.setAttribute("flow", ribbonFlow);
  const ribbonMaterial = transparentShader({
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      attribute vec3 color;
      attribute float intensity;
      attribute float edge;
      attribute float flow;
      varying vec3 vColor;
      varying float vIntensity;
      varying float vEdge;
      varying float vFlow;
      void main() {
        vColor = color; vIntensity = intensity;
        vEdge = edge; vFlow = flow;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vIntensity;
      varying float vEdge;
      varying float vFlow;
      uniform float uTime;
      void main() {
        float feather = exp(-vEdge * vEdge * 5.5) * (1.0 - smoothstep(0.74, 1.0, abs(vEdge)));
        float knots = 0.62 + 0.24 * sin(vFlow * 44.0 - uTime * 21.0)
                           + 0.14 * sin(vFlow * 93.0 - uTime * 34.0);
        gl_FragColor = vec4(vColor, vIntensity * feather * knots);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const ribbons = new THREE.Mesh(ribbonGeometry, ribbonMaterial);
  ribbons.name = "tidal-accretion-silk";
  group.add(ribbons);
  geometries.add(ribbonGeometry);
  materials.add(ribbonMaterial);

  const planeGeometry = new THREE.PlaneGeometry(1, 1);
  geometries.add(planeGeometry);
  const horizonMaterial = transparentShader({
    vertexShader: planeVertex,
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uStorm: { value: 0 } },
    fragmentShader: `
      varying vec2 vUv;
      uniform float uTime;
      uniform float uOpacity;
      uniform float uStorm;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        p = mat2(0.978, -0.208, 0.208, 0.978) * p;
        float circle = length(p);
        float angle = atan(p.y, p.x);
        float ring = exp(-pow((circle - 0.30) * 46.0, 2.0));
        float lens = exp(-pow((length(vec2(p.x, p.y * 2.9)) - 0.32) * 25.0, 2.0));
        float flow = 0.70 + 0.30 * sin(angle * 3.0 - uTime * 2.8 + circle * 18.0);
        float veil = exp(-circle * circle * 7.0) * smoothstep(0.23, 0.32, circle) * 0.16;
        float beaming = 0.44 + 0.56 * smoothstep(-0.8, 0.65, p.x);
        // Inward streaks grow into a ragged, shearing accretion eye. The dark
        // center stays clear, while the outer dust feeds the pre-existing rim.
        float feedAngle = angle * 6.0 + log(max(circle, 0.08)) * 14.0 + uTime * 7.5;
        float striations = pow(0.5 + 0.5 * sin(feedAngle), 9.0)
                         * (0.64 + 0.36 * sin(angle * 17.0 - uTime * 3.0 + circle * 36.0));
        float feeding = smoothstep(0.26, 0.36, circle) * (1.0 - smoothstep(0.42, 0.94, circle));
        float storm = (striations * 0.30 + exp(-pow((circle - 0.36) * 8.0, 2.0)) * 0.06) * feeding;
        float alpha = (ring * 0.32 + lens * 0.48 + veil) * beaming * flow
                    + storm * uStorm;
        vec3 color = mix(vec3(0.30, 0.65, 1.0), vec3(1.0, 0.84, 0.60), smoothstep(-0.2, 0.2, p.x));
        gl_FragColor = vec4(color, alpha * uOpacity * (1.0 - smoothstep(0.8, 1.0, circle)));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const horizon = new THREE.Mesh(planeGeometry, horizonMaterial);
  horizon.name = "existing-black-hole-accretion";
  group.add(horizon);
  materials.add(horizonMaterial);
  const novaMaterial = transparentShader({
    vertexShader: planeVertex,
    uniforms: { uProgress: { value: 0 } },
    fragmentShader: `
      varying vec2 vUv;
      uniform float uProgress;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        float t = uProgress;
        float ignite = smoothstep(0.0, 0.07, t) * (1.0 - smoothstep(0.13, 0.42, t));
        float core = exp(-r * r / (0.0012 + t * 0.004)) * ignite;
        float corona = exp(-r * r / (0.018 + t * 0.025)) * ignite * 0.23;
        float front = 0.018 + 0.85 * (1.0 - pow(1.0 - t, 1.3));
        float width = 0.005 + t * 0.035;
        float wave = exp(-pow((r - front) / width, 2.0));
        float angle = atan(p.y, p.x);
        float filaments = 0.77 + 0.15 * sin(angle * 11.0 + r * 42.0) + 0.08 * sin(angle * 27.0);
        float waveFade = smoothstep(0.025, 0.14, t) * (1.0 - smoothstep(0.22, 0.96, t));
        float rays = exp(-abs(p.y) * 170.0) * exp(-abs(p.x) * 4.8)
                   + exp(-abs(p.x) * 210.0) * exp(-abs(p.y) * 11.0) * 0.3;
        vec3 warm = vec3(1.0, 0.92, 0.76);
        vec3 ice = mix(vec3(0.45, 0.70, 1.0), vec3(0.75, 0.59, 1.0), 0.5 + 0.5 * sin(angle * 2.0));
        float alpha = core * 0.80 + corona + wave * filaments * waveFade * 0.26 + rays * ignite * 0.25;
        vec3 color = mix(ice, warm, clamp(core + corona + rays * ignite, 0.0, 1.0));
        gl_FragColor = vec4(color, alpha * (1.0 - smoothstep(0.88, 1.0, r)));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const nova = new THREE.Mesh(planeGeometry, novaMaterial);
  nova.name = "single-supernova-shock-front";
  group.add(nova);
  materials.add(novaMaterial);

  const normal = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const source = new THREE.Vector3();
  const point = new THREE.Vector3();
  const point2 = new THREE.Vector3();
  const side = new THREE.Vector3();
  const color = new THREE.Color();
  const warm = new THREE.Color("#fff0cb");
  const ice = new THREE.Color("#83c5ff");
  const violet = new THREE.Color("#bea0fa");
  let disposed = false;

  function fragmentSource(anchor: TransitionAnchor, sample: number, extent: number, seed: typeof seeds[number]) {
    const packed = anchor.fragmentPositions;
    const count = packed ? Math.floor(packed.length / 3) : 0;
    const offset = count ? (sample % count) * 3 : -1;
    if (packed && offset >= 0 && Number.isFinite(packed[offset])
      && Number.isFinite(packed[offset + 1]) && Number.isFinite(packed[offset + 2])) {
      source.set(packed[offset], packed[offset + 1], packed[offset + 2]);
      return offset;
    }
    const radius = Math.min(extent * 0.2, Math.max(extent * 0.009, anchor.radius ?? extent * 0.065));
    source.copy(anchor.position)
      .addScaledVector(right, Math.cos(seed.angle) * seed.radial * radius)
      .addScaledVector(up, Math.sin(seed.angle) * seed.radial * radius * 0.7)
      .addScaledVector(normal, seed.depth * radius * 0.26);
    return -1;
  }

  group.traverse((object) => {
    object.userData.decoration = true;
    object.raycast = () => {};
    object.frustumCulled = false;
    object.renderOrder = 8;
  });

  function update(frame: SearchTransitionFrame) {
    if (disposed) return;
    const { phase, camera, target, center, anchors } = frame;
    group.visible = phase !== "idle";
    if (!group.visible) return;
    const p = clamp(frame.progress);
    const time = Number.isFinite(frame.time) ? frame.time : 0;
    camera.getWorldDirection(normal);
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const distance = Math.max(1, camera.position.distanceTo(center));
    const viewHeight = distance * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    const extent = viewHeight * Math.min(1.6, Math.max(0.65, camera.aspect));
    horizon.position.copy(target);
    horizon.quaternion.copy(camera.quaternion);
    horizon.scale.setScalar(extent * 0.245);
    horizon.visible = phase !== "birth";
    horizonMaterial.uniforms.uTime.value = time;
    horizonMaterial.uniforms.uOpacity.value = phase === "wait" ? 0.66 : smooth(p, 0, 0.3) * 0.86;
    horizonMaterial.uniforms.uStorm.value = phase === "wait" ? 0.34 : smooth(p, 0.10, 0.50) * (1 - smooth(p, 0.88, 1) * 0.66);
    nova.position.copy(center);
    nova.quaternion.copy(camera.quaternion);
    nova.scale.setScalar(extent * 1.62);
    nova.visible = phase === "birth";
    novaMaterial.uniforms.uProgress.value = p;
    // Pending network work is only one small shader batch, no particle uploads.
    fragments.visible = phase !== "wait" && (phase !== "collapse" || anchors.length > 0);
    ribbons.visible = phase === "collapse" && anchors.length > 0;
    if (phase === "wait") return;

    const activeCount = Math.min(maxStreams, anchors.length);
    const burstFade = smooth(p, 0.04, 0.14) * (1 - smooth(p, 0.50, 0.98));
    const collapseFade = smooth(p, 0.005, 0.13) * (1 - smooth(p, 0.97, 1));
    const count = phase === "birth" ? birthParticleCount : particleCount;
    particleGeometry.setDrawRange(0, count);
    for (let index = 0; index < count; index++) {
      const grain = index % birthParticleCount;
      const trail = Math.floor(index / birthParticleCount);
      const seed = seeds[grain];
      const anchorIndex = grain % Math.max(1, activeCount);
      const anchor = anchors[anchorIndex];
      if (phase === "collapse" && anchor) {
        const local = phaseFor(p, anchorIndex, activeCount);
        const offset = fragmentSource(anchor, Math.floor(grain / Math.max(1, activeCount)), extent, seed);
        // Different release times rip the original arms into many narrow flows:
        // early material accelerates away while late grains preserve the source
        // silhouette. A pair of dim trailing glints lends each grain momentum.
        const release = seed.phase * 0.22;
        const headAge = clamp((local - release) / (1 - release));
        const age = clamp(headAge - trail * 0.011 * smooth(headAge, 0.04, 0.65));
        infall(point, source, target, normal, age);
        if (offset >= 0 && anchor.fragmentColors && anchor.fragmentColors.length > offset + 2) {
          color.setRGB(anchor.fragmentColors[offset], anchor.fragmentColors[offset + 1], anchor.fragmentColors[offset + 2]);
        } else color.set(anchor.color || "#94c9ff");
        // A restrained cool scattering light keeps detached material visible
        // before capture heating; most of each source's real color survives.
        color.lerp(ice, smooth(local, 0.03, 0.20) * 0.18)
          .lerp(warm, smooth(age, 0.50, 1) * 0.76);
        intensities.setX(index, collapseFade * (0.48 + seed.phase * 0.46)
          * (1 - smooth(headAge, 0.988, 1)) * (trail === 0 ? 1 : trail === 1 ? 0.32 : 0.13));
        sizes.setX(index, seed.size * (extent / 520) * (0.93 + age * 0.78) * 1.10 * (trail === 0 ? 1 : 0.81));
      } else {
        const travel = 1 - Math.pow(1 - p, 2.35);
        const radius = extent * (0.10 + seed.radial * 0.44) * travel * seed.speed;
        const angle = seed.angle + p * 0.14 * (seed.depth > 0 ? 1 : -1);
        point.copy(center)
          .addScaledVector(right, Math.cos(angle) * radius)
          .addScaledVector(up, Math.sin(angle) * radius * 0.78)
          .addScaledVector(normal, seed.depth * radius * 0.42);
        color.copy(seed.phase > 0.76 ? violet : ice).lerp(warm, (1 - travel) * 0.95);
        intensities.setX(index, burstFade * (0.2 + seed.phase * 0.56));
        sizes.setX(index, seed.size * (extent / 520) * (1.35 - p * 0.6));
      }
      positions.setXYZ(index, point.x, point.y, point.z);
      colors.setXYZ(index, color.r, color.g, color.b);
    }
    positions.needsUpdate = colors.needsUpdate = sizes.needsUpdate = intensities.needsUpdate = true;
    if (phase !== "collapse") return;

    ribbonMaterial.uniforms.uTime.value = time;
    let cursor = 0;
    for (let index = 0; index < activeCount; index++) {
      const anchor = anchors[index];
      const local = phaseFor(p, index, activeCount);
      const span = local * (1 - local) * 1.35;
      const envelope = collapseFade * smooth(local, 0.12, 0.39);
      color.set(anchor.color || "#96cfff").lerp(warm, 0.32);
      for (let filament = 0; filament < ribbonCount; filament++) {
        const seed = seeds[(index * 127 + filament * 293) % birthParticleCount];
        fragmentSource(anchor, filament * 31 + index * 7, extent, seed);
        const release = filament * 0.067;
        const head = clamp((local - release) / (1 - release));
        for (let segment = 0; segment < segments; segment++) {
          const t = segment / segments;
          const next = (segment + 1) / segments;
          infall(point, source, target, normal, clamp(head - span * (1 - t)));
          infall(point2, source, target, normal, clamp(head - span * (1 - next)));
          side.copy(point2).sub(point).cross(normal).normalize();
          const width = extent * (filament ? 0.0014 : 0.0027) * Math.sin(Math.PI * t) * (1 - head * 0.76);
          const alpha = envelope * Math.pow(Math.sin(Math.PI * t), 1.2) * (filament ? 0.14 : 0.23);
          // Two triangles per strip segment; small tapered strands avoid hard
          // lines and remain visibly detached from knowledge/relationship links.
          for (let vertex = 0; vertex < 6; vertex++) {
            const atEnd = vertex === 2 || vertex === 4 || vertex === 5;
            const sign = vertex === 0 || vertex === 3 || vertex === 5 ? -1 : 1;
            const base = atEnd ? point2 : point;
            ribbonPositions.setXYZ(cursor, base.x + side.x * width * sign, base.y + side.y * width * sign, base.z + side.z * width * sign);
            ribbonColors.setXYZ(cursor, color.r, color.g, color.b);
            ribbonIntensities.setX(cursor, alpha);
            ribbonEdges.setX(cursor, sign);
            ribbonFlow.setX(cursor, (atEnd ? next : t) + filament * 0.71 + index * 0.34);
            cursor++;
          }
        }
      }
    }
    ribbonGeometry.setDrawRange(0, cursor);
    ribbonPositions.needsUpdate = ribbonColors.needsUpdate = ribbonIntensities.needsUpdate = true;
    ribbonEdges.needsUpdate = ribbonFlow.needsUpdate = true;
  }

  return {
    group,
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      group.visible = false;
      group.removeFromParent();
      group.clear();
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
    },
  };
}
