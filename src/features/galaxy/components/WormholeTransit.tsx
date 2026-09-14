import { useEffect, useRef } from "react";
import { advanceWormholeTravel, wormholeRevealOpacity, WORMHOLE_TRAVEL_MS } from "./space/wormhole";
import "./wormhole.css";

export interface WormholeTransitProps {
  direction: "in" | "out";
  reducedMotion: boolean;
  ready?: boolean;
  onComplete: () => void;
}

const vertexSource = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

// A cylindrical, textured light field fills the viewport. The coordinates are
// pinned to its exact centre, including the first frame. No camera pan is used.
const fragmentSource = `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform float progress;
uniform sampler2D grain;
const float TAU = 6.28318530718;
float tex(vec2 p) { return texture2D(grain, p).r; }
float fbm(vec2 p) {
  return tex(p) * .58 + tex(p * 2.0 + .17) * .28 + tex(p * 4.0 + .37) * .14;
}
void main() {
  vec2 p = (gl_FragCoord.xy - resolution * .5) / min(resolution.x,resolution.y);
  // Elliptical optics suggest a wide lens, while the vanishing point is invariant.
  p.x *= .91;
  float r = max(length(p), .001);
  float a = atan(p.y,p.x) / TAU;
  float travel = smoothstep(0.0,.45,progress);
  float depth = 1.0 / (r + .052);
  float bend = sin(depth * .42) * .025;
  float angle = a + bend + log(r+.03) * .021;
  float flow = time * (.20 + travel*.22);
  vec2 wall = vec2(angle * 2.0, depth * .046 - flow*.16);
  float cloud = fbm(wall);
  float detail = fbm(wall * vec2(4.0,1.35) + vec2(0.0,-flow*.09));
  float throat = smoothstep(.031,.115,r);
  vec3 color;
    // Dense longitudinal light fibres are sampled on the tube surface; layers
    // differ in depth, speed and thickness instead of forming flat radial spokes.
    float fibres = pow(tex(vec2(angle*11.0, depth*.018-flow*.09)), 5.0);
    float fine = pow(tex(vec2(angle*38.0, depth*.010-flow*.11)), 8.0);
    float filament = fibres*2.1 + fine*5.8;
    float sheets = pow(tex(vec2(angle*4.0+cloud*.09,depth*.027-flow*.12)),3.0);
    float archPhase = depth*.70-flow*3.1+cloud*.62;
    float arches = pow(.5+.5*cos(archPhase*TAU),30.0);
    float archGlow = pow(.5+.5*cos(archPhase*TAU),5.0);
    float glints = pow(tex(vec2(angle*22.0,depth*.27-flow*.65)),12.0)*18.0;
    float body = .09 + cloud*.24 + detail*.11;
    color = vec3(.026,.071,.11) + vec3(.18,.43,.53)*body;
    color += mix(vec3(.21,.52,.67),vec3(.60,.75,1.0),detail)*filament;
    color += vec3(.20,.50,.62)*sheets*.9;
    color += vec3(.41,.72,.86)*arches*(.18+detail*.72);
    color += vec3(.12,.37,.47)*archGlow*.44;
    color += vec3(.62,.83,1.0)*glints;
    // Different coherent streams illuminate the left and right tunnel walls.
    float beam = pow(.5+.5*sin(angle*TAU*5.0+depth*.15),32.0);
    color += vec3(.44,.67,.90)*beam*(.14+fibres*2.0);
    float rim = exp(-pow((r-.087)/.055,2.0));
    color += vec3(.23,.63,.92)*rim*.8;
    vec3 endpoint = vec3(.56,.82,.94) + vec3(.20,.24,.25)*exp(-r*60.0);
    color = mix(endpoint,color,throat);
    float reveal = smoothstep(.73,.94,progress);
    color += vec3(.36,.65,.81)*reveal*exp(-r/(.075+reveal*.30));
  float vignette = 1.0-smoothstep(.45,1.35,r)*.37;
  color *= vignette;
  // Filmic highlight compression retains detail even in the bright entry tube.
  color = vec3(1.0)-exp(-color*1.47);
  color = pow(color,vec3(.84));
  gl_FragColor = vec4(color,1.0);
}
`;

let cachedNoise: Uint8Array | undefined;
function noisePixels() {
  if (cachedNoise) return cachedNoise;
  const pixels = new Uint8Array(256 * 256 * 4);
  const random = (x: number, y: number) => {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return n - Math.floor(n);
  };
  const value = (x: number, y: number, period: number) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const tx = x - ix, ty = y - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = random(ix % period, iy % period), b = random((ix + 1) % period, iy % period);
    const c = random(ix % period, (iy + 1) % period), d = random((ix + 1) % period, (iy + 1) % period);
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  };
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const n = value(x / 32, y / 32, 8) * .52 + value(x / 16, y / 16, 16) * .28 + value(x / 8, y / 8, 32) * .14 + value(x / 4, y / 4, 64) * .06;
    const i = (y * 256 + x) * 4;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = Math.round(n * 255);
    pixels[i + 3] = 255;
  }
  cachedNoise = pixels;
  return pixels;
}

const rendererLifetimes = new WeakMap<HTMLCanvasElement, symbol>();
function createLightField(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "low-power" });
  if (!gl) return null;
  const lifetime = Symbol("wormhole-light-field");
  rendererLifetimes.set(canvas, lifetime);
  const shaders: WebGLShader[] = [];
  const program = gl.createProgram();
  if (!program) return null;
  for (const [kind, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]] as const) {
    const shader = gl.createShader(kind);
    if (!shader) { gl.deleteProgram(program); return null; }
    shaders.push(shader);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      for (const item of shaders) gl.deleteShader(item);
      gl.deleteProgram(program);
      return null;
    }
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  for (const shader of shaders) gl.deleteShader(shader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); return null; }
  const buffer = gl.createBuffer();
  const texture = gl.createTexture();
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, noisePixels());
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.uniform1i(gl.getUniformLocation(program, "grain"), 0);
  const resolution = gl.getUniformLocation(program, "resolution");
  const time = gl.getUniformLocation(program, "time");
  const progress = gl.getUniformLocation(program, "progress");
  return {
    draw(clock: number, position: number) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(resolution, canvas.width, canvas.height);
      gl.uniform1f(time, clock);
      gl.uniform1f(progress, position);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      // StrictMode immediately reuses this canvas. Release a genuinely unmounted
      // context after that replay so repeated trips do not exhaust browser slots.
      queueMicrotask(() => {
        if (rendererLifetimes.get(canvas) !== lifetime) return;
        rendererLifetimes.delete(canvas);
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      });
    },
  };
}

/** One triangle, a cached 256px noise map and a capped drawing buffer bound GPU cost. */
export default function WormholeTransit({ direction, reducedMotion, ready = true, onComplete }: WormholeTransitProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef({ ready, onComplete });
  useEffect(() => { latest.current = { ready, onComplete }; }, [ready, onComplete]);

  useEffect(() => {
    const element = canvas.current;
    const container = root.current;
    if (!element || !container) return;
    const renderer = reducedMotion ? null : createLightField(element);
    container.dataset.renderer = renderer ? "light-field" : "still";
    let progress = 0;
    let time = 0;
    let frame = 0;
    let previous = 0;
    let complete = false;
    let lastDraw = 0;
    const duration = reducedMotion ? 200 : WORMHOLE_TRAVEL_MS[direction];
    const draw = () => {
      const opacity = wormholeRevealOpacity(progress, latest.current.ready);
      container.style.opacity = String(opacity);
      container.dataset.progress = progress.toFixed(4);
      container.dataset.reveal = String(1 - opacity);
      renderer?.draw(time, progress);
    };
    const resize = () => {
      const width = container.clientWidth || innerWidth, height = container.clientHeight || innerHeight;
      // Full-screen shaders are limited to 0.9M pixels, including high-DPI screens.
      const ratio = Math.min(devicePixelRatio || 1, 1.25, Math.sqrt(900_000 / (width * height)));
      element.width = Math.max(1, Math.round(width * ratio));
      element.height = Math.max(1, Math.round(height * ratio));
      draw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    const tick = (now: number) => {
      if (complete) return;
      frame = requestAnimationFrame(tick);
      const dt = Math.min(50, previous ? now - previous : 0);
      previous = now;
      if (document.hidden) return;
      progress = advanceWormholeTravel(progress, dt, duration, latest.current.ready);
      time += dt / 1000;
      if (now - lastDraw >= 30 || progress >= 1) { draw(); lastDraw = now; }
      if (progress >= 1 && latest.current.ready) {
        complete = true;
        cancelAnimationFrame(frame);
        latest.current.onComplete();
      }
    };
    frame = requestAnimationFrame(tick);
    return () => { complete = true; cancelAnimationFrame(frame); observer.disconnect(); renderer?.dispose(); };
  }, [direction, reducedMotion]);

  return (
    <div ref={root} className={`wormhole-transit wormhole-transit-${direction}`} data-direction={direction} data-visual="blue-white" data-ready={ready} data-center-x="0.5" data-center-y="0.5" role="status" aria-live="polite" aria-label={direction === "in" ? "正在穿越虫洞" : "正在抵达星系团"}>
      <canvas ref={canvas} aria-hidden="true" />
    </div>
  );
}
