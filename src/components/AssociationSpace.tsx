import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { AssociationTopic } from '../lib/wormhole';
import { createParallelLayout, createParallelPortal } from './space/parallel-portals';
import { placeLabels, projectAnchor, type LabelPlacement } from './space/projection';
import StellarText from './StellarText';
import './association-space.css';

export interface AssociationSpaceProps {
  topics: AssociationTopic[];
  seed: string;
  reducedMotion: boolean;
  paused?: boolean;
  active?: boolean;
  onReady?: () => void;
  onChoose: (topic: AssociationTopic) => void;
  onBack: () => void;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
}

const RETURN_ID = '__return_to_origin__';
const clamp = THREE.MathUtils.clamp;
const isEditing = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]');

/** An orbitable parallel cosmos. Every visible destination has one real
 * world-space wormhole; labels follow those anchors just as in the star sea. */
export default function AssociationSpace({ topics, seed, reducedMotion, paused = false, active = true, onReady, onChoose, onBack, loading = false, error, onRetry }: AssociationSpaceProps) {
  const rootRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef(new Map<string, HTMLButtonElement>());
  const chooseRef = useRef(onChoose), backRef = useRef(onBack), readyRef = useRef(onReady);
  const pausedRef = useRef(paused), activeRef = useRef(active), committedRef = useRef(false);
  const readySentRef = useRef(false);
  const focusRef = useRef<((id: string) => void) | null>(null);
  const hoverRef = useRef<string | null>(null);
  const rearmRef = useRef<(() => void) | null>(null);
  const suppressClickUntil = useRef(0);
  const [graphicsFailed, setGraphicsFailed] = useState(false);
  const visibleTopics = topics.slice(0, 12);
  useEffect(() => {
    chooseRef.current = onChoose; backRef.current = onBack; readyRef.current = onReady;
    const resuming = pausedRef.current && !paused;
    pausedRef.current = paused; activeRef.current = active;
    if (resuming) { committedRef.current = false; rearmRef.current?.(); }
  }, [onChoose, onBack, onReady, paused, active]);
  useEffect(() => {
    if (graphicsFailed && !readySentRef.current) { readySentRef.current = true; readyRef.current?.(); }
  }, [graphicsFailed]);

  useEffect(() => {
    const root = rootRef.current, mount = canvasRef.current;
    if (!root || !mount) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' }); }
    catch {
      const fallback = requestAnimationFrame(() => setGraphicsFailed(true));
      return () => cancelAnimationFrame(fallback);
    }
    const mobile = window.innerWidth < 700;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.2 : 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2;
    renderer.setClearColor(0x000000, 0); renderer.domElement.setAttribute('aria-hidden', 'true');
    mount.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(54, 1, 0.08, 620);
    const entries: { id: string; topic?: AssociationTopic }[] = topics.slice(0, 12).map(topic => ({ id: topic.id, topic }));
    entries.push({ id: RETURN_ID });
    const positions = createParallelLayout(entries.map(entry => `${seed}:${entry.id}`), mobile);
    const portals = entries.map((entry, index) => {
      const model = createParallelPortal(`${seed}:${entry.id}`, index, { mobile });
      model.group.position.copy(positions[index]); scene.add(model.group);
      return { ...entry, model, anchor: { x: 0, y: 0, depth: 1, visible: false }, screenRadius: 20 };
    });
    const byId = new Map(portals.map(portal => [portal.id, portal]));
    // Distant light is static in world space: orbiting produces parallax, while
    // an inactive prewarm costs only its first rendered frame.
    let randomSeed = Array.from(seed).reduce((value, character) => Math.imul(value ^ character.charCodeAt(0), 16777619), 2166136261) >>> 0;
    const random = () => { randomSeed = Math.imul(randomSeed ^ randomSeed >>> 15, 2246822519) >>> 0; return randomSeed / 4294967296; };
    const stars = new Float32Array((mobile ? 850 : 1500) * 3);
    for (let i = 0; i < stars.length; i += 3) {
      const azimuth = random() * Math.PI * 2, elevation = Math.acos(2 * random() - 1), distance = 190 + random() * 220;
      stars[i] = Math.sin(elevation) * Math.cos(azimuth) * distance;
      stars[i + 1] = Math.cos(elevation) * distance; stars[i + 2] = Math.sin(elevation) * Math.sin(azimuth) * distance;
    }
    const starGeometry = new THREE.BufferGeometry(); starGeometry.setAttribute('position', new THREE.BufferAttribute(stars, 3));
    const starMaterial = new THREE.PointsMaterial({ color: 0xc3e9ff, size: 0.3, transparent: true, opacity: 0.48, depthWrite: false, sizeAttenuation: true, blending: THREE.AdditiveBlending });
    scene.add(new THREE.Points(starGeometry, starMaterial));
    let width = 1, height = 1;
    const baseRadius = mobile ? 157 : 110;
    const center = new THREE.Vector3(), targetCenter = new THREE.Vector3();
    const orbit = { yaw: 0, pitch: 0.08, radius: baseRadius, targetYaw: 0, targetPitch: 0.08, targetRadius: baseRadius };
    let selected: string | null = null, entering = false;
    const resize = () => {
      width = Math.max(1, mount.clientWidth); height = Math.max(1, mount.clientHeight);
      camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height);
    };
    resize(); const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(mount);
    const blocked = () => pausedRef.current || !activeRef.current || committedRef.current;
    const pointerPositions = new Map<number, { x: number; y: number }>();
    let drag: { id: number; x: number; y: number; startX: number; startY: number; moved: boolean; type: string } | null = null;
    let pinchDistance = 0;
    let lastWheelTime = 0;
    let lastWheelPoint = { x: -1000, y: -1000 };
    const localPoint = (clientX: number, clientY: number) => {
      const bounds = root.getBoundingClientRect(); return { x: clientX - bounds.left, y: clientY - bounds.top };
    };
    const portalAt = (x: number, y: number) => {
      let best: typeof portals[number] | null = null, bestDistance = Infinity;
      for (const portal of portals) {
        if (!portal.anchor.visible) continue;
        const distance = Math.hypot(x - portal.anchor.x, y - portal.anchor.y);
        if (distance < Math.max(26, portal.screenRadius * 1.28) && distance < bestDistance) { best = portal; bestDistance = distance; }
      }
      return best;
    };
    const select = (id: string, automatic: boolean) => {
      const portal = byId.get(id); if (!portal || blocked()) return;
      selected = id; targetCenter.copy(portal.model.group.position); entering = automatic;
      if (automatic) orbit.targetRadius = Math.max(5.8, portal.model.radius * 1.65);
      root.dataset.selectedTopic = id; root.dataset.selectedKeyword = portal.topic?.keyword ?? seed;
    };
    focusRef.current = id => { if (performance.now() >= suppressClickUntil.current) select(id, true); };
    rearmRef.current = () => {
      entering = false; hoverRef.current = null;
      if (selected) { orbit.targetRadius = Math.max(orbit.radius, 28); }
    };
    const zoom = (delta: number, hoveredId?: string | null) => {
      if (blocked()) return;
      const inward = delta < 0;
      if (inward && hoveredId && hoveredId !== selected) select(hoveredId, false);
      orbit.targetRadius = clamp(orbit.targetRadius * Math.exp(clamp(delta, -1500, 1500) * 0.0015), selected ? 5.8 : baseRadius * 0.48, baseRadius * 1.8);
      entering = inward && selected !== null;
      if (!inward && orbit.targetRadius > baseRadius * 0.82) {
        selected = null; targetCenter.set(0, 0, 0); delete root.dataset.selectedTopic; delete root.dataset.selectedKeyword;
      }
    };
    const clearPointers = () => { pointerPositions.clear(); drag = null; pinchDistance = 0; hoverRef.current = null; entering = false; delete root.dataset.dragging; };
    const onPointerDown = (event: PointerEvent) => {
      if (blocked() || event.button !== 0 || event.target instanceof Element && event.target.closest('a')) return;
      const point = localPoint(event.clientX, event.clientY);
      pointerPositions.set(event.pointerId, point);
      if (pointerPositions.size === 1) drag = { id: event.pointerId, ...point, startX: point.x, startY: point.y, moved: false, type: event.pointerType };
      else {
        const [a, b] = [...pointerPositions.values()]; pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const portal = portalAt(mid.x, mid.y); if (portal) select(portal.id, false);
        if (drag) drag.moved = true; suppressClickUntil.current = performance.now() + 500;
      }
      if (!(event.target instanceof Element && event.target.closest('button'))) root.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (blocked()) return;
      const point = localPoint(event.clientX, event.clientY);
      if (pointerPositions.has(event.pointerId)) pointerPositions.set(event.pointerId, point);
      if (pointerPositions.size >= 2) {
        const [a, b] = [...pointerPositions.values()]; const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDistance > 0 && distance > 0) zoom(-Math.log(distance / pinchDistance) / 0.0015, selected);
        pinchDistance = distance; suppressClickUntil.current = performance.now() + 500; return;
      }
      if (drag?.id === event.pointerId) {
        const dx = point.x - drag.x, dy = point.y - drag.y;
        if (Math.hypot(point.x - drag.startX, point.y - drag.startY) > 5) drag.moved = true;
        if (drag.moved) {
          orbit.targetYaw -= dx * 0.0045; orbit.targetPitch = clamp(orbit.targetPitch + dy * 0.0042, -1.35, 1.35);
          entering = false; root.dataset.dragging = 'true'; suppressClickUntil.current = performance.now() + 400;
        }
        drag.x = point.x; drag.y = point.y; return;
      }
      const label = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('.association-topic') : null;
      hoverRef.current = label?.dataset.portalId ?? portalAt(point.x, point.y)?.id ?? null;
    };
    const onPointerUp = (event: PointerEvent) => {
      const wasDrag = drag;
      pointerPositions.delete(event.pointerId);
      if (wasDrag?.id === event.pointerId && !wasDrag.moved && pointerPositions.size === 0 && !(event.target instanceof Element && event.target.closest('button')) && performance.now() >= suppressClickUntil.current) {
        const point = localPoint(event.clientX, event.clientY), portal = portalAt(point.x, point.y); if (portal) select(portal.id, true);
      }
      if (wasDrag?.moved) suppressClickUntil.current = performance.now() + 400;
      drag = null; pinchDistance = 0; delete root.dataset.dragging;
    };
    const onPointerCancel = () => { suppressClickUntil.current = performance.now() + 300; clearPointers(); };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault(); event.stopImmediatePropagation();
      const point = localPoint(event.clientX, event.clientY);
      const label = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('.association-topic') : null;
      // A wheel gesture stays on the chosen aperture while it moves toward
      // the centre. A different portal passing under a stationary cursor must
      // not steal the remainder of that same gesture.
      const now = performance.now();
      const continuing = selected && now - lastWheelTime < 600 && Math.hypot(point.x - lastWheelPoint.x, point.y - lastWheelPoint.y) < 12;
      const hovered = continuing ? selected : label?.dataset.portalId ?? portalAt(point.x, point.y)?.id ?? hoverRef.current;
      lastWheelTime = now; lastWheelPoint = point;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
      zoom(event.deltaY * unit, hovered);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (blocked() || isEditing(event.target)) return;
      if (event.code === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); clearPointers(); entering = false; backRef.current(); }
    };
    const onContextLost = (event: Event) => { event.preventDefault(); setGraphicsFailed(true); clearPointers(); };
    root.addEventListener('pointerdown', onPointerDown); root.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp); root.addEventListener('pointercancel', onPointerCancel);
    root.addEventListener('wheel', onWheel, { passive: false, capture: true });
    window.addEventListener('keydown', onKeyDown, true); window.addEventListener('blur', clearPointers); document.addEventListener('visibilitychange', clearPointers);
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    const updateCamera = () => {
      camera.position.set(Math.sin(orbit.yaw) * Math.cos(orbit.pitch), Math.sin(orbit.pitch), Math.cos(orbit.yaw) * Math.cos(orbit.pitch)).multiplyScalar(orbit.radius).add(center);
      camera.lookAt(center); camera.updateMatrixWorld();
    };
    updateCamera(); renderer.compile(scene, camera);
    let frame = 0, previousTime = 0, elapsed = 0, rendered = false, lastStatus = 0, lastResolutionCheck = 0, averageFrameMs = 16;
    let previousLabels = new Map<string, LabelPlacement>();
    const animate = (time: number) => {
      frame = requestAnimationFrame(animate);
      const dt = Math.min(0.1, Math.max(0, (time - (previousTime || time)) / 1000)); previousTime = time;
      if (renderer.getContext().isContextLost() || rendered && (document.hidden || blocked())) return;
      if (!blocked()) {
        elapsed += dt;
        orbit.yaw = THREE.MathUtils.damp(orbit.yaw, orbit.targetYaw, 9, dt);
        orbit.pitch = THREE.MathUtils.damp(orbit.pitch, orbit.targetPitch, 9, dt);
        orbit.radius = THREE.MathUtils.damp(orbit.radius, orbit.targetRadius, reducedMotion ? 9 : 4.3, dt);
        center.lerp(targetCenter, 1 - Math.exp(-5 * dt));
      }
      updateCamera();
      const labelWidth = width < 650 ? 152 : 190;
      for (const portal of portals) {
        portal.model.update(elapsed, reducedMotion, selected === portal.id || hoverRef.current === portal.id);
        portal.anchor = projectAnchor(portal.model.group.position, camera, width, height);
        portal.screenRadius = portal.model.radius / Math.max(0.1, portal.model.group.position.distanceTo(camera.position)) * height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
      }
      const placed = placeLabels(portals.filter(portal => portal.anchor.visible).map(portal => ({ id: portal.id, anchor: { ...portal.anchor, y: portal.anchor.y + Math.min(48, portal.screenRadius * 0.65) }, width: labelWidth, height: width < 650 ? 56 : 62, priority: selected === portal.id ? 15 : portal.id === RETURN_ID ? 2 : 5, preferredSide: portal.anchor.x > width * 0.63 ? 'left' as const : 'right' as const })), { width, height, top: 25, bottom: height - 28, left: 22, right: width - 22 }, previousLabels);
      previousLabels = placed;
      for (const portal of portals) {
        const element = labelRefs.current.get(portal.id); if (!element) continue;
        const point = placed.get(portal.id);
        const visible = !!point?.visible && (orbit.radius > 17 || selected === portal.id);
        element.style.visibility = visible ? 'visible' : 'hidden'; element.tabIndex = visible && !blocked() ? 0 : -1;
        element.setAttribute('aria-hidden', String(!visible));
        if (visible && point) {
          element.style.transform = `translate3d(${point.x.toFixed(2)}px,${point.y.toFixed(2)}px,0)`;
          element.style.opacity = String(clamp((orbit.radius - 7) / 13, 0, 1));
          element.dataset.side = point.x + labelWidth / 2 < portal.anchor.x ? 'left' : 'right';
        }
        element.dataset.portalKind = portal.model.kind;
        element.dataset.worldX = portal.model.group.position.x.toFixed(2); element.dataset.worldY = portal.model.group.position.y.toFixed(2); element.dataset.worldZ = portal.model.group.position.z.toFixed(2);
        element.dataset.screenX = portal.anchor.x.toFixed(2); element.dataset.screenY = portal.anchor.y.toFixed(2); element.dataset.selected = String(selected === portal.id);
      }
      renderer.render(scene, camera);
      if (!rendered) { rendered = true; root.dataset.ready = 'true'; if (!readySentRef.current) { readySentRef.current = true; readyRef.current?.(); } }
      averageFrameMs += (dt * 1000 - averageFrameMs) * 0.06;
      if (time - lastResolutionCheck > 1800) {
        lastResolutionCheck = time; const ratio = renderer.getPixelRatio();
        if (averageFrameMs > 39 && ratio > 0.85) renderer.setPixelRatio(Math.max(0.85, ratio * 0.86));
      }
      if (time - lastStatus > 100) {
        lastStatus = time;
        root.dataset.cameraYaw = orbit.yaw.toFixed(3); root.dataset.cameraPitch = orbit.pitch.toFixed(3); root.dataset.cameraRadius = orbit.radius.toFixed(2);
        root.dataset.cameraX = camera.position.x.toFixed(2); root.dataset.cameraY = camera.position.y.toFixed(2); root.dataset.cameraZ = camera.position.z.toFixed(2);
        root.dataset.drawCalls = String(renderer.info.render.calls); root.dataset.frameMs = averageFrameMs.toFixed(1);
      }
      const chosen = selected ? byId.get(selected) : undefined;
      if (!blocked() && entering && chosen && orbit.targetRadius <= chosen.model.radius * 2.15 && orbit.radius <= chosen.model.radius * 2.3 && center.distanceTo(targetCenter) < 0.55) {
        committedRef.current = true; entering = false; clearPointers();
        if (chosen.topic) chooseRef.current(chosen.topic); else backRef.current();
      }
    };
    frame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frame); resizeObserver.disconnect(); focusRef.current = null; rearmRef.current = null; clearPointers();
      root.removeEventListener('pointerdown', onPointerDown); root.removeEventListener('pointermove', onPointerMove); window.removeEventListener('pointerup', onPointerUp); root.removeEventListener('pointercancel', onPointerCancel);
      root.removeEventListener('wheel', onWheel, true); window.removeEventListener('keydown', onKeyDown, true); window.removeEventListener('blur', clearPointers); document.removeEventListener('visibilitychange', clearPointers);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      portals.forEach(portal => portal.model.dispose()); starGeometry.dispose(); starMaterial.dispose();
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); scene.clear();
    };
  }, [topics, seed, reducedMotion]);

  const chooseFallback = (topic?: AssociationTopic) => {
    if (pausedRef.current || !activeRef.current || committedRef.current) return;
    committedRef.current = true; if (topic) chooseRef.current(topic); else backRef.current();
  };
  return <section ref={rootRef} className={`association-space${graphicsFailed ? ' association-space-fallback' : ''}`} aria-label="平行宇宙" data-testid="association-space" data-reduced-motion={reducedMotion} data-active={active}>
    <div className="association-nebula" aria-hidden="true" />
    <div ref={canvasRef} className="association-canvas" />
    <div className="association-labels" aria-label="可探索的平行话题">
      {visibleTopics.map(topic => <button key={topic.id} ref={element => { if (element) labelRefs.current.set(topic.id, element); else labelRefs.current.delete(topic.id); }} className="association-topic" data-portal-id={topic.id} aria-label={`探索 ${topic.keyword}`} onClick={() => graphicsFailed ? chooseFallback(topic) : focusRef.current?.(topic.id)} disabled={paused || !active} style={{ visibility: graphicsFailed ? 'visible' : 'hidden' }}>
        <strong><StellarText text={topic.keyword} phase="enter" reducedMotion={reducedMotion} /></strong>
      </button>)}
      <button ref={element => { if (element) labelRefs.current.set(RETURN_ID, element); else labelRefs.current.delete(RETURN_ID); }} className="association-topic association-return-topic" data-portal-id={RETURN_ID} data-return="true" aria-label={`返回 ${seed || '原来的星海'}`} onClick={() => graphicsFailed ? chooseFallback() : focusRef.current?.(RETURN_ID)} disabled={paused || !active} style={{ visibility: graphicsFailed ? 'visible' : 'hidden' }}>
        <strong><StellarText text={seed || '星海'} phase="enter" reducedMotion={reducedMotion} /></strong>
      </button>
    </div>
    <a className="association-image-credit" href="https://esahubble.org/images/heic1501a/" target="_blank" rel="noreferrer">NASA, ESA/Hubble and the Hubble Heritage Team</a>
    {loading && <span className="association-loading" role="status" aria-label="正在寻找联想" />}
    {error && <div className="association-state" role="status"><p>{error}</p>{onRetry && <button onClick={onRetry} aria-label="重试联想检索">↻</button>}</div>}
    {graphicsFailed && <span className="association-sr-only" role="status">当前设备无法显示空间，可选择话题继续探索。</span>}
  </section>;
}
