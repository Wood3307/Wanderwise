import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { Answer, Highlight, Question } from "../types";
import StellarText from "./StellarText";
import CosmicBackdrop from "./CosmicBackdrop";
import {
  answerLocalPosition,
  createGalaxy,
  getGalaxySpec,
  type GalaxySpec,
} from "./space/galaxies";
import {
  createPlanetarySystem,
  getPlanetKind,
  planetKindNames,
  type PlanetarySystem,
} from "./space/planets";
import {
  placeLabels,
  projectAnchor,
  type LabelInput,
  type LabelPlacement,
} from "./space/projection";
import "./galaxy.css";

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
  onOpenReader: (paragraphIndex?: number, quote?: string) => void;
  selectedParagraph: number | null;
  onSelectParagraph: (index: number, quote?: string) => void;
  selectedQuote?: string;
}
interface GalaxyNode {
  question: Question;
  spec: GalaxySpec;
  position: THREE.Vector3;
  answers: { answer: Answer; position: THREE.Vector3 }[];
}
interface ContentLayer {
  id: number;
  key: string;
  stage: number;
  question?: Question;
  answer?: Answer;
  questions: Question[];
  phase: "enter" | "exit";
}
interface BodyAnchor {
  id: string;
  key: string;
  position: THREE.Vector3;
  radius: number;
  kind: "question" | "answer" | "paragraph";
  planetKind?: string;
  index?: number;
}
const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));
const smooth = (value: number) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};
const relevance = (value: number) => clamp(value > 1 ? value / 100 : value);
const stageAt = (depth: number) => (depth < 0.65 ? 0 : depth < 1.65 ? 1 : 2);

function meaningfulHighlights(answer: Answer): Highlight[] {
  if (answer.highlights?.length) return answer.highlights;
  return answer.paragraphs
    .map((text, paragraphIndex) => ({
      id: `${answer.id}:${paragraphIndex}`,
      text,
      paragraphIndex,
    }))
    .filter((item) => item.text.trim().length > 24)
    .slice(0, 6);
}
function seededRandom(seed: string) {
  let value = 2166136261;
  for (const char of seed)
    value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = Math.imul(value ^ (value >>> 15), value | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeLayout(questions: Question[]): GalaxyNode[] {
  return questions.map((question, index) => {
    const spec = getGalaxySpec(question.id, index);
    let position: THREE.Vector3;
    if (questions.length <= 3)
      position = new THREE.Vector3(
        ...([
          [-100, 12, 6],
          [94, 83, -42],
          [74, -97, -25],
        ][index] as [number, number, number]),
      );
    else {
      const angle = index * 2.399963 + 2.8;
      const radius = 58 + Math.sqrt(index) * 85;
      position = new THREE.Vector3(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius * 0.67,
        -18 - (index % 3) * 28,
      );
    }
    return {
      question,
      spec,
      position,
      answers: question.answers.map((answer, answerIndex) => ({
        answer,
        position: answerLocalPosition(
          spec,
          answerIndex,
          question.answers.length,
        )
          .applyEuler(spec.rotation)
          .add(position),
      })),
    };
  });
}
function glowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(0.035, "#fffff3f5");
    gradient.addColorStop(0.12, "#cee8ff8c");
    gradient.addColorStop(0.32, "#83bde523");
    gradient.addColorStop(1, "#83bde500");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(canvas);
}
const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  !!target.closest(
    'input,textarea,select,[contenteditable="true"],[role="dialog"]',
  );

export default function GalaxyScene(props: GalaxySceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef(new Map<string, HTMLDivElement>());
  const hubRef = useRef<HTMLDivElement | null>(null);
  const coreRef = useRef<HTMLButtonElement | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [webglAvailable, setWebglAvailable] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(() => (innerWidth < 760 ? 2 : 4));
  const pageSizeRef = useRef(pageSize);
  pageSizeRef.current = pageSize;
  useEffect(() => {
    const media = matchMedia("(max-width: 759px)");
    const change = () => {
      setPageSize(media.matches ? 2 : 4);
      setPage(0);
    };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const pageRef = useRef(page);
  pageRef.current = page;
  const stage = stageAt(props.depth);
  const selectedQuestion =
    props.questions.find(
      (question) => question.id === props.selectedQuestionId,
    ) ?? props.questions[0];
  const selectedAnswer =
    selectedQuestion?.answers.find(
      (answer) => answer.id === props.selectedAnswerId,
    ) ?? selectedQuestion?.answers[0];
  const layoutSignature = props.questions
    .map(
      (question) =>
        `${question.id}:${question.answers.map((answer) => answer.id).join(",")}`,
    )
    .join("|");
  const layout = useMemo(() => makeLayout(props.questions), [layoutSignature]);
  const cameraMemory = useRef<{
    position: THREE.Vector3;
    target: THREE.Vector3;
    yaw: number;
    pitch: number;
    pan: THREE.Vector3;
  } | null>(null);
  const layerKey = `${stage}:${stage ? selectedQuestion?.id : props.questions.map((question) => question.id).join(",")}:${stage === 2 ? selectedAnswer?.id : ""}`;
  const count =
    stage === 1
      ? (selectedQuestion?.answers.length ?? 0)
      : stage === 2 && selectedAnswer
        ? meaningfulHighlights(selectedAnswer).length
        : props.questions.length;
  const serial = useRef(1);
  const [layers, setLayers] = useState<ContentLayer[]>([
    {
      id: 0,
      key: layerKey,
      stage,
      question: selectedQuestion,
      answer: selectedAnswer,
      questions: props.questions,
      phase: "enter",
    },
  ]);
  useEffect(() => {
    setPage((previous) =>
      Math.min(
        previous,
        Math.max(0, Math.ceil(count / pageSizeRef.current) - 1),
      ),
    );
  }, [count, pageSize]);
  useEffect(() => {
    setPage(0);
    setLayers((previous) =>
      previous.some(
        (layer) => layer.key === layerKey && layer.phase === "enter",
      )
        ? previous
        : [
            ...previous
              .filter((layer) => layer.phase !== "exit")
              .map((layer) => ({ ...layer, phase: "exit" as const })),
            {
              id: serial.current++,
              key: layerKey,
              stage,
              question: selectedQuestion,
              answer: selectedAnswer,
              questions: props.questions,
              phase: "enter",
            },
          ],
    );
    const timer = setTimeout(
      () =>
        setLayers((previous) =>
          previous.filter((layer) => layer.phase !== "exit"),
        ),
      props.reducedMotion ? 0 : 730,
    );
    return () => clearTimeout(timer);
  }, [layerKey, props.reducedMotion]);

  useEffect(() => {
    const canvas = canvasRef.current,
      container = containerRef.current;
    if (!canvas || !container || !layout.length) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      });
    } catch {
      setWebglAvailable(false);
      return;
    }
    setWebglAvailable(true);
    let width = container.clientWidth,
      height = container.clientHeight;
    const mobile = width < 760;
    const pixelRatio = Math.min(devicePixelRatio || 1, mobile ? 1.35 : 1.65);
    renderer.setPixelRatio(pixelRatio);
    renderer.setClearColor("#060b12", 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(48, width / height, 0.06, 4000);
    const texture = glowTexture();
    const galaxyModels = new Map<string, ReturnType<typeof createGalaxy>>();
    const answerStars = new Map<
      string,
      { group: THREE.Group; core: THREE.Mesh; glow: THREE.Sprite }
    >();
    let system: PlanetarySystem | null = null,
      systemKey = "";
    let frame = 0,
      destroyed = false,
      contextLost = false,
      hidden = document.hidden,
      elapsed = 0,
      lastTime = 0;
    let widthCache = -1,
      modelRadius = 150,
      projectionTick = 0,
      lastLabelScope = "";
    let yawTarget = cameraMemory.current?.yaw ?? -0.06,
      pitchTarget = cameraMemory.current?.pitch ?? 0.16;
    let yaw = yawTarget,
      pitch = pitchTarget;
    const pan = cameraMemory.current?.pan.clone() ?? new THREE.Vector3();
    const target = cameraMemory.current?.target.clone() ?? new THREE.Vector3();
    const currentPosition =
      cameraMemory.current?.position.clone() ?? new THREE.Vector3(0, 18, 380);
    const desiredTarget = new THREE.Vector3(),
      desiredPosition = new THREE.Vector3(),
      anchorWorld = new THREE.Vector3();
    let previousReset = propsRef.current.resetToken,
      previousQuestion = propsRef.current.selectedQuestionId,
      previousAnswer = propsRef.current.selectedAnswerId,
      previousStage = stageAt(propsRef.current.depth);
    const keys = new Set<string>();
    const pointers = new Map<number, { x: number; y: number }>();
    let pointerStart = { x: 0, y: 0 },
      moved = false,
      panning = false,
      pinchDistance = 0;
    let lastPlacements = new Map<string, LabelPlacement>();
    const bodySizes = new Map<string, { width: number; height: number }>();
    let currentBodies: BodyAnchor[] = [];
    const random = seededRandom("wanderwise-deep-space-v4");
    const backgroundPositions: number[] = [],
      backgroundColors: number[] = [];
    for (let i = 0; i < (mobile ? 1700 : 3800); i++) {
      const direction = new THREE.Vector3(
        random() - 0.5,
        random() - 0.5,
        random() - 0.5,
      )
        .normalize()
        .multiplyScalar(800 + random() * 1000);
      backgroundPositions.push(direction.x, direction.y, direction.z);
      const c = new THREE.Color(
        ["#a5bed5", "#6c91b2", "#d6c8ae"][i % 3],
      ).multiplyScalar(0.3 + random() * 0.45);
      backgroundColors.push(c.r, c.g, c.b);
    }
    const skyGeometry = new THREE.BufferGeometry();
    skyGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(backgroundPositions, 3),
    );
    skyGeometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(backgroundColors, 3),
    );
    const sky = new THREE.Points(
      skyGeometry,
      new THREE.PointsMaterial({
        size: 2.7,
        map: texture,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        vertexColors: true,
        blending: THREE.AdditiveBlending,
      }),
    );
    scene.add(sky);

    layout.forEach((node) => {
      const model = createGalaxy(node.spec, {
        seed: node.question.id,
        color: node.question.color,
        relevance: relevance(node.question.relevance),
        mobile,
        pixelRatio,
      });
      model.group.position.copy(node.position);
      model.group.rotation.copy(node.spec.rotation);
      scene.add(model.group);
      galaxyModels.set(node.question.id, model);
      node.answers.forEach(({ answer, position }) => {
        const color = new THREE.Color(node.question.color).lerp(
          new THREE.Color("#ffe8bc"),
          0.34,
        );
        const group = new THREE.Group();
        group.position.copy(position);
        const core = new THREE.Mesh(
          new THREE.SphereGeometry(
            0.34 + relevance(answer.relevance) * 0.19,
            16,
            12,
          ),
          new THREE.MeshBasicMaterial({ color: "#fff2d8", transparent: true }),
        );
        const glow = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: texture,
            color,
            transparent: true,
            opacity: 0.9,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        );
        glow.scale.setScalar(7 + relevance(answer.relevance) * 5);
        group.add(core, glow);
        scene.add(group);
        answerStars.set(answer.id, { group, core, glow });
      });
    });
    const network = new THREE.Group();
    const networkMaterial = new THREE.LineBasicMaterial({
      color: "#8ba8b9",
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
    });
    layout.slice(1).forEach((node, index) => {
      const start = layout[Math.floor(index / 2)].position;
      const curve = new THREE.QuadraticBezierCurve3(
        start,
        start
          .clone()
          .lerp(node.position, 0.5)
          .add(new THREE.Vector3(0, 18, -20)),
        node.position,
      );
      network.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(curve.getPoints(35)),
          networkMaterial,
        ),
      );
    });
    scene.add(network);
    const trailGeometry = new THREE.BufferGeometry();
    const trailPoints: number[] = [];
    for (let i = 0; i < 20; i++) {
      const a = random() * Math.PI * 2,
        r = 8 + random() * 19;
      trailPoints.push(
        Math.cos(a) * r,
        Math.sin(a) * r,
        -45,
        Math.cos(a) * r * 1.2,
        Math.sin(a) * r * 1.2,
        -12,
      );
    }
    trailGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(trailPoints, 3),
    );
    const trails = new THREE.LineSegments(
      trailGeometry,
      new THREE.LineBasicMaterial({
        color: "#b0d9eb",
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    camera.add(trails);
    scene.add(camera);
    const resize = () => {
      width = Math.max(1, container.clientWidth);
      height = Math.max(1, container.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      bodySizes.clear();
      lastPlacements.clear();
      widthCache = width;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    const focus = () => {
      const latest = propsRef.current;
      const q =
        layout.find((node) => node.question.id === latest.selectedQuestionId) ??
        layout[0];
      const source =
        latest.questions.find((question) => question.id === q.question.id) ??
        q.question;
      const a =
        q.answers.find((node) => node.answer.id === latest.selectedAnswerId) ??
        q.answers[0];
      const answer =
        source.answers.find((item) => item.id === a?.answer.id) ??
        source.answers[0];
      return { q, a, source, answer };
    };
    const syncPlanets = (depth: number) => {
      const { q, a, answer } = focus();
      if (!answer || !a || depth < 1.08) {
        if (system) system.group.visible = false;
        return;
      }
      const highlights = meaningfulHighlights(answer);
      const nextKey = `${answer.id}:${highlights.map((item) => item.id).join(",")}`;
      if (nextKey !== systemKey) {
        if (system) {
          scene.remove(system.group);
          system.dispose();
        }
        system = createPlanetarySystem({
          seed: answer.id,
          count: highlights.length,
          mobile,
        });
        systemKey = nextKey;
        scene.add(system.group);
      }
      system!.group.visible = true;
      system!.group.position.copy(a.position);
      system!.group.rotation.set(
        q.spec.rotation.x * 0.18,
        q.spec.rotation.y * 0.18,
        q.spec.rotation.z * 0.12,
      );
    };
    const bodies = (level: number): BodyAnchor[] => {
      const { q, a, answer } = focus();
      if (!level)
        return layout.map((node) => ({
          id: node.question.id,
          key: `q:${node.question.id}`,
          position: node.position,
          radius: 6,
          kind: "question",
        }));
      if (level === 1)
        return q.answers.map((node) => ({
          id: node.answer.id,
          key: `a:${node.answer.id}`,
          position: node.position,
          radius: 0.9,
          kind: "answer",
          index: q.answers.indexOf(node),
        }));
      if (!system || !a || !answer) return [];
      const highlights = meaningfulHighlights(answer);
      system.group.updateWorldMatrix(true, true);
      return system.planets.flatMap((planet) =>
        highlights[planet.index]
          ? [
              {
                id: highlights[planet.index].id,
                key: `p:${highlights[planet.index].id}`,
                position: planet.object.getWorldPosition(new THREE.Vector3()),
                radius: planet.radius,
                kind: "paragraph" as const,
                planetKind: planet.kind,
                index: planet.index,
              },
            ]
          : [],
      );
    };
    const writeProjection = (level: number, dt: number) => {
      const latest = propsRef.current;
      const { q, a, answer } = focus();
      const active = bodies(level);
      currentBodies = active;
      const scope = `${level}:${q.question.id}:${answer?.id}:${pageRef.current}:${width}`;
      if (scope !== lastLabelScope || widthCache !== width) {
        bodySizes.clear();
        lastPlacements.clear();
        lastLabelScope = scope;
        widthCache = width;
      }
      const top = width < 760 ? 128 : 94,
        bottom = height - (width < 760 ? 124 : 86);
      const obstacles: {
        x: number;
        y: number;
        width: number;
        height: number;
      }[] = [];
      if (level > 0) {
        const origin = level === 2 && a ? a.position : q.position;
        const center = projectAnchor(origin, camera, width, height);
        const hub = hubRef.current,
          hit = coreRef.current;
        if (hub && center.visible) {
          const hw = hub.offsetWidth,
            hh = hub.offsetHeight;
          const hx = clamp(center.x - hw / 2, 10, width - hw - 10);
          const hy = clamp(
            center.y + (level === 2 ? 43 : 28),
            top,
            Math.max(top, bottom - hh),
          );
          hub.style.transform = `translate3d(${hx.toFixed(2)}px,${hy.toFixed(2)}px,0)`;
          hub.style.visibility = "visible";
          hub.dataset.screenX = center.x.toFixed(3);
          hub.dataset.screenY = center.y.toFixed(3);
          obstacles.push({
            x: hx - 9,
            y: hy - 5,
            width: hw + 18,
            height: hh + 10,
          });
        } else if (hub) hub.style.visibility = "hidden";
        if (hit) {
          hit.style.transform = `translate3d(${center.x.toFixed(2)}px,${center.y.toFixed(2)}px,0)`;
          hit.style.visibility = center.visible ? "visible" : "hidden";
        }
      }
      const pageBodies = level
        ? active.slice(
            pageRef.current * pageSizeRef.current,
            (pageRef.current + 1) * pageSizeRef.current,
          )
        : active;
      const entries: LabelInput[] = [];
      pageBodies.forEach((node, index) => {
        const element = labelsRef.current.get(node.key);
        if (!element) return;
        const screen = projectAnchor(node.position, camera, width, height);
        element.dataset.worldX = node.position.x.toFixed(4);
        element.dataset.worldY = node.position.y.toFixed(4);
        element.dataset.worldZ = node.position.z.toFixed(4);
        element.dataset.screenX = screen.x.toFixed(3);
        element.dataset.screenY = screen.y.toFixed(3);
        if (node.planetKind) element.dataset.planetKind = node.planetKind;
        element.style.transform = `translate3d(${screen.x.toFixed(2)}px,${screen.y.toFixed(2)}px,0)`;
        element.style.visibility = screen.visible ? "visible" : "hidden";
        const body = element.querySelector<HTMLElement>(".galaxy-label-body");
        if (!body) return;
        let size = bodySizes.get(node.key);
        if (!size || projectionTick % 45 === 0) {
          size = { width: body.offsetWidth, height: body.offsetHeight };
          bodySizes.set(node.key, size);
        }
        const selected =
          level === 0
            ? node.id === latest.selectedQuestionId
            : level === 1
              ? node.id === latest.selectedAnswerId
              : meaningfulHighlights(answer!)[node.index!]?.paragraphIndex ===
                  latest.selectedParagraph &&
                (!latest.selectedQuote ||
                  meaningfulHighlights(answer!)[node.index!]?.text ===
                    latest.selectedQuote);
        entries.push({
          id: node.key,
          anchor: screen,
          width: size.width,
          height: size.height,
          priority: selected ? 30 : index === 0 ? 20 : 11 - index * 0.1,
          preferredSide: screen.x < width / 2 ? "left" : "right",
        });
      });
      const placed = placeLabels(
        entries,
        {
          width,
          height,
          top,
          bottom,
          left: width < 760 ? 12 : 22,
          right: width - (width < 760 ? 12 : 22),
        },
        lastPlacements,
        obstacles,
      );
      const eased = new Map<string, LabelPlacement>();
      entries.forEach((entry) => {
        const element = labelsRef.current.get(entry.id)!;
        const body = element.querySelector<HTMLElement>(".galaxy-label-body")!;
        const line = element.querySelector<SVGLineElement>(
          ".galaxy-label-leader line",
        );
        const next = placed.get(entry.id);
        if (!next) return;
        const previous = lastPlacements.get(entry.id);
        // Anchor translation is immediate. Only a necessary change of label side is eased.
        const amount =
          latest.reducedMotion || !previous || !previous.visible
            ? 1
            : 1 - Math.exp(-dt * 14);
        const x = previous?.visible
          ? next.anchorX +
            THREE.MathUtils.lerp(
              previous.x - previous.anchorX,
              next.x - next.anchorX,
              amount,
            )
          : next.x;
        const y = previous?.visible
          ? next.anchorY +
            THREE.MathUtils.lerp(
              previous.y - previous.anchorY,
              next.y - next.anchorY,
              amount,
            )
          : next.y;
        body.style.transform = `translate3d(${(x - next.anchorX).toFixed(2)}px,${(y - next.anchorY).toFixed(2)}px,0)`;
        body.style.visibility = next.visible ? "visible" : "hidden";
        body.style.opacity = next.visible ? "1" : "0";
        body.inert = !next.visible;
        if (line) {
          const endpointX =
            clamp(next.anchorX, x, x + entry.width) - next.anchorX;
          const endpointY =
            clamp(next.anchorY, y, y + entry.height) - next.anchorY;
          line.setAttribute("x2", endpointX.toFixed(2));
          line.setAttribute("y2", endpointY.toFixed(2));
          line.style.opacity =
            next.visible && Math.hypot(endpointX, endpointY) > 20 ? ".5" : "0";
        }
        eased.set(entry.id, { ...next, x, y });
      });
      lastPlacements = eased;
    };
    const animate = (time: number) => {
      if (destroyed || hidden) return;
      frame = requestAnimationFrame(animate);
      const dt = Math.min((time - (lastTime || time)) / 1000, 0.05);
      lastTime = time;
      const latest = propsRef.current,
        depth = clamp(latest.depth, 0, 2),
        level = stageAt(depth);
      if (!latest.reducedMotion) elapsed += dt;
      const { q, a } = focus();
      if (
        latest.resetToken !== previousReset ||
        latest.selectedQuestionId !== previousQuestion
      ) {
        pan.set(0, 0, 0);
        yawTarget = -0.06;
        pitchTarget = 0.16;
        previousReset = latest.resetToken;
        previousQuestion = latest.selectedQuestionId;
      }
      if (level !== previousStage) {
        pan.set(0, 0, 0);
        previousStage = level;
      }
      if (latest.selectedAnswerId !== previousAnswer && level === 2) {
        pan.set(0, 0, 0);
        previousAnswer = latest.selectedAnswerId;
      }
      const inward = smooth(depth),
        intimate = smooth(depth - 1);
      const safeAspect = Math.min(camera.aspect, 1.5);
      const extent = Math.max(
        ...layout.map(
          (node) =>
            Math.max(
              Math.abs(node.position.x) / safeAspect,
              Math.abs(node.position.y),
            ) + node.spec.radius,
        ),
      );
      const farRadius = Math.max(
        320,
        (extent / Math.tan(THREE.MathUtils.degToRad(24))) * 1.1,
      );
      const galaxyRadius = 150 * Math.max(1, 0.95 / camera.aspect);
      const stellarRadius = 38 * Math.max(1, 0.96 / camera.aspect);
      modelRadius = THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(farRadius, galaxyRadius, inward),
        stellarRadius,
        intimate,
      );
      let movement = 0;
      if (latest.flightMode && !document.querySelector('[role="dialog"]')) {
        const speed = keys.has("shift") ? 2 : 1;
        if (keys.has("w") || keys.has("arrowup")) {
          latest.onDepthChange(clamp(depth + dt * 0.3 * speed, 0, 2));
          movement = speed;
        }
        if (keys.has("s") || keys.has("arrowdown")) {
          latest.onDepthChange(clamp(depth - dt * 0.3 * speed, 0, 2));
          movement = speed;
        }
        if (keys.has("a") || keys.has("arrowleft"))
          pan.x -= dt * modelRadius * 0.08 * speed;
        if (keys.has("d") || keys.has("arrowright"))
          pan.x += dt * modelRadius * 0.08 * speed;
      }
      desiredTarget.set(0, 0, 0).lerp(q.position, inward);
      if (a) desiredTarget.lerp(a.position, intimate);
      desiredTarget.add(pan);
      const ease = latest.reducedMotion ? 1 : 1 - Math.exp(-dt * 5);
      yaw = THREE.MathUtils.lerp(yaw, yawTarget, ease);
      pitch = THREE.MathUtils.lerp(pitch, pitchTarget, ease);
      target.lerp(desiredTarget, ease);
      desiredPosition
        .set(
          Math.sin(yaw) * Math.cos(pitch),
          Math.sin(pitch),
          Math.cos(yaw) * Math.cos(pitch),
        )
        .multiplyScalar(modelRadius)
        .add(target);
      currentPosition.lerp(desiredPosition, ease);
      camera.position.copy(currentPosition);
      camera.lookAt(target);
      camera.updateMatrixWorld();
      cameraMemory.current = {
        position: currentPosition.clone(),
        target: target.clone(),
        yaw,
        pitch,
        pan: pan.clone(),
      };
      syncPlanets(depth);
      if (system) {
        system.setOpacity(smooth((depth - 1.25) / 0.6));
        system.update(
          elapsed,
          latest.reducedMotion,
          pointers.size > 0 ||
            !!container.querySelector(
              ".galaxy-label:hover,.galaxy-label:focus-within",
            ) ||
            !!document.querySelector('[role="dialog"]'),
        );
      }
      layout.forEach((node) => {
        const chosen = node.question.id === q.question.id;
        const opacity = chosen
          ? (1 - inward * 0.12) * (1 - intimate * 0.982)
          : 1 - inward * 0.96;
        galaxyModels.get(node.question.id)?.setOpacity(opacity);
        galaxyModels
          .get(node.question.id)
          ?.update(elapsed, latest.reducedMotion);
        node.answers.forEach(({ answer }) => {
          const star = answerStars.get(answer.id)!;
          star.group.visible = depth < 1.68 || answer.id !== a?.answer.id;
          const opacity = chosen
            ? (0.48 + inward * 0.52) * (1 - intimate * 0.96)
            : 0.3 * (1 - inward);
          (star.core.material as THREE.MeshBasicMaterial).opacity = opacity;
          star.glow.material.opacity =
            opacity * (0.4 + relevance(answer.relevance) * 0.6);
        });
      });
      networkMaterial.opacity = 0.11 * (1 - inward);
      trails.material.opacity =
        latest.flightMode && !latest.reducedMotion ? movement * 0.08 : 0;
      writeProjection(level, dt);
      projectionTick++;
      renderer.render(scene, camera);
    };
    const nearestBody = (x: number, y: number) => {
      const rect = canvas.getBoundingClientRect();
      let nearest: BodyAnchor | undefined,
        score = Infinity;
      currentBodies.forEach((node) => {
        const projected = projectAnchor(node.position, camera, width, height);
        if (!projected.visible) return;
        const distance = Math.hypot(
          projected.x - (x - rect.left),
          projected.y - (y - rect.top),
        );
        const radius = Math.max(
          28,
          (node.radius * height) /
            (camera.position.distanceTo(node.position) * 0.89) +
            10,
        );
        if (distance < radius && distance < score) {
          score = distance;
          nearest = node;
        }
      });
      return nearest;
    };
    const selectBody = (body: BodyAnchor, enter = false) => {
      const latest = propsRef.current;
      if (body.kind === "question") {
        latest.onSelectQuestion(body.id);
        if (enter) latest.onDepthChange(1);
      } else if (body.kind === "answer") {
        if (body.index !== undefined)
          setPage(Math.floor(body.index / pageSizeRef.current));
        latest.onSelectAnswer(body.id);
        if (enter) latest.onDepthChange(2);
      } else {
        const answer = focus().answer;
        const highlight = answer && meaningfulHighlights(answer)[body.index!];
        if (highlight) {
          setPage(Math.floor(body.index! / pageSizeRef.current));
          latest.onSelectParagraph(highlight.paragraphIndex, highlight.text);
          if (enter)
            latest.onOpenReader(highlight.paragraphIndex, highlight.text);
        }
      }
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0 && event.button !== 2) return;
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      pointerStart = { x: event.clientX, y: event.clientY };
      moved = false;
      panning = event.shiftKey || event.button === 2;
      setDragging(true);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };
    const move = (event: PointerEvent) => {
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      const dx = event.clientX - previous.x,
        dy = event.clientY - previous.y;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (
        Math.hypot(
          event.clientX - pointerStart.x,
          event.clientY - pointerStart.y,
        ) > 5
      )
        moved = true;
      if (pointers.size > 1) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        propsRef.current.onDepthChange(
          clamp(
            propsRef.current.depth + (distance - pinchDistance) * 0.004,
            0,
            2,
          ),
        );
        pinchDistance = distance;
      } else if (panning) {
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(
            camera.quaternion,
          ),
          up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
        pan
          .addScaledVector(right, ((-dx * modelRadius) / height) * 0.65)
          .addScaledVector(up, ((dy * modelRadius) / height) * 0.65);
      } else {
        yawTarget -= dx * 0.005;
        pitchTarget = clamp(pitchTarget + dy * 0.0035, -1.25, 1.25);
      }
    };
    const up = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (canvas.hasPointerCapture(event.pointerId))
        canvas.releasePointerCapture(event.pointerId);
      if (!pointers.size) setDragging(false);
      if (!moved && event.type !== "pointercancel") {
        const body = nearestBody(event.clientX, event.clientY);
        if (body) selectBody(body);
      }
    };
    const double = (event: MouseEvent) => {
      const body = nearestBody(event.clientX, event.clientY);
      if (body) selectBody(body, true);
    };
    const keydown = (event: KeyboardEvent) => {
      if (
        isTyping(event.target) ||
        !propsRef.current.flightMode ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return;
      const key = event.key.toLowerCase();
      if (
        [
          "w",
          "a",
          "s",
          "d",
          "arrowup",
          "arrowdown",
          "arrowleft",
          "arrowright",
          "shift",
        ].includes(key)
      ) {
        keys.add(key);
        event.preventDefault();
      }
    };
    const keyup = (event: KeyboardEvent) =>
      keys.delete(event.key.toLowerCase());
    const blur = () => {
      keys.clear();
      pointers.clear();
      setDragging(false);
    };
    const visibility = () => {
      hidden = document.hidden || contextLost;
      cancelAnimationFrame(frame);
      keys.clear();
      if (!hidden) {
        lastTime = 0;
        frame = requestAnimationFrame(animate);
      }
    };
    const lost = (event: Event) => {
      event.preventDefault();
      contextLost = true;
      hidden = true;
      cancelAnimationFrame(frame);
      setWebglAvailable(false);
    };
    const restored = () => {
      contextLost = false;
      setWebglAvailable(true);
      visibility();
    };
    const contextMenu = (event: Event) => event.preventDefault();
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("dblclick", double);
    canvas.addEventListener("contextmenu", contextMenu);
    canvas.addEventListener("webglcontextlost", lost);
    canvas.addEventListener("webglcontextrestored", restored);
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", visibility);
    frame = requestAnimationFrame(animate);
    return () => {
      destroyed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("dblclick", double);
      canvas.removeEventListener("contextmenu", contextMenu);
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", visibility);
      galaxyModels.forEach((model) => {
        scene.remove(model.group);
        model.dispose();
      });
      if (system) {
        scene.remove(system.group);
        system.dispose();
      }
      const geometries = new Set<THREE.BufferGeometry>(),
        materials = new Set<THREE.Material>();
      scene.traverse((object) => {
        if (
          object instanceof THREE.Mesh ||
          object instanceof THREE.Line ||
          object instanceof THREE.Points ||
          object instanceof THREE.Sprite
        ) {
          if ("geometry" in object) geometries.add(object.geometry);
          const m = object.material;
          (Array.isArray(m) ? m : [m]).forEach((material) =>
            materials.add(material),
          );
        }
      });
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      texture.dispose();
      renderer.dispose();
    };
  }, [layout]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const latest = propsRef.current;
      const delta =
        event.deltaMode === 1
          ? event.deltaY * 16
          : event.deltaMode === 2
            ? event.deltaY * container.clientHeight
            : event.deltaY;
      const level = stageAt(latest.depth);
      if (delta < 0 && level < 2) {
        let node = (event.target as HTMLElement)?.closest<HTMLElement>(
          ".galaxy-content-enter .galaxy-label",
        );
        let distance = 90;
        if (!node)
          container
            .querySelectorAll<HTMLElement>(
              ".galaxy-content-enter .galaxy-label",
            )
            .forEach((element) => {
              const marker = element.querySelector(".galaxy-star-marker");
              if (!marker || getComputedStyle(element).visibility === "hidden")
                return;
              const rect = marker.getBoundingClientRect();
              const d = Math.hypot(
                event.clientX - rect.x - rect.width / 2,
                event.clientY - rect.y - rect.height / 2,
              );
              if (d < distance) {
                distance = d;
                node = element;
              }
            });
        if (node?.dataset.nodeId) {
          if (!level) latest.onSelectQuestion(node.dataset.nodeId);
          else latest.onSelectAnswer(node.dataset.nodeId);
        }
      }
      latest.onDepthChange(clamp(latest.depth - delta * 0.0011, 0, 2));
    };
    container.addEventListener("wheel", wheel, { passive: false });
    return () => container.removeEventListener("wheel", wheel);
  }, []);

  const sourceSubtitle = (question: Question) =>
    question.kind === "topic"
      ? `主题聚合 · ${question.answers.length} 篇原文`
      : question.kind === "article"
        ? "独立文章"
        : `${question.answers.length} 个回答`;
  return (
    <div
      ref={containerRef}
      className={`galaxy-scene galaxy-spatial ${dragging ? "galaxy-is-dragging" : ""} ${!webglAvailable ? "galaxy-is-fallback" : ""} ${props.reducedMotion ? "galaxy-reduced-motion" : ""}`}
      data-depth={stage}
      aria-label="知识宇宙探索"
    >
      <CosmicBackdrop depth={props.depth} reducedMotion={props.reducedMotion} />
      <canvas
        ref={canvasRef}
        className="galaxy-canvas"
        tabIndex={0}
        aria-label="三维知识星空。滚轮深入或返回；拖动旋转视角，Shift 拖动平移；星体与文字一起移动。"
      />
      <div className="galaxy-vignette" aria-hidden="true" />
      {!webglAvailable && (
        <span className="galaxy-fallback-notice">二维星图</span>
      )}
      {layers.map((layer) => {
        const exiting = layer.phase === "exit";
        const question =
          layer.key === layerKey ? selectedQuestion : layer.question;
        const answer = layer.key === layerKey ? selectedAnswer : layer.answer;
        const questions =
          layer.key === layerKey ? props.questions : layer.questions;
        const items =
          layer.stage === 0
            ? questions
            : layer.stage === 1
              ? (question?.answers ?? [])
              : answer
                ? meaningfulHighlights(answer)
                : [];
        const visible = layer.stage
          ? items.slice(
              page * pageSizeRef.current,
              (page + 1) * pageSizeRef.current,
            )
          : items;
        const text = (value: string) => (
          <StellarText
            text={value}
            phase={layer.phase}
            reducedMotion={props.reducedMotion}
          />
        );
        const spec = question
          ? layout.find((node) => node.question.id === question.id)?.spec
          : undefined;
        return (
          <div
            key={layer.id}
            className={`galaxy-content-layer galaxy-content-${layer.stage} galaxy-content-${layer.phase}`}
            aria-hidden={exiting || undefined}
            ref={(element) => {
              if (element) element.inert = exiting;
            }}
          >
            {layer.stage > 0 && question && (
              <>
                <button
                  ref={(element) => {
                    if (!exiting) coreRef.current = element;
                  }}
                  className="galaxy-core-hit"
                  aria-label={
                    layer.stage === 2 ? "打开中心文章原文" : "聚焦星系核心问题"
                  }
                  onClick={() => {
                    if (layer.stage === 2) props.onOpenReader();
                  }}
                />
                <div
                  ref={(element) => {
                    if (!exiting) hubRef.current = element;
                  }}
                  className={`galaxy-hub ${layer.stage === 2 ? "galaxy-hub-article" : ""}`}
                  style={
                    {
                      "--galaxy-star-color": question.color,
                    } as React.CSSProperties
                  }
                >
                  <span className="galaxy-hub-kind">
                    {layer.stage === 2 || question.kind === "article"
                      ? "ARTICLE"
                      : question.kind === "topic"
                        ? "THEME"
                        : "QUESTION"}
                    <i />
                  </span>
                  {layer.stage === 2 && answer ? (
                    <button
                      className="galaxy-hub-title"
                      onClick={() => props.onOpenReader()}
                      aria-label={`阅读原文：${answer.title}`}
                    >
                      {text(answer.title)}
                    </button>
                  ) : (
                    <h1 className="galaxy-hub-title">{text(question.title)}</h1>
                  )}
                  <span className="galaxy-hub-meta">
                    {layer.stage === 1
                      ? `${sourceSubtitle(question)}${spec ? ` · ${spec.label}` : ""}`
                      : answer?.author}
                  </span>
                  {layer.stage === 2 && (
                    <button
                      className="galaxy-hub-read"
                      onClick={() => props.onOpenReader()}
                    >
                      展开原文阅览 <kbd>F</kbd>
                    </button>
                  )}
                  {items.length > pageSizeRef.current && (
                    <div className="galaxy-orbit-pagination">
                      <button
                        aria-label="上一组星光"
                        disabled={!page}
                        onClick={() =>
                          setPage((value) => Math.max(0, value - 1))
                        }
                      >
                        ←
                      </button>
                      <span>
                        {page * pageSizeRef.current + 1}—
                        {Math.min(
                          items.length,
                          (page + 1) * pageSizeRef.current,
                        )}{" "}
                        / {items.length}
                      </span>
                      <button
                        aria-label="下一组星光"
                        disabled={
                          (page + 1) * pageSizeRef.current >= items.length
                        }
                        onClick={() => setPage((value) => value + 1)}
                      >
                        →
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
            <div
              className="galaxy-labels"
              aria-label={
                layer.stage === 0
                  ? "相关问题星系"
                  : layer.stage === 1
                    ? "问题中的回答"
                    : "文章精华段落"
              }
            >
              {visible.map((item, index) => {
                const isQuestion = layer.stage === 0,
                  isParagraph = layer.stage === 2;
                const q = isQuestion ? (item as Question) : question;
                const a = layer.stage === 1 ? (item as Answer) : answer;
                const highlight = isParagraph ? (item as Highlight) : undefined;
                const title =
                  highlight?.text ?? (isQuestion ? q!.title : a!.title);
                const key = `${isQuestion ? "q" : isParagraph ? "p" : "a"}:${item.id}`;
                const selected = isQuestion
                  ? q?.id === props.selectedQuestionId
                  : isParagraph
                    ? highlight?.paragraphIndex === props.selectedParagraph &&
                      (!props.selectedQuote ||
                        highlight.text === props.selectedQuote)
                    : a?.id === props.selectedAnswerId;
                const r = relevance(
                  isQuestion ? q!.relevance : (a?.relevance ?? 1),
                );
                const select = () => {
                  if (isQuestion) props.onSelectQuestion(q!.id);
                  else if (highlight)
                    props.onSelectParagraph(
                      highlight.paragraphIndex,
                      highlight.text,
                    );
                  else props.onSelectAnswer(a!.id);
                };
                const enter = () => {
                  if (isQuestion) {
                    props.onSelectQuestion(q!.id);
                    props.onDepthChange(1);
                  } else if (highlight)
                    props.onOpenReader(
                      highlight.paragraphIndex,
                      highlight.text,
                    );
                  else {
                    props.onSelectAnswer(a!.id);
                    props.onDepthChange(2);
                  }
                };
                return (
                  <div
                    key={key}
                    data-node-id={item.id}
                    data-node-kind={
                      isQuestion
                        ? "question"
                        : isParagraph
                          ? "paragraph"
                          : "answer"
                    }
                    data-morphology={
                      isQuestion
                        ? layout.find((node) => node.question.id === q!.id)
                            ?.spec.kind
                        : undefined
                    }
                    data-planet-kind={
                      isParagraph
                        ? getPlanetKind(
                            a!.id,
                            page * pageSizeRef.current + index,
                          )
                        : undefined
                    }
                    ref={(element) => {
                      if (!exiting) {
                        if (element) labelsRef.current.set(key, element);
                        else labelsRef.current.delete(key);
                      }
                    }}
                    className={`galaxy-label ${selected ? "galaxy-label-selected" : ""} ${isParagraph ? "galaxy-label-paragraph" : ""}`}
                    style={
                      {
                        "--galaxy-star-color": q?.color ?? "#b4d4e4",
                        "--star-power": 0.1 + Math.pow(r, 4.1) * 2.4,
                        "--node-index": index,
                      } as React.CSSProperties
                    }
                  >
                    <button
                      className="galaxy-star-marker"
                      onClick={select}
                      onDoubleClick={enter}
                      aria-label={`聚焦${isQuestion ? "问题" : isParagraph ? "段落" : "回答"}：${title.slice(0, 70)}`}
                      aria-pressed={selected}
                    >
                      <span />
                      <i />
                    </button>
                    <svg className="galaxy-label-leader" aria-hidden="true">
                      <line x1="0" y1="0" x2="0" y2="0" />
                    </svg>
                    <div className="galaxy-label-body">
                      <span className="galaxy-label-eyebrow">
                        {isQuestion
                          ? q?.kind === "topic"
                            ? "THEME"
                            : q?.kind === "article"
                              ? "ARTICLE"
                              : "QUESTION"
                          : isParagraph
                            ? `EXCERPT ${String(page * pageSizeRef.current + index + 1).padStart(2, "0")}`
                            : question?.kind === "topic" ||
                                question?.kind === "article"
                              ? "ARTICLE"
                              : "ANSWER"}
                        <i />
                      </span>
                      <button
                        className="galaxy-label-title"
                        onClick={isParagraph ? select : enter}
                        onDoubleClick={isParagraph ? enter : undefined}
                      >
                        {text(
                          isParagraph && title.length > 180
                            ? `${title.slice(0, 180)}…`
                            : title,
                        )}
                      </button>
                      <span className="galaxy-label-meta">
                        {isQuestion
                          ? `${sourceSubtitle(q!)} · ${layout.find((node) => node.question.id === q!.id)?.spec.label ?? ""}`
                          : highlight
                            ? `原文第 ${highlight.paragraphIndex + 1} 段 · ${planetKindNames[getPlanetKind(a!.id, page * pageSizeRef.current + index)]}${selected ? " · 已选中" : ""}`
                            : a?.author}
                      </span>
                      {!highlight ? (
                        <button
                          className="galaxy-label-enter"
                          onClick={enter}
                          aria-label={`${isQuestion ? "进入星系" : "阅读观点"}：${title}`}
                        >
                          {isQuestion ? "进入星系" : "深入这篇文章"}
                          <span aria-hidden="true">↗</span>
                        </button>
                      ) : (
                        <button
                          className="galaxy-label-enter"
                          onClick={enter}
                          aria-label={`在原文中阅读第 ${highlight.paragraphIndex + 1} 段`}
                        >
                          在原文中阅读<span aria-hidden="true">↗</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {props.flightMode && (
        <div className="galaxy-flight-hud" aria-hidden="true">
          <span className="galaxy-reticle" />
          <div className="galaxy-flight-caption">
            V · W A S D 飞行 · SHIFT 加速
          </div>
        </div>
      )}
    </div>
  );
}
