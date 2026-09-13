import * as THREE from 'three';

export type PlanetKind = 'rocky' | 'ocean' | 'gas' | 'ringed' | 'ice' | 'lava';

export const planetKindNames: Record<PlanetKind, string> = {
  rocky: '岩质行星', ocean: '海洋行星', gas: '气态巨行星',
  ringed: '环状行星', ice: '冰巨行星', lava: '熔岩行星',
};

export interface ParagraphPlanet {
  index: number;
  kind: PlanetKind;
  object: THREE.Group;
  /** The actual anchor, not a snapshot: it is also object.position. */
  position: THREE.Vector3;
  radius: number;
}

export interface PlanetarySystem {
  group: THREE.Group;
  star: THREE.Object3D;
  planets: ParagraphPlanet[];
  update: (time: number, reducedMotion: boolean, paused?: boolean) => void;
  setOpacity: (opacity: number) => void;
  dispose: () => void;
}

function seededRandom(seed: string) {
  let value = Array.from(seed).reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619), 2166136261) >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const initialKinds: PlanetKind[] = ['ocean', 'rocky', 'ringed', 'gas'];

/** Shared by the model and its projected labels; a seed always names the same surface. */
export function getPlanetKind(seed: string, index: number): PlanetKind {
  const offset = Math.floor(seededRandom(seed)() * initialKinds.length);
  const slot = (Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0) % 6;
  if (slot < initialKinds.length) return initialKinds[(slot + offset) % initialKinds.length];
  return slot === 4 ? 'ice' : 'lava';
}

// Local coordinates keep the land, cloud bands and crater rims attached to a
// rotating sphere. Lighting is in view space, so it stays pointed at the star
// when the entire system is scaled, translated or rotated by the scene.
const planetVertexShader = `
  varying vec3 vSurface;
  varying vec3 vNormal;
  varying vec3 vLight;
  varying vec3 vView;
  uniform vec3 uStarPosition;
  void main() {
    vSurface = normalize(position);
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vLight = (viewMatrix * vec4(uStarPosition, 1.0)).xyz - viewPosition.xyz;
    vView = -viewPosition.xyz;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const noiseGLSL = `
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.13, 0.27, 0.41));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x),
                   mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
                   mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    return noise(p) * 0.57 + noise(p * 2.03 + 11.7) * 0.28 + noise(p * 4.11 + 23.1) * 0.15;
  }
`;

const planetFragmentShader = `
  varying vec3 vSurface;
  varying vec3 vNormal;
  varying vec3 vLight;
  varying vec3 vView;
  uniform float uKind;
  uniform float uSeed;
  uniform float uOpacity;
  uniform vec3 uTint;
  uniform vec3 uAtmosphere;
  ${noiseGLSL}
  void main() {
    vec3 p = normalize(vSurface);
    vec3 domain = p * 3.6 + uSeed;
    float surface = fbm(domain);
    vec3 albedo;
    float specularStrength = 0.025;
    vec3 emission = vec3(0.0);

    if (uKind < 0.5) {
      // Rock and pale crater lips. Craters are distributed on the sphere,
      // rather than painted onto a camera-facing disc.
      albedo = mix(vec3(0.16, 0.11, 0.075), vec3(0.62, 0.46, 0.29), surface);
      for (int c = 0; c < 10; c++) {
        float k = float(c) + uSeed;
        vec3 center = normalize(vec3(hash(vec3(k, 1.0, 2.0)), hash(vec3(2.0, k, 4.0)), hash(vec3(6.0, 2.0, k))) - 0.5);
        float radius = 0.07 + hash(vec3(k, 7.0, 8.0)) * 0.2;
        float distance = length(p - center) / radius;
        float pit = 1.0 - smoothstep(0.55, 0.92, distance);
        float lip = smoothstep(0.70, 0.98, distance) * (1.0 - smoothstep(1.0, 1.2, distance));
        albedo *= 1.0 - pit * 0.35;
        albedo += vec3(0.17, 0.135, 0.1) * lip;
      }
    } else if (uKind < 1.5) {
      float continent = smoothstep(0.48, 0.57, surface);
      vec3 sea = mix(vec3(0.015, 0.065, 0.15), vec3(0.035, 0.30, 0.39), surface);
      vec3 land = mix(vec3(0.12, 0.24, 0.15), vec3(0.40, 0.42, 0.24), fbm(domain * 2.3));
      albedo = mix(sea, land, continent);
      float clouds = smoothstep(0.61, 0.76, fbm(p * 7.5 + vec3(uSeed, 17.0, 3.0)));
      albedo = mix(albedo, vec3(0.77, 0.85, 0.84), clouds * 0.82);
      float cap = smoothstep(0.87, 0.98, abs(p.y) + (surface - 0.5) * 0.14);
      albedo = mix(albedo, vec3(0.75, 0.83, 0.85), cap);
      specularStrength = mix(0.23, 0.025, max(continent, clouds));
    } else if (uKind < 3.5) {
      float wave = sin(p.y * 41.0 + fbm(p * 5.0 + uSeed) * 7.0) * 0.5 + 0.5;
      float fineBand = sin(p.y * 107.0 + surface * 12.0) * 0.5 + 0.5;
      vec3 darkBand = uKind < 2.5 ? vec3(0.24, 0.13, 0.085) : vec3(0.26, 0.22, 0.13);
      vec3 lightBand = uKind < 2.5 ? vec3(0.81, 0.61, 0.38) : vec3(0.77, 0.72, 0.51);
      albedo = mix(darkBand, lightBand, wave * 0.72 + fineBand * 0.18 + 0.10);
      // A softly bounded storm, distorted by its surrounding atmosphere.
      vec2 stormPoint = vec2(atan(p.z, p.x) + 0.45, p.y + 0.24);
      float storm = 1.0 - smoothstep(0.55, 1.0, length(stormPoint / vec2(0.30, 0.115)) + surface * 0.22);
      albedo = mix(albedo, vec3(0.47, 0.21, 0.11), storm * 0.6);
    } else if (uKind < 4.5) {
      float bands = sin(p.y * 24.0 + surface * 6.0) * 0.5 + 0.5;
      albedo = mix(vec3(0.035, 0.21, 0.39), vec3(0.36, 0.69, 0.76), surface * 0.67 + bands * 0.33);
      albedo = mix(albedo, vec3(0.57, 0.77, 0.80), smoothstep(0.81, 0.98, abs(p.y)) * 0.55);
      specularStrength = 0.10;
    } else {
      float ridges = abs(fbm(p * 5.0 + uSeed) - 0.50);
      float cracks = 1.0 - smoothstep(0.014, 0.046, ridges);
      albedo = mix(vec3(0.045, 0.032, 0.029), vec3(0.25, 0.15, 0.095), surface);
      emission = vec3(0.85, 0.15, 0.025) * cracks * (0.65 + surface * 0.35);
    }

    vec3 N = normalize(vNormal);
    vec3 L = normalize(vLight);
    vec3 V = normalize(vView);
    float daylight = max(dot(N, L), 0.0);
    float twilight = smoothstep(-0.15, 0.25, dot(N, L));
    vec3 reflected = albedo * uTint * (0.075 + daylight * 1.43);
    float specular = pow(max(dot(N, normalize(L + V)), 0.0), 34.0) * specularStrength * daylight;
    float rim = pow(1.0 - max(dot(N, V), 0.0), 3.5);
    vec3 color = reflected + vec3(1.0, 0.90, 0.78) * specular + emission;
    color += uAtmosphere * rim * (0.025 + twilight * 0.16);
    gl_FragColor = vec4(color, uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const atmosphereFragmentShader = `
  varying vec3 vNormal;
  varying vec3 vLight;
  varying vec3 vView;
  uniform vec3 uAtmosphere;
  uniform float uOpacity;
  void main() {
    vec3 N = normalize(vNormal);
    float edge = pow(1.0 - abs(dot(N, normalize(vView))), 3.0);
    float daylight = smoothstep(-0.25, 0.65, dot(N, normalize(vLight)));
    gl_FragColor = vec4(uAtmosphere, edge * (0.025 + daylight * 0.22) * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const starFragmentShader = `
  varying vec3 vSurface;
  varying vec3 vNormal;
  varying vec3 vView;
  uniform float uTime;
  uniform float uOpacity;
  ${noiseGLSL}
  void main() {
    float activity = fbm(normalize(vSurface) * 10.0 + vec3(0.0, uTime * 0.013, 0.0));
    float limb = pow(max(dot(normalize(vNormal), normalize(vView)), 0.0), 0.35);
    vec3 color = mix(vec3(1.0, 0.31, 0.075), vec3(1.9, 1.30, 0.61), activity * 0.56 + limb * 0.44);
    gl_FragColor = vec4(color, uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const ringVertexShader = `
  varying vec3 vLocal;
  varying vec3 vLight;
  varying vec3 vNormal;
  uniform vec3 uStarPosition;
  void main() {
    vLocal = position;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vLight = (viewMatrix * vec4(uStarPosition, 1.0)).xyz - viewPosition.xyz;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const ringFragmentShader = `
  varying vec3 vLocal;
  varying vec3 vLight;
  varying vec3 vNormal;
  uniform float uOpacity;
  void main() {
    float r = length(vLocal.xy);
    float fine = sin(r * 113.0) * 0.5 + 0.5;
    float band = sin(r * 29.0) * 0.5 + 0.5;
    float gap = 1.0 - smoothstep(0.015, 0.04, abs(r - 1.77));
    float edges = smoothstep(1.22, 1.32, r) * (1.0 - smoothstep(2.02, 2.16, r));
    float diffuse = 0.30 + abs(dot(normalize(vNormal), normalize(vLight))) * 0.7;
    vec3 color = mix(vec3(0.29, 0.24, 0.16), vec3(0.75, 0.67, 0.46), band * 0.5 + fine * 0.5);
    gl_FragColor = vec4(color * diffuse, edges * (0.39 + fine * 0.20 + band * 0.14) * (1.0 - gap * 0.88) * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function coronaTexture(): THREE.DataTexture {
  const size = 96;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot((x + 0.5 - size / 2) / (size / 2), (y + 0.5 - size / 2) / (size / 2));
      // A restrained outer falloff makes the photosphere read as luminous
      // without extending glare across the surrounding article text.
      const alpha = Math.max(0, Math.exp(-r * r * 7.2) - Math.exp(-7.2));
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 165;
      data[i + 2] = 72;
      data[i + 3] = Math.round(alpha * 165);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** A real, camera-independent stellar system for the article / paragraph layer. */
export function createPlanetarySystem(options: { seed: string; count: number; mobile: boolean }): PlanetarySystem {
  const random = seededRandom(options.seed);
  const count = Number.isFinite(options.count) ? Math.max(0, Math.min(10, Math.floor(options.count))) : 0;
  const group = new THREE.Group();
  group.name = 'article-planetary-system';
  const segments = options.mobile ? 32 : 48;
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const shaders: THREE.ShaderMaterial[] = [];
  const lightPosition = new THREE.Vector3();
  const registerGeometry = <T extends THREE.BufferGeometry>(geometry: T): T => { geometries.add(geometry); return geometry; };
  const registerShader = (material: THREE.ShaderMaterial) => { materials.add(material); shaders.push(material); return material; };
  const sphere = registerGeometry(new THREE.SphereGeometry(1, segments, segments / 2));
  const star = new THREE.Group();
  star.name = 'article-star';
  star.userData = { celestialType: 'star', articleTitle: true };
  const starMaterial = registerShader(new THREE.ShaderMaterial({
    vertexShader: planetVertexShader, fragmentShader: starFragmentShader,
    transparent: true,
    uniforms: { uStarPosition: { value: lightPosition }, uTime: { value: 0 }, uOpacity: { value: 1 } },
  }));
  const starBody = new THREE.Mesh(sphere, starMaterial);
  starBody.name = 'stellar-photosphere';
  starBody.scale.setScalar(1.22);
  starBody.userData = { celestialType: 'star' };
  star.add(starBody);
  const texture = coronaTexture();
  const coronaMaterial = new THREE.SpriteMaterial({
    map: texture, color: '#ffd7a0', transparent: true, opacity: 0.65,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  materials.add(coronaMaterial);
  const corona = new THREE.Sprite(coronaMaterial);
  corona.name = 'stellar-corona';
  corona.scale.set(6, 6, 1);
  star.add(corona);
  group.add(star);

  // Preserve the generation stream: its first sample determines kind order
  // inside getPlanetKind; subsequent samples determine the surface details.
  random();
  const kindIds: Record<PlanetKind, number> = { rocky: 0, ocean: 1, gas: 2, ringed: 3, ice: 4, lava: 5 };
  const atmosphereColors: Record<PlanetKind, string> = {
    rocky: '#ad7c55', ocean: '#64bcf1', gas: '#e5c09a',
    ringed: '#dacfa0', ice: '#61cdeb', lava: '#f47832',
  };
  const planets: ParagraphPlanet[] = [];
  const motions: { angle: number; orbitRadius: number; inclination: number; phase: number; body: THREE.Mesh; atmosphere: THREE.Mesh; spin: number }[] = [];
  const orbitMaterials: THREE.LineBasicMaterial[] = [];
  const positionOnOrbit = (target: THREE.Vector3, angle: number, radius: number, inclination: number, phase: number) => {
    target.set(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.78, Math.sin(angle + phase) * inclination);
  };

  for (let index = 0; index < count; index++) {
    const kind = getPlanetKind(options.seed, index);
    const radius = kind === 'gas' ? 0.97 : kind === 'ringed' ? 0.79 : 0.63 + random() * 0.23;
    const object = new THREE.Group();
    object.name = `paragraph-planet-${index}-${kind}`;
    object.userData = { celestialType: 'planet', planetKind: kind, paragraphIndex: index };
    const atmosphereColor = new THREE.Color(atmosphereColors[kind]);
    const bodyMaterial = registerShader(new THREE.ShaderMaterial({
      vertexShader: planetVertexShader, fragmentShader: planetFragmentShader,
      transparent: true,
      uniforms: {
        uStarPosition: { value: lightPosition }, uKind: { value: kindIds[kind] },
        uSeed: { value: random() * 90 }, uOpacity: { value: 1 },
        uTint: { value: new THREE.Color().setRGB(0.93 + random() * 0.07, 0.93 + random() * 0.07, 0.93 + random() * 0.07) },
        uAtmosphere: { value: atmosphereColor },
      },
    }));
    const body = new THREE.Mesh(sphere, bodyMaterial);
    body.name = `planet-surface-${kind}`;
    body.scale.setScalar(radius);
    body.rotation.set(0.12 + random() * 0.30, random() * Math.PI * 2, 0.14 + random() * 0.33);
    body.userData = { celestialType: 'planet', planetKind: kind, paragraphIndex: index };
    object.add(body);

    const atmosphereMaterial = registerShader(new THREE.ShaderMaterial({
      vertexShader: planetVertexShader, fragmentShader: atmosphereFragmentShader,
      uniforms: { uStarPosition: { value: lightPosition }, uAtmosphere: { value: atmosphereColor }, uOpacity: { value: 1 } },
      transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
    }));
    const atmosphere = new THREE.Mesh(sphere, atmosphereMaterial);
    atmosphere.name = 'planet-atmospheric-limb';
    atmosphere.scale.setScalar(radius * 1.055);
    object.add(atmosphere);

    if (kind === 'ringed') {
      const ringMaterial = registerShader(new THREE.ShaderMaterial({
        vertexShader: ringVertexShader, fragmentShader: ringFragmentShader,
        uniforms: { uStarPosition: { value: lightPosition }, uOpacity: { value: 1 } },
        transparent: true, side: THREE.DoubleSide, depthWrite: false,
      }));
      const rings = new THREE.Mesh(registerGeometry(new THREE.RingGeometry(1.22, 2.16, options.mobile ? 64 : 112)), ringMaterial);
      rings.name = 'planet-icy-rings';
      rings.scale.setScalar(radius);
      rings.rotation.set(0.88, -0.25, 0.34);
      rings.userData = { celestialType: 'planet-ring', planetKind: kind, paragraphIndex: index };
      object.add(rings);
    }

    // Four primary excerpts occupy different physical quadrants even when
    // there are more paragraphs. Additional planets use the outer system.
    // These are world positions and never depend on the camera or labels.
    const outerAngles = [0, Math.PI, Math.PI / 2, Math.PI * 1.5, Math.PI / 8, Math.PI * 1.125];
    const angle = count < 4
      ? Math.PI / 4 + index * Math.PI * 2 / Math.max(1, count)
      : index < 4 ? Math.PI / 4 + index * Math.PI / 2 : outerAngles[index - 4];
    const orbitRadius = index < 4 ? 10.25 + (index % 2) * 1.25 : 12.75 + (index % 2) * 0.65;
    const inclination = 1.0 + random() * 1.0;
    const phase = random() * 0.7 - 0.35;
    positionOnOrbit(object.position, angle, orbitRadius, inclination, phase);
    group.add(object);
    planets.push({ index, kind, object, position: object.position, radius });
    motions.push({ angle, orbitRadius, inclination, phase, body, atmosphere, spin: (0.035 + random() * 0.022) * (index % 2 ? -1 : 1) });

    const vertices: THREE.Vector3[] = [];
    for (let step = 0; step < 128; step++) {
      const point = new THREE.Vector3();
      positionOnOrbit(point, step / 128 * Math.PI * 2, orbitRadius, inclination, phase);
      vertices.push(point);
    }
    const orbitMaterial = new THREE.LineBasicMaterial({ color: '#85b4cd', transparent: true, opacity: 0.085, depthWrite: false });
    materials.add(orbitMaterial);
    orbitMaterials.push(orbitMaterial);
    const orbit = new THREE.LineLoop(registerGeometry(new THREE.BufferGeometry().setFromPoints(vertices)), orbitMaterial);
    orbit.name = `planet-orbit-${index}`;
    group.add(orbit);
  }

  let lastTime: number | undefined;
  let motionTime = 0;
  let disposed = false;
  return {
    group, star, planets,
    update(time, reducedMotion, paused = false) {
      if (disposed) return;
      const currentTime = Number.isFinite(time) ? time : (lastTime ?? 0);
      // Ignore time spent in background tabs: resuming never jumps an anchor.
      const delta = lastTime === undefined ? 0 : Math.max(0, Math.min(0.1, currentTime - lastTime));
      lastTime = currentTime;
      if (!reducedMotion && !paused) {
        motionTime += delta;
        planets.forEach((planet, index) => {
          const motion = motions[index];
          const angle = motion.angle + motionTime * (Math.PI * 2 / (900 + index * 75));
          positionOnOrbit(planet.position, angle, motion.orbitRadius, motion.inclination, motion.phase);
          motion.body.rotation.y += delta * motion.spin;
        });
        starBody.rotation.y += delta * 0.015;
      }
      starMaterial.uniforms.uTime.value = motionTime;
      group.updateWorldMatrix(true, false);
      lightPosition.setFromMatrixPosition(group.matrixWorld);
    },
    setOpacity(opacity) {
      if (disposed) return;
      const alpha = Number.isFinite(opacity) ? THREE.MathUtils.clamp(opacity, 0, 1) : 0;
      group.visible = alpha > 0.001;
      shaders.forEach(material => { material.uniforms.uOpacity.value = alpha; });
      coronaMaterial.opacity = alpha * 0.65;
      orbitMaterials.forEach(material => { material.opacity = alpha * 0.085; });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
      texture.dispose();
      group.removeFromParent();
      group.clear();
    },
  };
}
