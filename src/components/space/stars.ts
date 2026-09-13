import * as THREE from "three";

/** Art directions, rather than scientific spectral classifications. */
export type StarKind = "azure" | "violet" | "ivory" | "amber";

export interface StarStyle {
  kind: StarKind;
  name: string;
  core: string;
  plasma: string;
  corona: string;
  hasDisk: boolean;
}

export interface StellarBody {
  group: THREE.Group;
  kind: StarKind;
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

const styles: Record<StarKind, Omit<StarStyle, "hasDisk">> = {
  azure: {
    kind: "azure",
    name: "湛蓝电光恒星",
    core: "#74d9ff",
    plasma: "#073574",
    corona: "#3aadff",
  },
  ivory: {
    kind: "ivory",
    name: "银白辉光恒星",
    core: "#f3f6e9",
    plasma: "#487f9b",
    corona: "#b6e8ff",
  },
  violet: {
    kind: "violet",
    name: "紫辉恒星",
    core: "#e1c6ff",
    plasma: "#421d75",
    corona: "#ae91f6",
  },
  amber: {
    kind: "amber",
    name: "琥珀恒星",
    core: "#ffe1af",
    plasma: "#8b3918",
    corona: "#ffbb70",
  },
};

/** A stable answer identity keeps its star from changing when layers change. */
export function getStarStyle(seed: string): StarStyle {
  const random = seededRandom(seed);
  const kinds: StarKind[] = ["azure", "ivory", "azure", "violet", "amber"];
  const kind = kinds[Math.floor(random() * kinds.length)];
  return { ...styles[kind], hasDisk: random() > 0.58 };
}

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
    return noise(p) * 0.54 + noise(p * 2.03 + 11.7) * 0.28 + noise(p * 4.11 + 23.1) * 0.18;
  }
`;

const surfaceVertex = `
  varying vec3 vSurface;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vSurface = normalize(position);
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = -viewPosition.xyz;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const surfaceFragment = `
  varying vec3 vSurface;
  varying vec3 vNormal;
  varying vec3 vView;
  uniform vec3 uCore;
  uniform vec3 uPlasma;
  uniform vec3 uCorona;
  uniform float uSeed;
  uniform float uConvection;
  uniform float uTime;
  uniform float uOpacity;
  ${noiseGLSL}
  void main() {
    vec3 p = normalize(vSurface);
    vec3 drift = vec3(uSeed, uTime * 0.009, uSeed * 0.7);
    float broad = fbm(p * 4.8 + drift);
    float activity = fbm(p * uConvection + broad * 2.9 + drift);
    float granules = noise(p * 61.0 + drift);
    float veins = 1.0 - smoothstep(0.014, 0.065, abs(activity - 0.47));
    float darkPlasma = smoothstep(0.34, 0.65, broad);
    float limb = pow(max(dot(normalize(vNormal), normalize(vView)), 0.0), 0.26);
    vec3 surface = mix(uPlasma * 0.48, uCore, clamp(darkPlasma * 0.50 + activity * 0.27 + granules * 0.13, 0.0, 1.0));
    surface += uCorona * veins * (0.19 + broad * 0.34);
    vec3 color = surface * (0.49 + limb * 0.72);
    color += uCore * pow(1.0 - limb, 2.5) * 0.32;
    gl_FragColor = vec4(color, uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const shellFragment = `
  varying vec3 vSurface;
  varying vec3 vNormal;
  varying vec3 vView;
  uniform vec3 uCorona;
  uniform float uSeed;
  uniform float uTime;
  uniform float uOpacity;
  ${noiseGLSL}
  void main() {
    float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.8);
    float plasma = fbm(normalize(vSurface) * 11.0 + vec3(uSeed, uTime * 0.009, 0.0));
    float lace = 1.0 - smoothstep(0.015, 0.10, abs(plasma - 0.5));
    gl_FragColor = vec4(uCorona * 1.12, rim * (0.10 + lace * 0.32) * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const diskVertex = `
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const diskFragment = `
  varying vec3 vLocal;
  uniform vec3 uCorona;
  uniform float uOpacity;
  uniform float uTime;
  uniform float uSeed;
  ${noiseGLSL}
  void main() {
    float r = length(vLocal.xy);
    float edges = smoothstep(1.62, 1.94, r) * (1.0 - smoothstep(2.2, 3.1, r));
    float dust = fbm(vLocal * 9.0 + vec3(uSeed, uTime * 0.003, 0.0));
    float fine = sin(r * 113.0) * 0.5 + 0.5;
    float angle = atan(vLocal.y, vLocal.x);
    float broken = 0.55 + 0.45 * sin(angle * 3.0 + r * 7.0);
    gl_FragColor = vec4(uCorona, edges * (0.035 + fine * 0.035 + dust * 0.055) * broken * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function coronaTexture() {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(
        (x + 0.5 - size / 2) / (size / 2),
        (y + 0.5 - size / 2) / (size / 2),
      );
      const offset = (y * size + x) * 4;
      data[offset] = data[offset + 1] = data[offset + 2] = 255;
      data[offset + 3] = Math.round(
        Math.max(0, Math.exp(-r * r * 6.0) - Math.exp(-6.0)) * 210,
      );
    }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Physical photosphere, magnetic loops and a restrained, optional dust disc. */
export function createStar(options: {
  seed: string;
  radius: number;
  mobile: boolean;
}): StellarBody {
  const style = getStarStyle(options.seed);
  const random = seededRandom(`${options.seed}:photosphere`);
  const radius = Number.isFinite(options.radius)
    ? THREE.MathUtils.clamp(options.radius, 0.05, 8)
    : 1;
  const group = new THREE.Group();
  group.name = `star-${style.kind}`;
  group.userData = { celestialType: "star", starKind: style.kind };
  const geometry = new THREE.SphereGeometry(
    radius,
    options.mobile ? 24 : 40,
    options.mobile ? 16 : 28,
  );
  const geometries = new Set<THREE.BufferGeometry>([geometry]);
  const materials = new Set<THREE.Material>();
  const shaders: THREE.ShaderMaterial[] = [];
  const uniforms = () => ({
    uCore: { value: new THREE.Color(style.core) },
    uPlasma: { value: new THREE.Color(style.plasma) },
    uCorona: { value: new THREE.Color(style.corona) },
    uConvection: {
      value: { azure: 12, ivory: 28, violet: 17, amber: 21 }[style.kind],
    },
    uSeed: { value: random() * 80 },
    uTime: { value: 0 },
    uOpacity: { value: 1 },
  });
  const register = (material: THREE.ShaderMaterial) => {
    materials.add(material);
    shaders.push(material);
    return material;
  };
  const surface = register(
    new THREE.ShaderMaterial({
      vertexShader: surfaceVertex,
      fragmentShader: surfaceFragment,
      uniforms: uniforms(),
      transparent: true,
    }),
  );
  const body = new THREE.Mesh(geometry, surface);
  body.name = "stellar-photosphere";
  body.userData = { celestialType: "star", starKind: style.kind };
  body.rotation.set(random() * 0.6, random() * Math.PI * 2, random() * 0.5);
  group.add(body);
  const shell = new THREE.Mesh(
    geometry,
    register(
      new THREE.ShaderMaterial({
        vertexShader: surfaceVertex,
        fragmentShader: shellFragment,
        uniforms: uniforms(),
        transparent: true,
        depthWrite: false,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
      }),
    ),
  );
  shell.name = "stellar-plasma-shell";
  shell.scale.setScalar(style.kind === "azure" ? 1.075 : 1.05);
  group.add(shell);

  const texture = coronaTexture();
  const coronaOpacity = style.kind === "ivory" ? 0.38 : 0.48;
  const coronaMaterial = new THREE.SpriteMaterial({
    map: texture,
    color: style.corona,
    transparent: true,
    opacity: coronaOpacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  materials.add(coronaMaterial);
  const corona = new THREE.Sprite(coronaMaterial);
  corona.name = "stellar-corona";
  corona.scale.set(radius * 4.8, radius * 4.8, 1);
  group.add(corona);

  // Small anchored loops leave the central title and outer excerpts clear.
  const loopMaterial = new THREE.MeshBasicMaterial({
    color: style.corona,
    transparent: true,
    opacity: 0.22,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  materials.add(loopMaterial);
  const loops = new THREE.Group();
  loops.name = "stellar-prominences";
  for (let index = 0; index < (options.mobile ? 3 : 5); index++) {
    const angle = random() * Math.PI * 2;
    const height = 0.14 + random() * 0.22;
    const points: THREE.Vector3[] = [];
    for (let step = 0; step <= 16; step++) {
      const t = step / 16;
      const theta = angle + (t - 0.5) * 0.46;
      const r = radius * (1.002 + Math.sin(t * Math.PI) * height);
      points.push(
        new THREE.Vector3(
          Math.cos(theta) * r,
          Math.sin(theta) * r,
          Math.sin(t * Math.PI) * radius * 0.1,
        ),
      );
    }
    const loopGeometry = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(points),
      options.mobile ? 16 : 24,
      radius * 0.0055,
      4,
      false,
    );
    geometries.add(loopGeometry);
    const loop = new THREE.Mesh(loopGeometry, loopMaterial);
    loop.rotation.set(random() * 0.6 - 0.3, random() * 0.9 - 0.45, 0);
    loops.add(loop);
  }
  group.add(loops);

  if (style.hasDisk) {
    const diskGeometry = new THREE.RingGeometry(
      1.62,
      3.1,
      options.mobile ? 64 : 112,
    );
    geometries.add(diskGeometry);
    const diskMaterial = register(
      new THREE.ShaderMaterial({
        vertexShader: diskVertex,
        fragmentShader: diskFragment,
        uniforms: uniforms(),
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    const disk = new THREE.Mesh(diskGeometry, diskMaterial);
    disk.name = "stellar-debris-disc";
    disk.scale.setScalar(radius);
    disk.rotation.set(1.2 + random() * 0.16, -0.15, -0.28 + random() * 0.56);
    group.add(disk);
  }

  let lastTime: number | undefined;
  let motionTime = 0;
  let disposed = false;
  return {
    group,
    kind: style.kind,
    update(time, reducedMotion, paused = false) {
      if (disposed) return;
      const currentTime = Number.isFinite(time) ? time : (lastTime ?? 0);
      const delta =
        lastTime === undefined
          ? 0
          : Math.max(0, Math.min(0.1, currentTime - lastTime));
      lastTime = currentTime;
      if (!reducedMotion && !paused) {
        motionTime += delta;
        body.rotation.y += delta * 0.014;
        shell.rotation.y += delta * 0.01;
        loops.rotation.y += delta * 0.014;
      }
      shaders.forEach((material) => {
        material.uniforms.uTime.value = motionTime;
      });
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
      coronaMaterial.opacity = alpha * coronaOpacity;
      loopMaterial.opacity = alpha * 0.22;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      geometries.forEach((item) => item.dispose());
      materials.forEach((item) => item.dispose());
      texture.dispose();
      group.removeFromParent();
      group.clear();
    },
  };
}
