import * as THREE from 'three';
import { createClusterLayout } from './cluster-layout';

export const PARALLEL_PORTAL_KINDS = ['halo', 'pearl', 'golden-vortex', 'tidal', 'coral'] as const;
export type ParallelPortalKind = (typeof PARALLEL_PORTAL_KINDS)[number];

export interface ParallelPortalSpec {
  kind: ParallelPortalKind;
  radius: number;
  phase: number;
  inclination: number;
  rotation: number;
  seed: number;
}

function seededRandom(seed: string) {
  let state = 2166136261;
  for (const character of seed) state = Math.imul(state ^ character.charCodeAt(0), 16777619) >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function getParallelPortalSpec(seed: string, index: number): ParallelPortalSpec {
  const random = seededRandom(seed);
  const kindIndex = ((Math.trunc(Number.isFinite(index) ? index : 0) % 5) + 5) % 5;
  return {
    kind: PARALLEL_PORTAL_KINDS[kindIndex],
    radius: 3.7 + random() * .6,
    phase: random() * Math.PI * 2,
    inclination: kindIndex === 0 ? .53 + random() * .12 : kindIndex === 1 ? .68 + random() * .1 : .77 + random() * .19,
    rotation: (random() - .5) * 1.3,
    seed: random() * 40,
  };
}

/** Volumetric anchors retain the original sky's balanced orbit projections. */
export function createParallelLayout(ids: readonly string[], mobile = false): THREE.Vector3[] {
  // A viewport resize changes camera framing, never the identity of an anchor.
  void mobile;
  return createClusterLayout(ids, { spacing: 19 });
}

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  // Physical anchors are projected in 3D; only each small luminous aperture
  // faces the observer. Dragging cannot turn a portal into an invisible edge.
  vec4 center = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec2 scale = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
  center.xy += position.xy * scale;
  gl_Position = projectionMatrix * center;
}`;

const fragmentShader = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uSeed;
uniform float uPhase;
uniform float uInclination;
uniform float uRotation;
uniform float uKind;
uniform float uHighlight;

float hash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float noise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                 mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                 mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float value = 0.0, amplitude = 0.55;
  for (int i = 0; i < DETAIL_OCTAVES; i++) {
    value += noise(p) * amplitude;
    p = p * 2.13 + vec3(1.7, 9.2, 4.6);
    amplitude *= 0.48;
  }
  return value;
}
float band(float r, float radius, float width) {
  float d = (r - radius) / width;
  return exp(-d * d);
}
void main() {
  vec2 screen = (vUv - 0.5) * 2.0;
  float angle = uRotation;
  mat2 rotation = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
  vec2 p = rotation * screen;
  p.y /= uInclination;
  float t = uTime * 0.037 + uPhase;
  vec2 centerOffset = uKind > 0.5 && uKind < 1.5 ? vec2(-0.095, 0.025) : vec2(0.0);
  vec2 local = p - centerOffset;
  float r = length(local), a = atan(local.y, local.x);
  float outer = 1.0 - smoothstep(0.70, 1.0, r);
  if (outer < 0.001) discard;
  float broad = fbm(vec3(p * 5.8, uSeed + t * 0.3));
  float twist = a + log(r + 0.12) * 4.1 - t;
  float stream = fbm(vec3(vec2(cos(twist), sin(twist)) * 4.2, r * 8.0 + uSeed));
  float fine = noise(vec3(p * 99.0, uSeed));
  float rimRadius = 0.245;
  float throat = 1.0 - smoothstep(rimRadius - 0.025, rimRadius + 0.036, r);
  float plasma = 0.0, rim = 0.0;
  vec3 color = vec3(0.0);

  if (uKind < 0.5) {
    // A compressed accretion halo: warm dust, an ivory photon edge and a
    // separate arcing outer halo, rather than another recolored spiral.
    float inner = band(r, 0.275 + (broad - 0.5) * .022, .047);
    float halo = band(r, .43, .18) * (.34 + stream * .78);
    float shoulder = band(r, .66, .095) * (.18 + broad * .65);
    float slit = exp(-pow((p.y + .025) / .036, 2.0)) * (1.0 - smoothstep(.46, .87, abs(p.x)));
    plasma = inner * .65 + halo + shoulder * .6 + slit * .5;
    color = vec3(.83, .68, .57) * halo + vec3(.68, .73, 1.0) * shoulder * .8;
    color += vec3(1.0, .93, .79) * (inner * 1.9 + slit * .5);
    rim = band(r, .254, .008) * 1.15;
  } else if (uKind < 1.5) {
    // Pearlescent folds descend toward an off-centre throat, like light
    // refracting through a transparent funnel.
    float fold = .5 + .5 * sin(4.0 * a + log(r + .13) * 19.0 - t * 1.7 + broad * 2.0);
    float skin = band(r, .48, .255) * (.25 + stream * .85);
    float glass = pow(fold, 9.0) * skin;
    float whiteRim = band(r, .28, .047) * (.55 + broad);
    vec3 iridescence = .8 + .17 * cos(vec3(.15, 2.2, 4.15) + r * 9.0 + a * .8);
    color = iridescence * (skin * .63 + glass * .7) + vec3(.8, .92, 1.0) * whiteRim * 1.7;
    plasma = skin + glass * .4 + whiteRim;
    rim = band(r, .246, .011) * .55;
  } else if (uKind < 2.5) {
    // Three broad golden plumes spiral through fine granular wake material.
    float arms = .5 + .5 * sin(a * 3.0 + log(r + .14) * 12.4 - t * 2.0 + stream * 2.7);
    float wake = pow(arms, 2.3) * band(r, .52, .28) * (.24 + stream * 1.1);
    float filaments = pow(arms, 15.0) * (.2 + fine * .8) * band(r, .49, .29);
    plasma = wake + band(r, .31, .095) * .6;
    color = mix(vec3(.83, .25, .055), vec3(1.0, .77, .38), broad) * wake;
    color += vec3(1.0, .9, .63) * (filaments * 1.6 + band(r, .27, .035) * 1.15);
    rim = band(r, .25, .008) * .8;
  } else if (uKind < 3.5) {
    // An open teal whirlpool has thin sheared currents and a larger, quiet
    // throat. Its filaments remain distinct from the broad golden plumes.
    float current = .5 + .5 * sin(a * 5.0 + log(r + .11) * 17.0 - t * 2.1 + stream * 3.0);
    float narrow = pow(current, 6.0);
    float flow = band(r, .49, .25) * (.12 + stream * .8);
    plasma = flow * (.42 + narrow * 1.6);
    color = mix(vec3(.015, .22, .36), vec3(.12, .91, .83), broad) * plasma * 1.2;
    color += vec3(.48, .94, 1.0) * band(r, .28, .055) * (.3 + stream);
    rim = band(r, .258 + sin(a * 6.0 + t) * .004, .008) * .32;
  } else {
    // Coral plasma lights only part of a ragged blue rim, with asymmetric
    // wakes and dark spaces between the streams.
    float arms = .5 + .5 * sin(a * 2.0 + log(r + .12) * 12.0 - t + stream * 3.0);
    float crescent = .25 + .75 * pow(.5 + .5 * cos(a - .7), 2.0);
    float wake = pow(arms, 4.0) * band(r, .54, .29) * (.35 + broad);
    float edge = band(r, .32 + .014 * sin(a * 3.0 + t), .075) * (.3 + stream);
    color = mix(vec3(.10, .43, .67), vec3(1.0, .28, .17), crescent) * (wake + edge);
    color += vec3(1.0, .75, .55) * pow(crescent, 2.0) * band(r, .35, .036) * (.4 + broad);
    plasma = wake * .8 + edge;
    rim = band(r, .26, .008) * .5;
  }
  // Fine fixed grains twinkle very slowly; there is no screen-space noise or
  // rapidly flickering particle soup behind the labels.
  float grains = pow(max(0.0, fine - .53) * 2.12, 8.0) * plasma * 1.5;
  vec3 hazeColor = uKind < .5 ? vec3(.51, .53, .69) : uKind < 1.5 ? vec3(.56, .63, .85) : uKind < 2.5 ? vec3(.89, .46, .20) : uKind < 3.5 ? vec3(.10, .61, .61) : vec3(.35, .38, .69);
  float haze = band(r, .56, .25) * pow(broad, 1.7) * 1.6;
  color += hazeColor * haze * .21;
  color += vec3(.78, .91, 1.0) * grains;
  color += vec3(.84, .94, 1.0) * rim;
  color *= (1.0 - throat * .97) * (1.08 + uHighlight * .35);
  float luminousAlpha = clamp(plasma * .84 + rim * .6 + grains * .35 + haze * .25, 0.0, .94);
  float alpha = max(luminousAlpha, throat * .87) * outer;
  color = mix(color, vec3(.002, .007, .017), throat * .99);
  gl_FragColor = vec4(color, alpha);
  #include <colorspace_fragment>
}`;

export interface ParallelPortal {
  group: THREE.Group;
  kind: ParallelPortalKind;
  radius: number;
  update: (time: number, reducedMotion: boolean, highlighted?: boolean) => void;
  dispose: () => void;
}

/** One bounded shader quad per topic, with no texture, reflection or DOM dependency. */
export function createParallelPortal(seed: string, index: number, options: { mobile?: boolean } = {}): ParallelPortal {
  const spec = getParallelPortalSpec(seed, index);
  const group = new THREE.Group();
  group.name = `parallel-portal-${spec.kind}`;
  group.userData.kind = spec.kind;
  group.userData.radius = spec.radius;
  group.userData.drawCalls = 1;
  const geometry = new THREE.PlaneGeometry(spec.radius * 2, spec.radius * 2);
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    defines: { DETAIL_OCTAVES: options.mobile ? 3 : 4 },
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: spec.seed },
      uPhase: { value: spec.phase },
      uInclination: { value: spec.inclination },
      uRotation: { value: spec.rotation },
      uKind: { value: PARALLEL_PORTAL_KINDS.indexOf(spec.kind) },
      uHighlight: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    toneMapped: false,
  });
  const aperture = new THREE.Mesh(geometry, material);
  aperture.name = 'parallel-portal-aperture';
  group.add(aperture);
  let disposed = false;
  return {
    group,
    kind: spec.kind,
    radius: spec.radius,
    update(time, reducedMotion, highlighted = false) {
      if (disposed) return;
      material.uniforms.uTime.value = reducedMotion || !Number.isFinite(time) ? 0 : Math.max(0, time);
      material.uniforms.uHighlight.value = highlighted ? 1 : 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      geometry.dispose();
      material.dispose();
      group.clear();
    },
  };
}
