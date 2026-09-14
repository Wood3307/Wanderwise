/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import * as THREE from 'three';

type SceneProps = Parameters<typeof import('../GalaxyScene').default>[0];
type ElementTree = { type?: unknown; props?: Record<string, unknown> };

/** Execute the real scene's hooks/listeners with a renderer boundary, retaining
 * its real Three geometry/materials and transition implementation. No DOM or
 * GPU is required, so lifecycle events can be dispatched deterministically. */
test('the actual scene retains search effects through visibility/context pauses and disposes them on unmount', async t => {
  const effects: (() => void | (() => void))[] = [];
  const cleanups: (() => void)[] = [];
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0, renders = 0, rendererDisposals = 0, observerDisconnections = 0;
  let renderedScene: THREE.Scene | undefined;
  class Element extends EventTarget {
    clientWidth = 1280;
    clientHeight = 720;
    dataset: Record<string, string> = {};
    style = { setProperty() {}, removeProperty() {} };
    closest() { return null; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    getBoundingClientRect() {
      return { left: 0, top: 0, right: this.clientWidth, bottom: this.clientHeight,
        x: 0, y: 0, width: this.clientWidth, height: this.clientHeight };
    }
    getContext() { return null; }
  }
  const canvas = new Element(), container = new Element(), window = new EventTarget();
  const document = Object.assign(new Element(), {
    hidden: false, activeElement: null, createElement: () => new Element(),
  });
  const harness = {
    effects,
    makeRenderer: () => ({
      setPixelRatio() {}, setClearColor() {}, setSize() {},
      render(scene: THREE.Scene, camera: THREE.Camera) {
        scene.updateMatrixWorld(true); camera.updateMatrixWorld();
        renderedScene = scene; renders++;
      },
      dispose() { rendererDisposals++; },
    }),
  };
  const replacements: Record<string, unknown> = {
    __galaxyLifecycleHarness: harness,
    window, document, HTMLElement: Element, innerWidth: 1280, devicePixelRatio: 1,
    matchMedia: () => Object.assign(new EventTarget(), { matches: false }),
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: (id: number) => { frames.delete(id); },
    ResizeObserver: class { observe() {} disconnect() { observerDisconnections++; } },
  };
  const previous = Object.fromEntries(Object.keys(replacements).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries(replacements)) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  function step(time: number) {
    assert.equal(frames.size, 1, 'only one scene animation loop may be scheduled');
    const [id, callback] = frames.entries().next().value!;
    frames.delete(id); callback(time);
  }
  function attach(tree: unknown) {
    if (Array.isArray(tree)) { tree.forEach(attach); return; }
    if (!tree || typeof tree !== 'object') return;
    const { type, props } = tree as ElementTree;
    if (!props) return;
    if (typeof props.ref === 'object' && props.ref && 'current' in props.ref) {
      props.ref.current = type === 'canvas' ? canvas : container;
    }
    attach(props.children);
  }
  try {
    const mocks: Record<string, string> = {
      react: `const h=()=>globalThis.__galaxyLifecycleHarness;
        export const useEffect=fn=>h().effects.push(fn),useMemo=fn=>fn();
        export const useState=initial=>[typeof initial==='function'?initial():initial,()=>{}];
        export const useRef=value=>({current:value});`,
      'react/jsx-runtime': 'export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment="Fragment";',
      three: `export * from ${JSON.stringify(import.meta.resolve('three'))};
        export function WebGLRenderer(){return globalThis.__galaxyLifecycleHarness.makeRenderer();}`,
      './StellarText': 'export default "StellarText";',
      './RichText': 'export default "RichText";',
      './CosmicBackdrop': 'export default "CosmicBackdrop";',
      '../lib/rich-text': 'export const hasRichSyntax=()=>false;',
    };
    const compiled = await build({
      entryPoints: [fileURLToPath(new URL('../GalaxyScene.tsx', import.meta.url))],
      bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic',
      plugins: [{ name: 'scene-lifecycle-boundary', setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => {
          if (args.path.startsWith('file:')) return { path: args.path, external: true };
          if (args.path in mocks || args.path.endsWith('.css')) return { path: args.path, namespace: 'boundary' };
        });
        builder.onLoad({ filter: /.*/, namespace: 'boundary' }, args => ({ contents: mocks[args.path] ?? '', loader: 'js' }));
      } }],
    });
    const { default: Scene } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`) as {
      default: (props: SceneProps) => unknown;
    };
    const answer = (id: string, count: number): SceneProps['questions'][number]['answers'][number] => ({
      id, title: `文章 ${id}`, author: '作者', excerpt: '摘要', relevance: 1,
      url: `https://www.zhihu.com/question/123/answer/${id}`, isExcerpt: false,
      paragraphs: Array.from({ length: count }, (_, index) => `真实文章中有意义的核心段落 ${index + 1}，对应自己的行星。`),
      highlights: Array.from({ length: count }, (_, index) => ({
        id: `${id}:paragraph:${index}`, text: `核心段落 ${index + 1}`, paragraphIndex: index,
      })),
    });
    const props: SceneProps = {
      questions: [
        { id: 'lifecycle:question', title: '真实星体', excerpt: '摘要', keywords: [],
          relevance: 1, color: '#a6c8eb', answers: [answer('101', 2), answer('102', 3)] },
        { id: 'lifecycle:other-question', title: '另一个问题', excerpt: '摘要', keywords: [],
          relevance: 1, color: '#ceb8ed', answers: [answer('201', 5)] },
      ],
      selectedQuestionId: 'lifecycle:question', selectedAnswerId: null, selectedParagraph: null,
      depth: 0, resetToken: 0, flightMode: false, reducedMotion: false, voyage: null,
      onDepthChange() {}, onSelectQuestion() {}, onSelectAnswer() {}, onOpenReader() {}, onSelectParagraph() {},
    };
    attach(Scene(props));
    for (const effect of effects) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); }
    await t.test('each depth shows only its content-bearing stars and reverse navigation restores them', () => {
      step(100);
      assert.ok(renderedScene);
      const scene = renderedScene;
      // Answer stars are independent scene actors. The article title star is
      // inside its planetary system, so it must survive hiding answer actors.
      const answerStars = scene.children.filter(object => object.userData.celestialType === 'star');
      assert.equal(answerStars.length, 3, 'retain all real answers for later navigation');
      const visibleAnswers = () => answerStars.filter(object => object.visible);
      assert.deepEqual(visibleAnswers(), [], 'overview must not show anonymous answer spheres');

      props.depth = 1;
      step(200);
      const firstQuestionStars = visibleAnswers();
      assert.equal(firstQuestionStars.length, 2, 'the first question has exactly two answer stars');

      props.selectedQuestionId = 'lifecycle:other-question';
      props.selectedAnswerId = '201';
      step(300);
      const otherQuestionStars = visibleAnswers();
      assert.equal(otherQuestionStars.length, 1, 'only the newly selected question may show its answer');
      assert.ok(firstQuestionStars.every(star => !star.visible), 'the previous question cannot leave floating answer spheres');
      assert.ok(!firstQuestionStars.includes(otherQuestionStars[0]));

      props.depth = 2;
      step(400);
      assert.deepEqual(visibleAnswers(), [], 'article depth cannot leave sibling or other-question answer spheres');
      const system = scene.getObjectByName('article-planetary-system');
      assert.ok(system?.visible, 'the selected article retains its planetary system');
      assert.ok(system.getObjectByName('article-star')?.visible, 'the central article-title star remains visible');
      const planets = system.children.filter(object => object.userData.celestialType === 'planet');
      assert.equal(planets.length, 5, 'retain every real paragraph planet, including paragraphs on another label page');
      assert.deepEqual(planets.map(planet => planet.visible), [true, true, true, true, false],
        'only the four paragraphs on the current desktop page have visible planets');
      assert.deepEqual(planets.map((_, index) => system.getObjectByName(`planet-orbit-${index}`)?.visible),
        [true, true, true, true, false], 'hidden paragraph pages must not leave empty decorative orbits');
      assert.ok(system.position.distanceTo(otherQuestionStars[0].position) < 0.01,
        'the article system grows from its actual answer star');

      props.depth = 1;
      step(500);
      assert.deepEqual(visibleAnswers(), otherQuestionStars, 'reverse zoom restores the same answer actors');
      assert.equal(system.visible, false, 'paragraph planets disappear when their article is exited');
      props.selectedQuestionId = 'lifecycle:question';
      props.selectedAnswerId = '101';
      step(600);
      assert.deepEqual(visibleAnswers(), firstQuestionStars, 'switching back restores the original question answers');
      assert.ok(otherQuestionStars.every(star => !star.visible));
      props.depth = 0;
      props.selectedAnswerId = null;
      step(700);
      assert.deepEqual(visibleAnswers(), [], 'returning to overview leaves only the question galaxies');
      assert.equal(system.visible, false);
    });
    step(1000);
    assert.ok(renderedScene);
    const transition = renderedScene.getObjectByName('knowledge-search-transition');
    assert.ok(transition, 'the actual component must own the transition in its existing scene');
    const resources = new Set<THREE.BufferGeometry | THREE.Material>();
    transition.traverse(object => {
      if (!(object instanceof THREE.Points || object instanceof THREE.Mesh)) return;
      resources.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) resources.add(material);
    });
    assert.ok(resources.size > 0, 'capture actual resources, including shared plane geometry');
    let releases = 0;
    resources.forEach(resource => resource.addEventListener('dispose', () => releases++));
    props.voyage = { id: 1, phase: 'collapse', startedAt: 1000 };
    step(1200);
    const dust = transition.getObjectByName('tidal-stellar-fragments') as THREE.Points;
    const attribute = dust.geometry.getAttribute('position') as THREE.BufferAttribute;
    const version = attribute.version;
    assert.equal(transition.visible, true);

    for (let cycle = 0; cycle < 3; cycle++) {
      document.hidden = true; document.dispatchEvent(new Event('visibilitychange'));
      assert.equal(frames.size, 0, 'hidden tabs must stop the animation loop');
      assert.equal(releases, 0, 'hiding a live scene must not dispose its transition');
      assert.equal(transition.parent, renderedScene);
      document.hidden = false; document.dispatchEvent(new Event('visibilitychange'));
      step(1300 + cycle * 100);
    }
    assert.ok(attribute.version > version, 'the restored transition must keep uploading animated fragments');
    assert.equal(transition.children.length, 4);

    const lost = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(lost);
    assert.equal(lost.defaultPrevented, true, 'the browser must be allowed to restore its WebGL context');
    assert.equal(frames.size, 0);
    assert.equal(releases, 0);
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    step(1700);
    assert.equal(transition.visible, true);
    assert.equal(releases, 0);

    props.reducedMotion = true; props.voyage = null;
    step(1800);
    assert.equal(transition.visible, false);
    assert.equal(releases, 0, 'turning off motion retains reusable resources');
    while (cleanups.length) cleanups.pop()!();
    assert.equal(releases, resources.size, 'final cleanup releases each resource exactly once');
    assert.equal(transition.parent, null);
    assert.equal(transition.children.length, 0);
    assert.equal(rendererDisposals, 1);
    assert.equal(observerDisconnections, 1);
    assert.equal(frames.size, 0);
    const before = renders;
    document.dispatchEvent(new Event('visibilitychange'));
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    assert.equal(frames.size, 0, 'unmounted scene listeners cannot restart rendering');
    assert.equal(renders, before);
  } finally {
    while (cleanups.length) cleanups.pop()!();
    for (const [name, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
