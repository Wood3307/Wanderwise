import * as THREE from "three";
import { createStar } from "./stars";

export type PlanetKind = "rocky" | "ocean" | "gas" | "ringed" | "ice" | "lava";

export const planetKindNames: Record<PlanetKind, string> = {
  rocky: "岩质行星",
  ocean: "异质流体星",
  gas: "气态巨行星",
  ringed: "环状行星",
  ice: "冰巨行星",
  lava: "熔岩行星",
};

export interface ParagraphPlanet {
  index: number;
  kind: PlanetKind;
  object: THREE.Group;
  orbit: THREE.LineLoop;
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
  let value =
    Array.from(seed).reduce(
      (hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619),
      2166136261,
    ) >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const initialKinds: PlanetKind[] = ["ocean", "rocky", "ringed", "gas"];

/** Shared by the model and its projected labels; a seed always names the same surface. */
export function getPlanetKind(seed: string, index: number): PlanetKind {
  const offset = Math.floor(seededRandom(seed)() * initialKinds.length);
  const slot =
    (Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0) % 6;
  if (slot < initialKinds.length)
    return initialKinds[(slot + offset) % initialKinds.length];
  return slot === 4 ? "ice" : "lava";
}

export interface PlanetPalette {
  dark: string;
  light: string;
  accent: string;
  atmosphere: string;
}

// Fictional mineral/fluid palettes deliberately avoid a terrestrial blue sea,
// green continent and white polar-cap combination. Repeated kinds still vary.
const planetPalettes: Record<PlanetKind, PlanetPalette[]> = {
  rocky: [
    {
      dark: "#372d33",
      light: "#b399a1",
      accent: "#debfaa",
      atmosphere: "#a589a0",
    },
    {
      dark: "#322e29",
      light: "#a69c7d",
      accent: "#d2cdb9",
      atmosphere: "#bea884",
    },
    {
      dark: "#333343",
      light: "#9c91b8",
      accent: "#b9bddc",
      atmosphere: "#9891bf",
    },
  ],
  ocean: [
    {
      dark: "#30224b",
      light: "#a08cbf",
      accent: "#a1d2d5",
      atmosphere: "#b3a0e8",
    },
    {
      dark: "#39263e",
      light: "#c59eaf",
      accent: "#b4d5db",
      atmosphere: "#d4acd8",
    },
    {
      dark: "#222b47",
      light: "#858abe",
      accent: "#c6b1e5",
      atmosphere: "#a5a9ed",
    },
  ],
  gas: [
    {
      dark: "#423449",
      light: "#bc9cb9",
      accent: "#897daf",
      atmosphere: "#c8aad9",
    },
    {
      dark: "#343c46",
      light: "#afbdc7",
      accent: "#5f87a8",
      atmosphere: "#a1cede",
    },
    {
      dark: "#4b3440",
      light: "#caa3a0",
      accent: "#997191",
      atmosphere: "#d8b2bf",
    },
  ],
  ringed: [
    {
      dark: "#48404b",
      light: "#c4b4d2",
      accent: "#e0d4f2",
      atmosphere: "#b8afde",
    },
    {
      dark: "#444644",
      light: "#c4c2af",
      accent: "#d3d8d2",
      atmosphere: "#bccdcc",
    },
    {
      dark: "#4e3e40",
      light: "#d0afa4",
      accent: "#e7cdca",
      atmosphere: "#dcb6bb",
    },
  ],
  ice: [
    {
      dark: "#1d3b4d",
      light: "#85bac6",
      accent: "#d2e8ea",
      atmosphere: "#87c9df",
    },
    {
      dark: "#39374f",
      light: "#a39dbf",
      accent: "#d6d3ed",
      atmosphere: "#b2a4ec",
    },
    {
      dark: "#2e4648",
      light: "#a0c4bb",
      accent: "#dfede5",
      atmosphere: "#b5e1d2",
    },
  ],
  lava: [
    {
      dark: "#1a1419",
      light: "#65404e",
      accent: "#ef7955",
      atmosphere: "#d99a8c",
    },
    {
      dark: "#171523",
      light: "#524163",
      accent: "#b680ef",
      atmosphere: "#9f8fd6",
    },
    {
      dark: "#221a1b",
      light: "#755442",
      accent: "#e9b574",
      atmosphere: "#dbad80",
    },
  ],
};

export function getPlanetPalette(seed: string, index: number): PlanetPalette {
  const palettes = planetPalettes[getPlanetKind(seed, index)];
  const offset = Math.floor(
    seededRandom(`${seed}:mineral:${index}`)() * palettes.length,
  );
  return { ...palettes[offset] };
}

// Local coordinates keep fluid swirls, cloud bands and crater rims attached to a
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
  uniform vec3 uPaletteDark;
  uniform vec3 uPaletteLight;
  uniform vec3 uAccent;
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
      albedo = mix(uPaletteDark, uPaletteLight, surface);
      for (int c = 0; c < 10; c++) {
        float k = float(c) + uSeed;
        vec3 center = normalize(vec3(hash(vec3(k, 1.0, 2.0)), hash(vec3(2.0, k, 4.0)), hash(vec3(6.0, 2.0, k))) - 0.5);
        float radius = 0.07 + hash(vec3(k, 7.0, 8.0)) * 0.2;
        float distance = length(p - center) / radius;
        float pit = 1.0 - smoothstep(0.55, 0.92, distance);
        float lip = smoothstep(0.70, 0.98, distance) * (1.0 - smoothstep(1.0, 1.2, distance));
        albedo *= 1.0 - pit * 0.35;
        albedo += uAccent * lip * 0.22;
      }
    } else if (uKind < 1.5) {
      // Continuous pearlescent fluids: folded mineral ribbons, without land
      // silhouettes or polar caps that would make this world resemble Earth.
      vec3 fold = p * 5.4 + vec3(surface * 3.6, fbm(domain + 8.0) * 2.7, uSeed);
      float current = fbm(fold);
      float flow = sin((p.y + p.x * 0.34) * 19.0 + current * 18.0) * 0.5 + 0.5;
      float vein = pow(1.0 - abs(sin(current * 32.0 + p.z * 7.0)), 9.0);
      albedo = mix(uPaletteDark, uPaletteLight, 0.20 + surface * 0.30 + flow * 0.46);
      albedo = mix(albedo, uAccent, vein * 0.52);
      float glaze = smoothstep(0.61, 0.81, fbm(fold * 1.7 + 14.0));
      albedo = mix(albedo, mix(uPaletteLight, uAccent, 0.5), glaze * 0.35);
      specularStrength = 0.12 + flow * 0.12;
    } else if (uKind < 3.5) {
      float wave = sin(p.y * 41.0 + fbm(p * 5.0 + uSeed) * 7.0) * 0.5 + 0.5;
      float fineBand = sin(p.y * 107.0 + surface * 12.0) * 0.5 + 0.5;
      albedo = mix(uPaletteDark, uPaletteLight, wave * 0.72 + fineBand * 0.18 + 0.10);
      // A softly bounded storm, distorted by its surrounding atmosphere.
      vec2 stormPoint = vec2(atan(p.z, p.x) + 0.45, p.y + 0.24);
      float storm = 1.0 - smoothstep(0.55, 1.0, length(stormPoint / vec2(0.30, 0.115)) + surface * 0.22);
      albedo = mix(albedo, uAccent, storm * 0.6);
    } else if (uKind < 4.5) {
      float bands = sin(p.y * 24.0 + surface * 6.0) * 0.5 + 0.5;
      albedo = mix(uPaletteDark, uPaletteLight, surface * 0.67 + bands * 0.33);
      albedo = mix(albedo, uAccent, smoothstep(0.81, 0.98, abs(p.y)) * 0.55);
      specularStrength = 0.10;
    } else {
      float ridges = abs(fbm(p * 5.0 + uSeed) - 0.50);
      float cracks = 1.0 - smoothstep(0.014, 0.046, ridges);
      albedo = mix(uPaletteDark, uPaletteLight, surface);
      emission = uAccent * cracks * (0.65 + surface * 0.35);
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

/** A real, camera-independent stellar system for the article / paragraph layer. */
export function createPlanetarySystem(options: {
  seed: string;
  count: number;
  mobile: boolean;
}): PlanetarySystem {
  const random = seededRandom(options.seed);
  const count = Number.isFinite(options.count)
    ? Math.max(0, Math.min(10, Math.floor(options.count)))
    : 0;
  const group = new THREE.Group();
  group.name = "article-planetary-system";
  const segments = options.mobile ? 32 : 48;
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const shaders: THREE.ShaderMaterial[] = [];
  const lightPosition = new THREE.Vector3();
  const registerGeometry = <T extends THREE.BufferGeometry>(geometry: T): T => {
    geometries.add(geometry);
    return geometry;
  };
  const registerShader = (material: THREE.ShaderMaterial) => {
    materials.add(material);
    shaders.push(material);
    return material;
  };
  const sphere = registerGeometry(
    new THREE.SphereGeometry(1, segments, segments / 2),
  );
  const stellarBody = createStar({
    seed: options.seed,
    radius: 1.22,
    mobile: options.mobile,
  });
  const star = stellarBody.group;
  star.name = "article-star";
  star.userData.articleTitle = true;
  group.add(star);

  // Preserve the generation stream: its first sample determines kind order
  // inside getPlanetKind; subsequent samples determine the surface details.
  random();
  const kindIds: Record<PlanetKind, number> = {
    rocky: 0,
    ocean: 1,
    gas: 2,
    ringed: 3,
    ice: 4,
    lava: 5,
  };
  const planets: ParagraphPlanet[] = [];
  const motions: {
    angle: number;
    orbitRadius: number;
    inclination: number;
    phase: number;
    body: THREE.Mesh;
    atmosphere: THREE.Mesh;
    spin: number;
  }[] = [];
  const orbitMaterials: THREE.LineBasicMaterial[] = [];
  const positionOnOrbit = (
    target: THREE.Vector3,
    angle: number,
    radius: number,
    inclination: number,
    phase: number,
  ) => {
    target.set(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius * 0.78,
      Math.sin(angle + phase) * inclination,
    );
  };

  for (let index = 0; index < count; index++) {
    const kind = getPlanetKind(options.seed, index);
    const radius =
      kind === "gas" ? 0.97 : kind === "ringed" ? 0.79 : 0.63 + random() * 0.23;
    const object = new THREE.Group();
    object.name = `paragraph-planet-${index}-${kind}`;
    object.userData = {
      celestialType: "planet",
      planetKind: kind,
      paragraphIndex: index,
    };
    const palette = getPlanetPalette(options.seed, index);
    const atmosphereColor = new THREE.Color(palette.atmosphere);
    const bodyMaterial = registerShader(
      new THREE.ShaderMaterial({
        vertexShader: planetVertexShader,
        fragmentShader: planetFragmentShader,
        transparent: true,
        uniforms: {
          uStarPosition: { value: lightPosition },
          uKind: { value: kindIds[kind] },
          uSeed: { value: random() * 90 },
          uOpacity: { value: 1 },
          uTint: {
            value: new THREE.Color().setRGB(
              0.93 + random() * 0.07,
              0.93 + random() * 0.07,
              0.93 + random() * 0.07,
            ),
          },
          uAtmosphere: { value: atmosphereColor },
          uPaletteDark: { value: new THREE.Color(palette.dark) },
          uPaletteLight: { value: new THREE.Color(palette.light) },
          uAccent: { value: new THREE.Color(palette.accent) },
        },
      }),
    );
    const body = new THREE.Mesh(sphere, bodyMaterial);
    body.name = `planet-surface-${kind}`;
    body.scale.setScalar(radius);
    body.rotation.set(
      0.12 + random() * 0.3,
      random() * Math.PI * 2,
      0.14 + random() * 0.33,
    );
    body.userData = {
      celestialType: "planet",
      planetKind: kind,
      paragraphIndex: index,
    };
    object.add(body);

    const atmosphereMaterial = registerShader(
      new THREE.ShaderMaterial({
        vertexShader: planetVertexShader,
        fragmentShader: atmosphereFragmentShader,
        uniforms: {
          uStarPosition: { value: lightPosition },
          uAtmosphere: { value: atmosphereColor },
          uOpacity: { value: 1 },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    const atmosphere = new THREE.Mesh(sphere, atmosphereMaterial);
    atmosphere.name = "planet-atmospheric-limb";
    atmosphere.scale.setScalar(radius * 1.055);
    object.add(atmosphere);

    if (kind === "ringed") {
      const ringMaterial = registerShader(
        new THREE.ShaderMaterial({
          vertexShader: ringVertexShader,
          fragmentShader: ringFragmentShader,
          uniforms: {
            uStarPosition: { value: lightPosition },
            uOpacity: { value: 1 },
          },
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      const rings = new THREE.Mesh(
        registerGeometry(
          new THREE.RingGeometry(1.22, 2.16, options.mobile ? 64 : 112),
        ),
        ringMaterial,
      );
      rings.name = "planet-icy-rings";
      rings.scale.setScalar(radius);
      rings.rotation.set(0.88, -0.25, 0.34);
      rings.userData = {
        celestialType: "planet-ring",
        planetKind: kind,
        paragraphIndex: index,
      };
      object.add(rings);
    }

    // Four primary excerpts occupy different physical quadrants even when
    // there are more paragraphs. Additional planets use the outer system.
    // These are world positions and never depend on the camera or labels.
    const outerAngles = [
      0,
      Math.PI,
      Math.PI / 2,
      Math.PI * 1.5,
      Math.PI / 8,
      Math.PI * 1.125,
    ];
    const angle =
      count < 4
        ? Math.PI / 4 + (index * Math.PI * 2) / Math.max(1, count)
        : index < 4
          ? Math.PI / 4 + (index * Math.PI) / 2
          : outerAngles[index - 4];
    const orbitRadius =
      index < 4 ? 10.25 + (index % 2) * 1.25 : 12.75 + (index % 2) * 0.65;
    const inclination = 1.0 + random() * 1.0;
    const phase = random() * 0.7 - 0.35;
    positionOnOrbit(object.position, angle, orbitRadius, inclination, phase);
    group.add(object);
    motions.push({
      angle,
      orbitRadius,
      inclination,
      phase,
      body,
      atmosphere,
      spin: (0.035 + random() * 0.022) * (index % 2 ? -1 : 1),
    });

    const vertices: THREE.Vector3[] = [];
    for (let step = 0; step < 128; step++) {
      const point = new THREE.Vector3();
      positionOnOrbit(
        point,
        (step / 128) * Math.PI * 2,
        orbitRadius,
        inclination,
        phase,
      );
      vertices.push(point);
    }
    const orbitMaterial = new THREE.LineBasicMaterial({
      color: "#85b4cd",
      transparent: true,
      opacity: 0.085,
      depthWrite: false,
    });
    materials.add(orbitMaterial);
    orbitMaterials.push(orbitMaterial);
    const orbit = new THREE.LineLoop(
      registerGeometry(new THREE.BufferGeometry().setFromPoints(vertices)),
      orbitMaterial,
    );
    orbit.name = `planet-orbit-${index}`;
    group.add(orbit);
    planets.push({ index, kind, object, orbit, position: object.position, radius });
  }

  let lastTime: number | undefined;
  let motionTime = 0;
  let disposed = false;
  return {
    group,
    star,
    planets,
    update(time, reducedMotion, paused = false) {
      if (disposed) return;
      const currentTime = Number.isFinite(time) ? time : (lastTime ?? 0);
      // Ignore time spent in background tabs: resuming never jumps an anchor.
      const delta =
        lastTime === undefined
          ? 0
          : Math.max(0, Math.min(0.1, currentTime - lastTime));
      lastTime = currentTime;
      if (!reducedMotion && !paused) {
        motionTime += delta;
        planets.forEach((planet, index) => {
          const motion = motions[index];
          const angle =
            motion.angle + motionTime * ((Math.PI * 2) / (900 + index * 75));
          positionOnOrbit(
            planet.position,
            angle,
            motion.orbitRadius,
            motion.inclination,
            motion.phase,
          );
          motion.body.rotation.y += delta * motion.spin;
        });
      }
      stellarBody.update(currentTime, reducedMotion, paused);
      group.updateWorldMatrix(true, false);
      lightPosition.setFromMatrixPosition(group.matrixWorld);
    },
    setOpacity(opacity) {
      if (disposed) return;
      const alpha = Number.isFinite(opacity)
        ? THREE.MathUtils.clamp(opacity, 0, 1)
        : 0;
      group.visible = alpha > 0.001;
      shaders.forEach((material) => {
        material.uniforms.uOpacity.value = alpha;
      });
      stellarBody.setOpacity(alpha);
      orbitMaterials.forEach((material) => {
        material.opacity = alpha * 0.085;
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      stellarBody.dispose();
      group.removeFromParent();
      group.clear();
    },
  };
}
