import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Answer, Question } from '../types';
import './galaxy.css';

interface GalaxySceneProps {
  questions: Question[];
  selectedQuestionId: string | null;
  selectedAnswerId: string | null;
  depth: number;
  onDepthChange: (depth: number) => void;
  onSelectQuestion: (id: string) => void;
  onSelectAnswer: (id: string) => void;
  flightMode: boolean;
  reducedMotion: boolean;
  resetToken: number;
  relevanceLabel?: string;
}

interface GalaxyNode {
  question: Question;
  position: THREE.Vector3;
  answers: { answer: Answer; position: THREE.Vector3 }[];
}

type ProjectedLabel = { key: string; position: THREE.Vector3; relevance: number; selected: boolean };
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const smooth = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };
const relevance = (value: number) => clamp(value > 1 ? value / 100 : value);
const coordinates = [
  [28, 8, 14], [-75, 52, -38], [125, 62, -56], [-114, -57, -10],
  [108, -73, -34], [-179, 14, -102], [-12, -97, -65], [180, -5, -122],
  [18, 108, -115], [-172, 105, -132], [184, 117, -155], [-160, -127, -150],
];

function seededRandom(seed: string) {
  let value = Array.from(seed).reduce((sum, char) => Math.imul(sum ^ char.charCodeAt(0), 16777619), 2166136261) >>> 0;
  return () => { value += 0x6D2B79F5; let t = value; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function makeLayout(questions: Question[]): GalaxyNode[] {
  return questions.map((question, index) => {
    const coordinate = coordinates[index % coordinates.length];
    const spread = 1 + Math.floor(index / coordinates.length) * 0.36;
    const position = new THREE.Vector3(coordinate[0] * spread, coordinate[1] * spread, coordinate[2] - Math.floor(index / coordinates.length) * 50);
    return {
      question, position,
      answers: question.answers.map((answer, answerIndex) => {
        const angle = answerIndex * 2.399963 + index * 0.4 + 0.65;
        const radius = question.answers.length === 1 ? 0 : 15 + Math.sqrt(answerIndex) * 10;
        return { answer, position: new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.65, Math.sin(angle * 1.7) * 7).add(position) };
      }),
    };
  });
}

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.035, 'rgba(255,255,255,.98)');
    gradient.addColorStop(0.1, 'rgba(225,241,255,.65)');
    gradient.addColorStop(0.24, 'rgba(181,213,255,.17)');
    gradient.addColorStop(0.6, 'rgba(140,190,255,.035)');
    gradient.addColorStop(1, 'rgba(140,190,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(canvas);
}

function pointMaterial(pixelRatio: number, opacity = 1) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uOpacity: { value: opacity }, uPixelRatio: { value: pixelRatio }, uTime: { value: 0 } },
    vertexShader: `
      attribute float size;
      attribute vec3 color;
      varying vec3 vColor;
      uniform float uPixelRatio;
      uniform float uTime;
      void main() {
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        float shimmer = 0.93 + 0.07 * sin(uTime * 0.45 + position.x * 2.0);
        gl_PointSize = clamp(size * (550.0 / max(8.0, -mvPosition.z)) * uPixelRatio * shimmer, 0.65, 25.0 * uPixelRatio);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      uniform float uOpacity;
      void main() {
        float radius = length(gl_PointCoord - vec2(0.5));
        if (radius > 0.5) discard;
        float core = exp(-radius * radius * 48.0);
        float halo = exp(-radius * radius * 13.0) * 0.26;
        gl_FragColor = vec4(vColor, (core + halo) * uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

function createParticles(positions: number[], colors: number[], sizes: number[], material: THREE.ShaderMaterial) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
  return new THREE.Points(geometry, material);
}

function createCloud(random: () => number, count: number, radius: number, color: THREE.Color, brightness: number, pixelRatio: number) {
  const positions: number[] = [], colors: number[] = [], sizes: number[] = [];
  const white = new THREE.Color('#dceafa');
  for (let index = 0; index < count; index++) {
    const r = Math.pow(random(), 0.68) * radius;
    const arm = Math.floor(random() * 4) * Math.PI / 2;
    const angle = arm + (r / radius) * 4.8 + (random() - 0.5) * (1.7 - (r / radius) * 0.8);
    const loose = random() > 0.83 ? 1.7 : 1;
    positions.push(Math.cos(angle) * r * loose, Math.sin(angle) * r * 0.58 * loose, (random() + random() - 1) * radius * 0.11);
    const c = color.clone().lerp(white, Math.pow(random(), 2) * 0.75);
    c.multiplyScalar((0.38 + random() * 0.62) * brightness);
    colors.push(c.r, c.g, c.b);
    const size = random();
    sizes.push(size > 0.986 ? 2.6 + random() * 1.9 : size > 0.87 ? 1.1 + random() * 0.8 : 0.35 + random() * 0.9);
  }
  return createParticles(positions, colors, sizes, pointMaterial(pixelRatio));
}

const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (!!target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]'));

export default function GalaxyScene(props: GalaxySceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef(new Map<string, HTMLDivElement>());
  const propsRef = useRef(props);
  propsRef.current = props;
  const [webglAvailable, setWebglAvailable] = useState(true);
  const [dragging, setDragging] = useState(false);
  const layout = useMemo(() => makeLayout(props.questions), [props.questions]);
  const selectedQuestion = props.questions.find(question => question.id === props.selectedQuestionId) ?? props.questions[0];
  const selectedAnswer = selectedQuestion?.answers.find(answer => answer.id === props.selectedAnswerId) ?? selectedQuestion?.answers[0];
  const stage = props.depth < 0.65 ? 0 : props.depth < 1.65 ? 1 : 2;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !layout.length) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
    } catch {
      setWebglAvailable(false);
      return;
    }
    setWebglAvailable(true);
    const isMobile = container.clientWidth < 760;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 1.75);
    renderer.setPixelRatio(pixelRatio);
    renderer.setClearColor('#060b12', 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(48, 1, 0.5, 2600);
    const texture = glowTexture();
    const sceneMaterials: THREE.ShaderMaterial[] = [];
    const cloudMaterials = new Map<string, THREE.ShaderMaterial>();
    const answerMaterials = new Map<string, THREE.ShaderMaterial>();
    const answerSprites = new Map<string, THREE.Sprite>();
    const questionSprites = new Map<string, THREE.Sprite>();
    const cloudGroups: THREE.Group[] = [];
    let width = container.clientWidth, height = container.clientHeight;
    let destroyed = false, contextLost = false, hidden = document.hidden, frame = 0, elapsed = 0, lastTime = 0;
    let userYaw = -0.055, userPitch = 0.04, yaw = userYaw, pitch = userPitch;
    let previousReset = propsRef.current.resetToken;
    let previousQuestion = propsRef.current.selectedQuestionId;
    const flightOffset = new THREE.Vector3();
    const target = new THREE.Vector3(12, 0, 0);
    const desiredTarget = new THREE.Vector3();
    const desiredPosition = new THREE.Vector3();
    const projected = new THREE.Vector3();
    const currentPosition = new THREE.Vector3(12, 15, 335);
    const keys = new Set<string>();
    const pointers = new Map<number, { x: number; y: number }>();
    let pointerStart = { x: 0, y: 0 }, moved = false, pinchDistance = 0;

    const backgroundRandom = seededRandom('wanderwise-observable-universe');
    const backgroundPositions: number[] = [], backgroundColors: number[] = [], backgroundSizes: number[] = [];
    const backgroundPalette = ['#7da5bc', '#7b8ea8', '#d9d5be', '#567897', '#94bbbf'];
    for (let i = 0; i < (isMobile ? 2100 : 5400); i++) {
      backgroundPositions.push((backgroundRandom() - 0.5) * 1450, (backgroundRandom() - 0.5) * 950, -180 - backgroundRandom() * 1100);
      const color = new THREE.Color(backgroundPalette[Math.floor(backgroundRandom() * backgroundPalette.length)]).multiplyScalar(0.25 + backgroundRandom() * 0.55);
      backgroundColors.push(color.r, color.g, color.b);
      backgroundSizes.push(backgroundRandom() > 0.995 ? 2.8 : 0.3 + backgroundRandom() * 1.7);
    }
    const background = createParticles(backgroundPositions, backgroundColors, backgroundSizes, pointMaterial(pixelRatio, 0.75));
    sceneMaterials.push(background.material);
    scene.add(background);

    layout.forEach((node, index) => {
      const random = seededRandom(node.question.id);
      const r = relevance(node.question.relevance);
      const color = new THREE.Color(node.question.color || ['#9fa8ec', '#79bfc6', '#d4bba0'][index % 3]);
      const group = new THREE.Group();
      group.position.copy(node.position);
      group.rotation.z = index * 0.58 + 0.22;
      group.rotation.x = (index % 3 - 1) * 0.18;
      const dust = createCloud(random, Math.floor((isMobile ? 1050 : 2350) * (0.55 + r * 0.65)), 28 + r * 22, color, 0.35 + r * 0.75, pixelRatio);
      group.add(dust);
      sceneMaterials.push(dust.material);
      cloudMaterials.set(node.question.id, dust.material);
      scene.add(group);
      cloudGroups.push(group);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, color, transparent: true, opacity: 0.4 + r * 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
      halo.position.copy(node.position);
      halo.scale.setScalar(33 + r * 23);
      questionSprites.set(node.question.id, halo);
      scene.add(halo);
      node.answers.forEach(({ answer, position }, answerIndex) => {
        const answerColor = color.clone().lerp(new THREE.Color('#eef2e5'), 0.26 + answerIndex % 3 * 0.12);
        const star = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, color: answerColor, transparent: true, opacity: 0.46, blending: THREE.AdditiveBlending, depthWrite: false }));
        star.position.copy(position);
        star.scale.setScalar(9 + relevance(answer.relevance) * 8);
        scene.add(star);
        answerSprites.set(answer.id, star);
        const cloud = createCloud(random, isMobile ? 110 : 280, 4.5 + random() * 2.8, answerColor, 0.3 + relevance(answer.relevance) * 0.7, pixelRatio);
        cloud.position.copy(position);
        cloud.rotation.z = answerIndex * 1.3;
        scene.add(cloud);
        answerMaterials.set(answer.id, cloud.material);
        sceneMaterials.push(cloud.material);
      });
    });

    const connections = new THREE.Group();
    const curves: THREE.QuadraticBezierCurve3[] = [];
    const lineMaterial = new THREE.LineBasicMaterial({ color: '#7897a3', transparent: true, opacity: 0.085, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 1; i < layout.length; i++) {
      const start = layout[Math.max(0, Math.floor((i - 1) / 2))].position;
      const end = layout[i].position;
      const middle = start.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 13 + i * 2, -12));
      const curve = new THREE.QuadraticBezierCurve3(start, middle, end);
      curves.push(curve);
      connections.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(48)), lineMaterial));
    }
    scene.add(connections);
    const botPositions = new Float32Array(Math.max(1, curves.length) * 3);
    const botGeometry = new THREE.BufferGeometry();
    botGeometry.setAttribute('position', new THREE.BufferAttribute(botPositions, 3));
    const botMaterial = new THREE.PointsMaterial({ size: 1, color: '#d6e7db', map: texture, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
    const bots = new THREE.Points(botGeometry, botMaterial);
    scene.add(bots);

    const orbitGeometry = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 129 }, (_, i) => new THREE.Vector3(Math.cos(i / 128 * Math.PI * 2), Math.sin(i / 128 * Math.PI * 2) * 0.6, 0)));
    const orbitMaterial = new THREE.LineDashedMaterial({ color: '#d4c9a7', transparent: true, opacity: 0.24, dashSize: 0.025, gapSize: 0.055, depthWrite: false });
    const selectionOrbit = new THREE.Line(orbitGeometry, orbitMaterial);
    selectionOrbit.computeLineDistances();
    scene.add(selectionOrbit);

    const trailPositions = new Float32Array(28 * 6);
    for (let i = 0; i < 28; i++) {
      const angle = backgroundRandom() * Math.PI * 2;
      const distance = 7 + backgroundRandom() * 25;
      trailPositions.set([Math.cos(angle) * distance, Math.sin(angle) * distance, -24 - backgroundRandom() * 45, Math.cos(angle) * distance * 1.22, Math.sin(angle) * distance * 1.22, -8 - backgroundRandom() * 10], i * 6);
    }
    const trails = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(trailPositions, 3)), new THREE.LineBasicMaterial({ color: '#b8d6e2', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    camera.add(trails);
    scene.add(camera);

    const resize = () => {
      width = Math.max(1, container.clientWidth); height = Math.max(1, container.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    const focusNodes = () => {
      const latest = propsRef.current;
      const questionNode = layout.find(node => node.question.id === latest.selectedQuestionId) ?? layout[0];
      const answerNode = questionNode?.answers.find(node => node.answer.id === latest.selectedAnswerId) ?? questionNode?.answers[0];
      return { questionNode, answerNode };
    };

    const updateLabels = (depth: number) => {
      const { questionNode, answerNode } = focusNodes();
      const level = depth < 0.65 ? 0 : depth < 1.65 ? 1 : 2;
      const entries: ProjectedLabel[] = level === 0
        ? layout.map(node => ({ key: `q:${node.question.id}`, position: node.position, relevance: relevance(node.question.relevance), selected: node === questionNode }))
        : level === 1
          ? (questionNode?.answers ?? []).map(node => ({ key: `a:${node.answer.id}`, position: node.position, relevance: relevance(node.answer.relevance), selected: node === answerNode }))
          : answerNode ? [{ key: `a:${answerNode.answer.id}`, position: answerNode.position, relevance: 1, selected: true }] : [];
      entries.sort((a, b) => Number(b.selected) - Number(a.selected) || b.relevance - a.relevance);
      const occupied: { x: number; y: number; w: number; h: number }[] = [];
      const mobile = width < 760;
      const labelWidth = mobile ? 176 : level === 2 ? 280 : 216;
      const labelHeight = mobile ? 92 : level === 2 ? 125 : 104;
      const containerBounds = container.getBoundingClientRect();
      const obstructions = Array.from(document.querySelectorAll<HTMLElement>('.intro, .search-box, .discovery-panel, .article-panel, .journey-location, .bottom-center, .left-bottom')).map(element => {
        const bounds = element.getBoundingClientRect();
        return { x: bounds.x - containerBounds.x, y: bounds.y - containerBounds.y, w: bounds.width, h: bounds.height };
      }).filter(bounds => bounds.w && bounds.h);
      const intersects = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }, gap = 10) => a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
      entries.forEach((entry, index) => {
        const element = labelsRef.current.get(entry.key);
        if (!element) return;
        projected.copy(entry.position).project(camera);
        const x = (projected.x * 0.5 + 0.5) * width;
        const y = (-projected.y * 0.5 + 0.5) * height;
        const onScreen = projected.z < 1 && projected.z > -1 && x > -80 && x < width + 80 && y > 70 && y < height - 60;
        if (!onScreen || mobile && index > 3) { element.style.visibility = 'hidden'; return; }
        element.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
        const candidates = level === 2 ? [[23, 28], [-labelWidth - 20, 24]] : [[18, 17], [-labelWidth - 18, 17], [18, -labelHeight - 12], [-labelWidth - 18, -labelHeight - 12], [18, 62], [-labelWidth - 18, -labelHeight - 52]];
        let placement: { x: number; y: number; w: number; h: number } | null = null;
        for (const [offsetX, offsetY] of candidates) {
          const candidate = { x: x + offsetX, y: y + offsetY, w: labelWidth, h: labelHeight };
          const inBounds = candidate.x >= (mobile ? 18 : 40) && candidate.x + labelWidth < width - 30 && candidate.y >= (mobile ? 162 : 118) && candidate.y + labelHeight < height - (mobile ? 172 : 105);
          const blocked = obstructions.some(box => intersects(candidate, box));
          const collision = occupied.some(box => intersects(candidate, box, 12));
          if (inBounds && !blocked && !collision) { placement = candidate; break; }
        }
        if (!placement && entry.selected) {
          // Keep the selected title reachable even when its star is near a HUD edge.
          // On narrow screens the reading panel already supplies the article title.
          const available: { x: number; y: number; w: number; h: number }[] = [];
          for (let top = mobile ? 325 : 155; top < height - labelHeight - 140; top += 28) {
            for (let left = 24; left < width - labelWidth - 24; left += 38) {
              const candidate = { x: left, y: top, w: labelWidth, h: labelHeight };
              if (!obstructions.some(box => intersects(candidate, box)) && !occupied.some(box => intersects(candidate, box))) available.push(candidate);
            }
          }
          available.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
          placement = available[0] ?? null;
        }
        element.style.visibility = placement ? 'visible' : 'hidden';
        if (placement) {
          occupied.push(placement);
          const body = element.querySelector<HTMLElement>('.galaxy-label-body');
          if (body) body.style.transform = `translate(${(placement.x - x).toFixed(1)}px, ${(placement.y - y).toFixed(1)}px)`;
          element.style.opacity = `${entry.selected ? 1 : 0.6 + entry.relevance * 0.35}`;
        }
      });
    };

    const animate = (time: number) => {
      if (destroyed || hidden) return;
      frame = requestAnimationFrame(animate);
      const dt = Math.min((time - (lastTime || time)) / 1000, 0.05);
      lastTime = time;
      const latest = propsRef.current;
      if (!latest.reducedMotion) elapsed += dt;
      const depth = clamp(latest.depth, 0, 2);
      const { questionNode, answerNode } = focusNodes();
      if (latest.resetToken !== previousReset || latest.selectedQuestionId !== previousQuestion) {
        flightOffset.set(0, 0, 0); userYaw = -0.055; userPitch = 0.04;
        previousReset = latest.resetToken; previousQuestion = latest.selectedQuestionId;
      }
      const inward = smooth(depth);
      const articleInward = smooth(depth - 1);
      desiredTarget.set(12, 0, 0);
      if (questionNode) desiredTarget.lerp(questionNode.position, inward);
      if (answerNode) desiredTarget.lerp(answerNode.position, articleInward);
      let radius = THREE.MathUtils.lerp(335, 104, inward);
      radius = THREE.MathUtils.lerp(radius, 28, articleInward);
      if (width < 760) radius *= 1.28;
      let flightSpeed = 0;
      if (latest.flightMode && !document.querySelector('[role="dialog"]')) {
        const speed = keys.has('shift') ? 2 : 1;
        if (keys.has('w') || keys.has('arrowup')) { latest.onDepthChange(clamp(depth + dt * 0.32 * speed, 0, 2)); flightSpeed = speed; }
        if (keys.has('s') || keys.has('arrowdown')) { latest.onDepthChange(clamp(depth - dt * 0.32 * speed, 0, 2)); flightSpeed = -speed; }
        if (keys.has('a') || keys.has('arrowleft')) flightOffset.x -= dt * 16 * speed;
        if (keys.has('d') || keys.has('arrowright')) flightOffset.x += dt * 16 * speed;
      }
      desiredTarget.add(flightOffset);
      const ease = latest.reducedMotion ? 1 : 1 - Math.exp(-dt * 4.2);
      yaw = THREE.MathUtils.lerp(yaw, userYaw, ease);
      pitch = THREE.MathUtils.lerp(pitch, userPitch, ease);
      target.lerp(desiredTarget, ease);
      desiredPosition.set(Math.sin(yaw) * Math.cos(pitch) * radius, Math.sin(pitch) * radius, Math.cos(yaw) * Math.cos(pitch) * radius).add(target);
      currentPosition.lerp(desiredPosition, ease);
      camera.position.copy(currentPosition);
      camera.lookAt(target);
      camera.updateMatrixWorld();
      cloudGroups.forEach((group, index) => { group.rotation.z = index * 0.58 + 0.22 + Math.sin(elapsed * 0.035 + index) * 0.018; });
      sceneMaterials.forEach(material => { material.uniforms.uTime.value = elapsed; });
      layout.forEach(node => {
        const selected = node === questionNode;
        const opacity = selected ? 1 - articleInward * 0.96 : 1 - inward * 0.88;
        const material = cloudMaterials.get(node.question.id);
        if (material) material.uniforms.uOpacity.value = opacity;
        const halo = questionSprites.get(node.question.id);
        if (halo) halo.material.opacity = (0.28 + relevance(node.question.relevance) * 0.56) * opacity;
        node.answers.forEach(({ answer }) => {
          const answerSelected = answer.id === answerNode?.answer.id;
          const material = answerMaterials.get(answer.id);
          if (material) material.uniforms.uOpacity.value = selected ? THREE.MathUtils.lerp(0.4, answerSelected ? 0.085 : 0.045, articleInward) : 0.18 * (1 - inward);
          const sprite = answerSprites.get(answer.id);
          if (sprite) {
            sprite.material.opacity = selected ? (0.15 + relevance(answer.relevance) * 0.2 + inward * 0.55) * (answerSelected ? 1 : 1 - articleInward * 0.86) : 0.2 * (1 - inward);
            sprite.scale.setScalar((9 + relevance(answer.relevance) * 8) * (answerSelected ? 1 + articleInward * 0.2 : 1));
          }
        });
      });
      if (questionNode) {
        selectionOrbit.position.copy(articleInward > 0.55 && answerNode ? answerNode.position : questionNode.position);
        selectionOrbit.scale.setScalar(THREE.MathUtils.lerp(43, 5.6, articleInward));
        selectionOrbit.rotation.z = elapsed * 0.035;
        orbitMaterial.opacity = 0.13 + articleInward * 0.07;
      }
      lineMaterial.opacity = 0.075 * (1 - inward * 0.88);
      botMaterial.opacity = 0.75 * (1 - inward * 0.92);
      curves.forEach((curve, index) => curve.getPoint((elapsed * 0.026 + index * 0.29) % 1).toArray(botPositions, index * 3));
      botGeometry.attributes.position.needsUpdate = true;
      trails.material.opacity = latest.flightMode && !latest.reducedMotion ? THREE.MathUtils.lerp(trails.material.opacity, Math.abs(flightSpeed) * 0.16, 0.08) : 0;
      updateLabels(depth);
      renderer.render(scene, camera);
    };

    const onVisibility = () => {
      hidden = document.hidden || contextLost;
      cancelAnimationFrame(frame);
      keys.clear();
      if (!hidden) { lastTime = 0; frame = requestAnimationFrame(animate); }
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * height : event.deltaY;
      propsRef.current.onDepthChange(clamp(propsRef.current.depth - delta * 0.0011, 0, 2));
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      canvas.focus({ preventScroll: true });
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      canvas.setPointerCapture(event.pointerId);
      pointerStart = { x: event.clientX, y: event.clientY }; moved = false;
      setDragging(true);
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchDistance = Math.hypot(a.x - b.x, a.y - b.y); }
    };
    const onPointerMove = (event: PointerEvent) => {
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) moved = true;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        propsRef.current.onDepthChange(clamp(propsRef.current.depth + (distance - pinchDistance) * 0.005, 0, 2));
        pinchDistance = distance;
      } else {
        userYaw -= (event.clientX - previous.x) * 0.0033;
        userPitch = clamp(userPitch + (event.clientY - previous.y) * 0.0025, -0.85, 0.85);
      }
    };
    const findNearest = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const { questionNode } = focusNodes();
      const nodes = propsRef.current.depth < 0.65 ? layout.map(node => ({ id: node.question.id, position: node.position })) : (questionNode?.answers ?? []).map(node => ({ id: node.answer.id, position: node.position }));
      let nearest: string | null = null, minimum = 55;
      nodes.forEach(node => {
        projected.copy(node.position).project(camera);
        const distance = Math.hypot((projected.x * 0.5 + 0.5) * width - (clientX - rect.left), (-projected.y * 0.5 + 0.5) * height - (clientY - rect.top));
        if (projected.z < 1 && distance < minimum) { minimum = distance; nearest = node.id; }
      });
      return nearest;
    };
    const onPointerUp = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (!pointers.size) setDragging(false);
      if (!moved && event.type !== 'pointercancel') {
        const nearest = findNearest(event.clientX, event.clientY);
        if (nearest) {
          if (propsRef.current.depth < 0.65) propsRef.current.onSelectQuestion(nearest);
          else propsRef.current.onSelectAnswer(nearest);
        }
      }
    };
    const onDoubleClick = (event: MouseEvent) => {
      const nearest = findNearest(event.clientX, event.clientY);
      if (!nearest) return;
      if (propsRef.current.depth < 0.65) { propsRef.current.onSelectQuestion(nearest); propsRef.current.onDepthChange(1); }
      else { propsRef.current.onSelectAnswer(nearest); propsRef.current.onDepthChange(2); }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target) || !propsRef.current.flightMode || event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(key)) { event.preventDefault(); keys.add(key); }
    };
    const onKeyUp = (event: KeyboardEvent) => keys.delete(event.key.toLowerCase());
    const onBlur = () => { keys.clear(); pointers.clear(); setDragging(false); };
    const onContextLost = (event: Event) => { event.preventDefault(); setWebglAvailable(false); contextLost = true; hidden = true; cancelAnimationFrame(frame); };
    const onContextRestored = () => { setWebglAvailable(true); contextLost = false; hidden = document.hidden; if (!hidden) { lastTime = 0; frame = requestAnimationFrame(animate); } };
    container.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('dblclick', onDoubleClick);
    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    frame = requestAnimationFrame(animate);
    return () => {
      destroyed = true; cancelAnimationFrame(frame); resizeObserver.disconnect();
      container.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('dblclick', onDoubleClick);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      scene.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Line || object instanceof THREE.Sprite) {
          if ('geometry' in object) geometries.add(object.geometry);
          const material = object.material;
          if (Array.isArray(material)) material.forEach(item => materials.add(item)); else materials.add(material);
        }
      });
      geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
      texture.dispose();
      if (!contextLost) renderer.clear();
      renderer.dispose();
    };
  }, [layout]);

  const enterQuestion = (question: Question) => { props.onSelectQuestion(question.id); props.onDepthChange(1); };
  const enterAnswer = (answer: Answer) => { props.onSelectAnswer(answer.id); props.onDepthChange(2); };
  const labels = stage === 0 ? props.questions.map((question, index) => ({
    key: `q:${question.id}`, id: question.id, title: question.title, subtitle: `${question.answers.length} 个观点`,
    relevance: relevance(question.relevance), color: question.color, number: index + 1, selected: question.id === selectedQuestion?.id,
    select: () => props.onSelectQuestion(question.id), enter: () => enterQuestion(question), enterText: '进入星系',
  })) : (stage === 1 ? selectedQuestion?.answers ?? [] : selectedAnswer ? [selectedAnswer] : []).map((answer, index) => ({
    key: `a:${answer.id}`, id: answer.id, title: answer.title, subtitle: answer.author,
    relevance: relevance(answer.relevance), color: selectedQuestion?.color ?? '#c5dbe6', number: index + 1, selected: answer.id === selectedAnswer?.id,
    select: () => props.onSelectAnswer(answer.id), enter: () => enterAnswer(answer), enterText: '阅读观点',
  }));

  return (
    <div ref={containerRef} className={`galaxy-scene ${dragging ? 'galaxy-is-dragging' : ''} ${!webglAvailable ? 'galaxy-is-fallback' : ''} ${props.reducedMotion ? 'galaxy-reduced-motion' : ''}`} data-depth={stage} aria-label="知识宇宙探索">
      <div className="galaxy-nebula galaxy-nebula-one" aria-hidden="true" />
      <div className="galaxy-nebula galaxy-nebula-two" aria-hidden="true" />
      <div className="galaxy-nebula galaxy-nebula-three" aria-hidden="true" />
      <canvas ref={canvasRef} className="galaxy-canvas" tabIndex={0} aria-label="三维知识星空。滚轮向上深入，向下返回，拖动调整视角；也可使用页面的层级按钮和星系标签。" />
      <div className="galaxy-vignette" aria-hidden="true" />
      {!webglAvailable && <div className="galaxy-fallback-notice">二维星图 <span>选择一个问题，继续你的探索</span></div>}
      <div className="galaxy-labels" aria-label={stage === 0 ? '相关问题星系' : '问题中的回答'}>
        {labels.map(label => (
          <div key={label.key} ref={element => { if (element) labelsRef.current.set(label.key, element); else labelsRef.current.delete(label.key); }}
            className={`galaxy-label ${label.selected ? 'galaxy-label-selected' : ''} ${stage === 2 ? 'galaxy-label-article' : ''}`}
            style={{ '--galaxy-star-color': label.color } as React.CSSProperties}>
            <button className="galaxy-star-marker" onClick={label.select} onDoubleClick={label.enter} aria-label={`聚焦${stage === 0 ? '问题' : '回答'}：${label.title}`} aria-pressed={label.selected}><span /></button>
            <div className="galaxy-label-body">
              <span className="galaxy-label-eyebrow">{stage === 0 ? 'QUESTION' : 'PERSPECTIVE'} <i>{String(label.number).padStart(2, '0')}</i>{label.selected && <b>已定位</b>}</span>
              <button className="galaxy-label-title" onClick={label.select} onDoubleClick={label.enter}>{label.title}</button>
              <span className="galaxy-label-meta"><span className="galaxy-relevance-bars" aria-hidden="true">{[0, 1, 2, 3, 4].map(bar => <i key={bar} style={{ opacity: bar < Math.round(label.relevance * 5) ? 1 : 0.2 }} />)}</span>{Math.round(label.relevance * 100)}% {props.relevanceLabel ?? '相关'} <span className="galaxy-label-dot">·</span>{label.subtitle}</span>
              {stage !== 2 && <button className="galaxy-label-enter" onClick={label.enter} aria-label={`${label.enterText}：${label.title}`}>{label.enterText}<span aria-hidden="true">↗</span></button>}
            </div>
          </div>
        ))}
      </div>
      {props.flightMode && <div className="galaxy-flight-hud" aria-hidden="true"><span className="galaxy-reticle" /><div className="galaxy-flight-caption">FLIGHT MODE <i /> W A S D 飞行 · SHIFT 加速</div></div>}
      <div className="galaxy-coordinates" aria-hidden="true"><span>RA {String(Math.round(203 + props.depth * 31)).padStart(3, '0')}°</span><i /><span>DEC +{(23.4 + props.depth * 8.7).toFixed(1)}°</span></div>
    </div>
  );
}
