import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { register } from 'tsx/esm/api'

// This process never imports the production server entry or dotenv. Removing
// these names without reading their values also disables optional model calls.
for (const name of ['ZHIHU_ACCESS_SECRET', 'ZHIHU_MODEL_ENABLED', 'MODEL_BASE_URL', 'MODEL_NAME', 'MODEL_API_KEY']) delete process.env[name]

const output = resolve('artifacts/galaxy-connection')
await mkdir(output, { recursive: true })
const runtime = await mkdtemp(join(output, '.runtime-'))
const loader = register({ namespace: `galaxy-connection-${process.pid}` })
const originalGlobals = new Map(['window', 'document', 'CustomEvent', 'Element', '__galaxyConnectionHarness'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
const originalFetch = globalThis.fetch
const report = { checks: [], boundaries: 'No browser: real page callbacks/effects with visual children mocked; real Express HTTP and bundled public corpus.', outboundRequests: 0 }
const check = message => { report.checks.push(message); console.log('PASS', message) }
const legacyKeys = ['seed', 'visitedWords', 'trail', 'backpack', 'links', 'anchors', 'nodes', 'journeys']
const legacyState = {
  seed: { text: '旧旅程测试主题', words: ['文学'] }, visitedWords: ['文学'], trail: [{ position: [1, 2, 3], word: '文学' }],
  backpack: [{ workId: 'legacy-test', title: '旧收藏' }], links: [{ from: '旧起点', to: '文学' }],
  anchors: [{ id: 'old-anchor', text: '旧锚点' }], nodes: [{ id: 'old-node', position: [1, 0, 2] }],
  journeys: [{ id: 'old-journey', title: '原有旅程' }], qualityMode: 'fine',
}
const oldRaw = JSON.stringify({ state: legacyState, version: 0 })
const values = new Map([
  ['wanderwise-game-v1', oldRaw], ['wanderwise-garden-recipes-v1', '[{"first":"literature","second":"music","firstPercent":60}]'],
])
const originalOtherStorage = new Map(values), writes = []
const memoryStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => { writes.push(key); values.set(key, String(value)) },
  removeItem: key => { writes.push(key); values.delete(key) },
  clear: () => { writes.push('*'); values.clear() },
  key: index => [...values.keys()][index] ?? null,
  get length() { return values.size },
}
class LocalCustomEvent extends Event {
  constructor(type, options = {}) { super(type, options); this.detail = options.detail }
}
function replaceGlobal(name, value) { Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }) }
function host({ locationState = null, returnAnchor = null, sources = {}, journeys = [] } = {}) {
  const navigations = [], assignments = [], effects = [], refs = []
  const journeyUpdates = [], returnAnchors = []
  const personalState = { ready: true, error: '', data: { returnAnchor, sources, journeys, galaxyVoyages: [], poses: {}, collections: [], notes: [], works: [], interests: [], settings: { muted: true, mascotAnimated: true, mascotHints: true } } }
  personalState.setReturn = anchor => { personalState.data.returnAnchor = anchor; returnAnchors.push(structuredClone(anchor)) }
  personalState.updateJourney = (id, patch) => {
    journeyUpdates.push({ id, patch: structuredClone(patch) })
    personalState.data.journeys = personalState.data.journeys.map(journey => journey.id === id ? { ...journey, progress: { ...journey.progress, ...patch } } : journey)
  }
  personalState.putSource = source => { personalState.data.sources[source.id] = source; return source.id }
  personalState.savePose = (key, pose) => { personalState.data.poses[key] = pose }
  const gameState = structuredClone(legacyState)
  let panelClosures = 0, pointerReleases = 0
  gameState.panel = 'settings'
  gameState.closePanel = () => { gameState.panel = null; panelClosures++ }
  const sessionValues = new Map()
  const window = Object.assign(new EventTarget(), {
    localStorage: memoryStorage,
    sessionStorage: { getItem: key => sessionValues.get(key) ?? null, setItem: (key, value) => sessionValues.set(key, String(value)), removeItem: key => sessionValues.delete(key) },
    performance: { getEntriesByType: () => [{ type: 'navigate' }] },
    location: { origin: 'https://galaxy.test', href: 'https://galaxy.test/galaxy', search: '', assign: url => assignments.push(url) },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  })
  const document = { title: 'Cabin integration test', pointerLockElement: {}, exitPointerLock() { this.pointerLockElement = null; pointerReleases++ } }
  const harness = { effects, refs, gameState, personalState, journeyUpdates, returnAnchors, sessionValues, location: { state: locationState, key: 'entry-one' },
    navigate: (...args) => navigations.push(args), navigations, assignments,
    get panelClosures() { return panelClosures }, get pointerReleases() { return pointerReleases } }
  replaceGlobal('window', window); replaceGlobal('document', document); replaceGlobal('CustomEvent', LocalCustomEvent)
  replaceGlobal('__galaxyConnectionHarness', harness)
  return harness
}
function verifyLegacyStorage() {
  for (const [key, raw] of originalOtherStorage) assert.equal(values.get(key), raw, `${key} must remain byte-for-byte unchanged`)
  const persisted = JSON.parse(values.get('wanderwise-game-v1')).state
  for (const key of legacyKeys) assert.deepEqual(persisted[key], legacyState[key], `old ${key} must survive galaxy operations`)
  assert.ok(writes.every(key => ['wanderwise.collection.v1', 'wanderwise.reflections.v1', 'wanderwise.journey.v1'].includes(key)), 'galaxy persistence may write only its three namespaced keys')
}

// Compile the actual host components, replacing only React scheduling, router
// navigation and heavy visual children. The tested callbacks/effects are not
// copied or reimplemented in the harness.
async function componentModule(path, realDependencies = []) {
  const source = await readFile(path, 'utf8')
  const icons = source.match(/import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/)?.[1].split(',').map(name => name.trim()).filter(Boolean) ?? []
  const mocks = {
    react: `const h=()=>globalThis.__galaxyConnectionHarness;
      export const useEffect=(effect,deps)=>h().hooks?h().hooks.effect(effect,deps):h().effects.push(effect),useLayoutEffect=useEffect;
      export const useCallback=(fn,deps)=>h().hooks?h().hooks.memo(()=>fn,deps):fn;
      export const useMemo=(fn,deps)=>h().hooks?h().hooks.memo(fn,deps):fn();
      export const useRef=(value)=>{if(h().hooks)return h().hooks.ref(value);const ref={current:value};h().refs.push(ref);return ref};
      export const useState=(value)=>h().hooks?h().hooks.state(value):[typeof value==='function'?value():value,()=>{}];
      export const Suspense='Suspense',Fragment='Fragment';
      export const lazy=(load)=>({galaxyTestLazy:true,load});`,
    'react/jsx-runtime': `export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment='Fragment';`,
    'react-router': `export const useNavigate=()=>globalThis.__galaxyConnectionHarness.navigate;
      export const useLocation=()=>globalThis.__galaxyConnectionHarness.location;
      export const Routes='Routes',Route='Route',Navigate='Navigate';`,
    '@react-three/fiber': `export const Canvas='Canvas';`,
    '@react-three/drei': `export const useProgress=(fn)=>fn({progress:100});`,
    'lucide-react': icons.map(name => `export const ${name}=${JSON.stringify(name)};`).join('\n'),
    three: `export const ACESFilmicToneMapping=4;`,
    '@/state/gameStore': `export const useGameStore=(selector)=>selector(globalThis.__galaxyConnectionHarness.gameState);
      useGameStore.getState=()=>globalThis.__galaxyConnectionHarness.gameState;
      export const getQualityProfile=()=>({dprMax:1,shadowMapSize:1024,postprocessing:false});`,
    '@/components/observatory/layout': `export const OBSERVATORY_SPAWN=[3.65,1.7,7.15];`,
    '@/components/observatory/CollectionTreeScene': `export default '@/components/observatory/CollectionTreeScene';
      export const TOPICS_PER_PAGE=6,LEAVES_PER_PAGE=4;`,
    '@/features/personal/collectionTreeReading': `export const collectionTreeReading=()=>{throw new Error('Unexpected collection-tree reading in galaxy navigation test')};`,
  }
  const personalStore = `export const usePersonalStore=selector=>selector(globalThis.__galaxyConnectionHarness.personalState);
    usePersonalStore.getState=()=>globalThis.__galaxyConnectionHarness.personalState;
    export const initializePersonalSpace=async()=>{};`
  for (const name of ['@/features/personal/store', '../personal/store', '../../personal/store', './features/personal/store']) mocks[name] = personalStore
  mocks['./features/personal/legacyBridge'] = 'export const connectLegacyInventory=()=>()=>{};'
  mocks['./features/personal/galaxyVoyages'] = 'export const connectGalaxyVoyageInbox=()=>()=>{};'
  mocks['@/features/personal/api'] = 'export const api=()=>{throw new Error("Unexpected API call from host callback test")};'
  // Existing legacy-persistence assertions intentionally exercise the fallback
  // adapter. Only the shared adapter is mocked for these host callbacks; the
  // storage checks below still import and execute the real storage module.
  mocks['../../personal/galaxyBridge'] = `export const sharedCollection=()=>undefined,sharedReflections=()=>undefined,sharedGalaxyJourney=()=>undefined;
    export const saveSharedCollection=()=>{},saveSharedReflections=()=>{},saveSharedGalaxyJourney=()=>{};`
  const compiled = await build({
    entryPoints: [path], bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic',
    plugins: [{ name: 'galaxy-host-boundaries', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => args.kind === 'entry-point' || realDependencies.includes(args.path) ? undefined : { path: args.path, namespace: 'host-boundary' })
      builder.onLoad({ filter: /.*/, namespace: 'host-boundary' }, args => ({ contents: mocks[args.path] ?? (args.path.endsWith('.css') ? '' : `const Boundary=${JSON.stringify(args.path)};export default Boundary;export const Toast=Boundary;`), loader: 'js' }))
    } }],
  })
  return import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`)
}
function elements(tree) {
  if (Array.isArray(tree)) return tree.flatMap(elements)
  if (!tree || typeof tree !== 'object' || !('props' in tree)) return []
  return [tree, ...elements(tree.props?.children)]
}

// A small hook scheduler keeps state changes driven by the real page's controls.
// It does not reach into numbered state slots or reimplement its return logic.
function interactiveComponent(harness, component) {
  const slots = []
  let cursor = 0, pending = [], tree, updates = 0
  const slot = () => slots[cursor++] ?? (slots[cursor - 1] = {})
  const same = (previous, next) => !!previous && !!next && previous.length === next.length && next.every((value, index) => Object.is(value, previous[index]))
  harness.hooks = {
    state(initial) {
      const item = slot()
      if (!('value' in item)) item.value = typeof initial === 'function' ? initial() : initial
      return [item.value, value => { updates++; item.value = typeof value === 'function' ? value(item.value) : value }]
    },
    ref(initial) { const item = slot(); return item.ref ??= { current: initial } },
    memo(factory, deps) { const item = slot(); if (!same(item.deps, deps)) { item.value = factory(); item.deps = deps } return item.value },
    effect(effect, deps) {
      const item = slot()
      if (!same(item.deps, deps)) pending.push(() => { item.cleanup?.(); item.deps = deps; item.cleanup = effect() })
    },
  }
  return {
    render() { cursor = 0; pending = []; tree = component(); pending.forEach(run => run()); return tree },
    get tree() { return tree },
    get updates() { return updates },
    dispose() { slots.toReversed().forEach(item => item.cleanup?.()); delete harness.hooks },
  }
}

let server
try {
  const [{ createApp }, { ZhihuService, loadSnapshot, plainText }, storage, integration] = await Promise.all([
    loader.import('../server/galaxy/app.ts', import.meta.url),
    loader.import('../server/galaxy/zhihu.ts', import.meta.url),
    loader.import('../src/features/galaxy/lib/storage.ts', import.meta.url),
    loader.import('../src/features/galaxy/lib/integration.ts', import.meta.url),
  ])
  const [observatory, galaxy, app] = await Promise.all([
    componentModule('src/pages/ObservatoryPage.tsx', ['@/components/observatory/gardenRecipes', '@/features/personal/collectionTree', '../../components/observatory/gardenRecipes']), componentModule('src/features/galaxy/index.tsx', ['./lib/trip']), componentModule('src/App.tsx'),
  ])
  for (const seed of [null, structuredClone(legacyState.seed)]) {
    const h = host(); h.gameState.seed = seed
    const before = Object.fromEntries(legacyKeys.map(key => [key, structuredClone(h.gameState[key])]))
    const tree = observatory.default()
    const scene = elements(tree).find(element => String(element.type).endsWith('/ObservatoryScene'))
    const rig = elements(tree).find(element => String(element.type).endsWith('/ObservatoryRig'))
    assert.ok(scene && rig, 'the real 3D scene and movement rig must expose the star-gate callback')
    assert.equal(scene.props.onEnterWorld, rig.props.onEnterWorld, 'click and E must use the same actual navigation callback')
    const controller = h.refs.find(ref => ref.current?.keys instanceof Set).current
    controller.keys.add('KeyW')
    scene.props.onEnterWorld()
    assert.deepEqual(h.navigations, [['/galaxy', { state: { wanderwiseEntry: true } }]], `seed=${Boolean(seed)} must enter the new galaxy, never old onboarding/world`)
    assert.deepEqual(h.returnAnchors, [{ route: '/observatory', label: '观星台', pose: undefined }], 'the actual gate must explicitly register its host-owned return destination')
    assert.equal(controller.active, false); assert.equal(controller.keys.size, 0)
    assert.equal(h.pointerReleases, 1); assert.equal(h.panelClosures, 1)
    for (const key of legacyKeys) assert.deepEqual(h.gameState[key], before[key], `gate transition must not mutate old ${key}`)
  }
  host()
  const registeredRoutes = elements(app.default()).filter(element => element.type === 'Route')
  for (const [path, destination] of [['/', '/home'], ['/world', '/land']]) {
    const redirect = registeredRoutes.find(element => element.props.path === path)?.props.element
    assert.equal(redirect?.type, 'Navigate')
    assert.equal(redirect.props.to, destination)
    assert.equal(redirect.props.replace, true, 'retired generator URLs cannot trap browser Back')
  }
  for (const [path, target] of [['/galaxy', './features/galaxy'], ['/land', './features/journeys/LandPage'], ['/journey/:realmId', './features/journeys/JourneyPage']]) {
    const route = registeredRoutes.find(element => element.props.path === path)
    assert.ok(route, `main app must register ${path}`)
    const lazyElement = elements(route.props.element).find(element => element.type?.galaxyTestLazy)
    assert.ok(lazyElement, `${path} must remain lazy to avoid loading its scene on cabin entry`)
    assert.equal((await lazyElement.type.load()).default, target)
  }
  check('Actual star-gate callback enters lazy /galaxy with or without a seed, releases controls, closes the panel and preserves all eight old fields')

  const h = host(), originalTitle = document.title
  galaxy.default()
  const cleanup = h.effects.map(effect => effect()).filter(value => typeof value === 'function')
  const summary = { collection: [], reflections: [], journey: [] }
  assert.equal(integration.returnToObservatory({ query: '', returnUrl: '/observatory' }, summary), true)
  const defaultReturn = ['/observatory', { state: { stationId: undefined } }]
  assert.deepEqual(h.navigations, [defaultReturn]); assert.deepEqual(h.assignments, [])
  for (const returnUrl of ['https://evil.test/exit', '//evil.test/exit', 'javascript:alert(1)', '/\\evil.test', '/.//evil.test']) {
    assert.equal(integration.returnToObservatory({ query: '测试', returnUrl }), true)
    assert.deepEqual(h.navigations.at(-1), defaultReturn)
  }
  assert.deepEqual(h.assignments, [], 'host-cancelled returns must never assign an external or full-page URL')
  const previousCount = h.navigations.length
  window.dispatchEvent(new Event('wanderwise:return', { cancelable: true }))
  window.dispatchEvent(new CustomEvent('wanderwise:return'))
  assert.equal(h.navigations.length, previousCount, 'non-custom or non-cancelable events must not navigate')
  cleanup.reverse().forEach(dispose => dispose())
  assert.equal(document.title, originalTitle)
  window.dispatchEvent(new CustomEvent('wanderwise:return', { cancelable: true }))
  assert.equal(h.navigations.length, previousCount, 'unmounted host must remove its return handler')
  assert.equal(integration.returnToObservatory({ query: '', returnUrl: 'https://evil.test' }), false)
  assert.deepEqual(h.assignments, [])
  check('Actual GalaxyPage cancels safe return events for router navigation, rejects unsafe fallback URLs and removes its listener/title on exit')

  const sourceA = { id: 'url:https://example.test/first', title: '同一场落日的两种观察', summary: '隔离来源摘要', source: 'test', url: 'https://example.test/first' }
  const sourceB = { id: 'url:https://example.test/second', title: '从构图到叙事', summary: '另一份隔离摘要', source: 'test', url: 'https://example.test/second' }
  const pose = { position: [3.2, 0.4, -8.1], yaw: 1.27, pitch: -0.09 }
  const tripId = 'return-trip/with spaces?&'
  const trip = { id: tripId, realmId: 'sunset-boulevard', sourceIds: [sourceA.id, sourceB.id, sourceA.id], progress: { visited: ['turning-point'], drafts: { caption: '尚未写完的旅程作品' }, completed: false } }
  const anchors = [
    { route: '/journey/sunset-boulevard', label: '落日大道', journeyId: tripId, stationId: 'turning-point', pose, sourceId: sourceB.id },
    { route: '/land', label: '镜海群岛', stationId: 'lake', pose, sourceId: sourceA.id },
  ]
  for (const anchor of anchors) {
    const h = host({ locationState: { wanderwiseEntry: true }, returnAnchor: anchor, sources: { [sourceA.id]: sourceA, [sourceB.id]: sourceB }, journeys: [structuredClone(trip)] })
    const tree = galaxy.default()
    const child = elements(tree).find(element => element.type === './App')
    assert.ok(child, 'actual host must render the GalaxyExplorer')
    assert.equal(child.props.returnLabel, `返回${anchor.label}`, 'host return label must name the actual incoming scene')
    assert.deepEqual(child.props.entrySources.map(source => source.id), anchor.journeyId ? [sourceB.id, sourceA.id] : [sourceA.id], 'clicked source comes first; trip sources are retained and de-duplicated')
    const dispose = h.effects.map(effect => effect()).filter(value => typeof value === 'function')
    const snapshot = structuredClone(h.personalState.data.journeys[0].progress)
    const event = new CustomEvent('wanderwise:return', { cancelable: true, detail: { returnUrl: 'https://evil.test/ignore-me', stationId: 'untrusted' } })
    window.dispatchEvent(event)
    assert.equal(event.defaultPrevented, true)
    assert.equal(h.navigations.length, 1, 'one return event must produce exactly one host navigation')
    if (anchor.journeyId) {
      assert.deepEqual(h.navigations[0], [`${anchor.route}?trip=${encodeURIComponent(tripId)}`], 'trip ID must survive URL encoding and return to the same journey instance')
      assert.deepEqual(h.journeyUpdates, [{ id: tripId, patch: { pose, activeStation: anchor.stationId } }])
      assert.deepEqual(h.personalState.data.journeys[0].progress, { ...snapshot, pose, activeStation: anchor.stationId }, 'return must restore the view/station without erasing drafts, visits or completion')
    } else {
      assert.deepEqual(h.navigations[0], ['/land', { state: { stationId: 'lake' } }], 'land return must restore the originating notebook station')
      assert.deepEqual(h.journeyUpdates, [], 'land return must not mutate an unrelated journey')
      assert.deepEqual(h.personalState.data.returnAnchor.pose, pose, 'saved land viewpoint remains available on return')
    }
    assert.deepEqual(h.assignments, [], 'scene returns must use the router and ignore event-supplied destinations')
    dispose.reverse().forEach(cleanup => cleanup())
    window.dispatchEvent(new CustomEvent('wanderwise:return', { cancelable: true }))
    assert.equal(h.navigations.length, 1, 'a departed host must not act on late return events')
    verifyLegacyStorage()
  }
  check('Actual GalaxyPage restores journey trip/station/pose and land station, preserves drafts and visit progress, passes de-duplicated entry sources and ignores event-supplied destinations')

  for (const locationState of [null, {}, { wanderwiseEntry: false }]) {
    const direct = host({ locationState, returnAnchor: anchors[0], sources: { [sourceA.id]: sourceA }, journeys: [structuredClone(trip)] })
    const tree = galaxy.default()
    const child = elements(tree).find(element => element.type === './App')
    assert.equal(child.props.returnLabel, '返回观星台')
    assert.deepEqual(child.props.entrySources, [], 'direct galaxy opening must not reuse a stale personal trip or inject its reading materials')
    const dispose = direct.effects.map(effect => effect()).filter(value => typeof value === 'function')
    integration.returnToObservatory({ query: '', returnUrl: '/observatory' })
    assert.deepEqual(direct.navigations, [defaultReturn], 'opening /galaxy directly defaults to observatory even with an old journey anchor')
    assert.deepEqual(direct.journeyUpdates, [], 'a direct visit may not mutate a stale trip')
    dispose.reverse().forEach(cleanup => cleanup())
  }
  check('Direct /galaxy visits ignore stale return anchors and default to observatory; all three new feature routes are genuinely lazy')

  const sessionHost = host()
  const routedGalaxy = interactiveComponent(sessionHost, galaxy.default)
  routedGalaxy.render()
  const tripKey = 'wanderwise.trip-session.v1'
  const firstSession = JSON.parse(sessionHost.sessionValues.get(tripKey))
  sessionHost.location.state = { wanderwiseEntry: true }
  routedGalaxy.render()
  assert.equal(JSON.parse(sessionHost.sessionValues.get(tripKey)).id, firstSession.id, 'a render or search state update within the same Router entry must retain its session')
  sessionHost.location.key = 'entry-two'
  routedGalaxy.render()
  const nextSession = JSON.parse(sessionHost.sessionValues.get(tripKey))
  assert.notEqual(nextSession.id, firstSession.id, 'a new SPA route entry must start a fresh session')
  assert.deepEqual(nextSession.journey, [])
  const exported = { version: 1, tripId: 'deliberate-export', query: '单次足迹', startedAt: '2026-09-14T00:00:00.000Z', endedAt: '2026-09-14T00:10:00.000Z', journey: [] }
  integration.returnToObservatory({ query: '', returnUrl: '/observatory' }, { trip: exported })
  assert.deepEqual(sessionHost.navigations.at(-1), ['/observatory', { state: { stationId: undefined, galaxyTripId: exported.tripId } }])
  assert.deepEqual(sessionHost.personalState.data.galaxyVoyages, [], 'return navigation alone must not import history; the durable global inbox owns receipt')
  routedGalaxy.dispose()
  check('New SPA entry keys create separate trips; rerender/search keeps the same trip and only an explicit export marks the return log shortcut')

  const received = [], previousBridge = { enter() {}, hostVersion: 'integration-test' }
  window.Wanderwise = previousBridge
  const removeBridge = integration.registerObservatoryEntry(entry => received.push(entry))
  const post = (origin, payload) => {
    const event = new Event('message'); Object.defineProperties(event, { origin: { value: origin }, data: { value: { type: 'wanderwise:enter', payload } } }); window.dispatchEvent(event)
  }
  post('https://evil.test', { query: 'untrusted' }); post('null', { query: 'untrusted' })
  post(window.location.origin, { query: '  公开\u0000主题  ', returnUrl: 'https://evil.test' })
  assert.deepEqual(received, [{ query: '公开 主题' }])
  removeBridge(); assert.equal(window.Wanderwise, previousBridge)
  window.dispatchEvent(new CustomEvent('wanderwise:enter', { detail: { query: 'after cleanup' } }))
  assert.equal(received.length, 1)
  check('Upstream entry bridge accepts only same-origin messages, normalizes queries and restores the prior bridge')

  const snapshot = await loadSnapshot()
  assert.ok(snapshot.items.length > 0 && Object.keys(snapshot.details).length > 0, 'the migrated server must load its bundled real public corpus at its actual module path')
  const service = new ZhihuService({ snapshot, secret: '', fetchImpl: async () => { report.outboundRequests++; throw new Error('Integration tests prohibit external calls') } })
  const marker = '<!doctype html><title>isolated galaxy integration</title><div id="root"></div>'
  await mkdir(join(runtime, 'assets'))
  // The real public/galaxy directory shares its name with the SPA route. Its
  // presence must not make express.static redirect /galaxy to /galaxy/.
  await mkdir(join(runtime, 'galaxy'))
  const galaxyAsset = Buffer.from([0x47, 0x41, 0x4c, 0x41, 0x58, 0x59, 0x00, 0xff, 0x19])
  await writeFile(join(runtime, 'index.html'), marker)
  await writeFile(join(runtime, 'assets/probe.js'), 'export const isolated = true;')
  await writeFile(join(runtime, 'galaxy/fixture-asset.bin'), galaxyAsset)
  server = createApp(service, { distDir: runtime, refreshPublic: false }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  globalThis.fetch = (input, init) => {
    if (new URL(typeof input === 'string' ? input : input.url ?? input.href).origin !== origin) { report.outboundRequests++; throw new Error('External fetch disabled in integration tests') }
    return originalFetch(input, init)
  }
  async function json(path, status = 200) {
    const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(5000) })
    assert.equal(response.status, status, `${path} HTTP status`)
    assert.match(response.headers.get('content-type') ?? '', /application\/json/)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    return response.json()
  }
  const health = await json('/api/health')
  assert.equal(health.ok, true); assert.equal(health.configured, false); assert.equal(health.model.configured, false)
  assert.equal(health.publicCount, snapshot.items.length)
  await json('/api/explore?q=', 503)
  const discovery = await json('/api/explore?q=&mode=public')
  assert.equal(discovery.query, ''); assert.equal(discovery.source, 'zhihu-cache')
  assert.ok(discovery.questions.length > 0, 'explicit public mode must still show verified topics without credentials; default hot entry must not silently replace hot questions')
  const corpusIds = new Set(snapshot.items.map(item => item.work_id)), answers = []
  for (const topic of discovery.questions) {
    assert.equal(topic.kind, 'topic', 'public collections must not be misrepresented as one real Zhihu question')
    const detail = await json(`/api/questions/${encodeURIComponent(topic.id)}?q=`)
    assert.equal(detail.question.id, topic.id); assert.equal(detail.question.answersExpanded, true)
    for (const answer of detail.question.answers) {
      assert.ok(corpusIds.has(answer.workId), 'every displayed article must be backed by the bundled snapshot')
      const work = await json(`/api/knowledge/${answer.workId}`)
      assert.equal(work.id, answer.id); assert.deepEqual(work.paragraphs, answer.paragraphs)
      assert.ok(work.paragraphs.length > 0); assert.ok(work.author.trim()); assert.ok(work.title.trim())
      const raw = snapshot.details[answer.workId]
      const source = plainText([raw.content, raw.introduction].filter(Boolean).join('\n'))
      for (const paragraph of work.paragraphs) assert.ok(paragraph.trim() && source.includes(paragraph), 'article paragraphs must remain exact source spans')
      answers.push({ ...work, questionId: topic.id })
    }
  }
  assert.ok(answers.length > 0)
  const answer = answers.find(item => item.paragraphs.some(paragraph => paragraph.length >= 24))
  assert.ok(answer, 'public corpus must provide a meaningful article for excerpt testing')
  const highlights = await json(`/api/answers/${encodeURIComponent(answer.id)}/highlights?questionId=${encodeURIComponent(answer.questionId)}&q=`)
  assert.equal(highlights.answerId, answer.id); assert.equal(highlights.method, 'extractive'); assert.ok(highlights.highlights.length > 0)
  for (const item of highlights.highlights) assert.ok(answer.paragraphs[item.paragraphIndex]?.includes(item.text), 'every highlighted excerpt must point to its exact source paragraph')
  assert.deepEqual((await json('/api/explore?q=integration-unmatched-9c4e')).questions, [], 'unmatched public searches must not invent content')
  assert.equal((await json('/api/explore?q=a&q=b', 400)).error, 'INVALID_QUERY')
  assert.equal((await json('/api/explore?q=%00', 400)).error, 'INVALID_QUERY')
  assert.equal((await json('/api/knowledge/invalid-id', 400)).error, 'INVALID_WORK_ID')
  assert.equal((await json('/api/knowledge/999999999999999999999999999999', 404)).error, 'KNOWLEDGE_NOT_FOUND')
  assert.equal((await json('/api/not-a-real-endpoint', 404)).error, 'NOT_FOUND')
  const spaPaths = ['/', '/home', '/observatory', '/galaxy', '/world', '/canvas', '/land', '/journey/sunset-boulevard', '/journey/echo-paradox?trip=reload-check']
  for (const path of spaPaths) {
    const response = await fetch(origin + path, { redirect: 'manual' })
    assert.equal(response.status, 200, `${path} must serve the SPA directly even when a same-name asset directory exists`)
    assert.equal(response.headers.get('location'), null, `${path} must not redirect to a trailing slash`)
    assert.equal(await response.text(), marker)
  }
  const staticFile = await fetch(origin + '/assets/probe.js')
  assert.equal(staticFile.status, 200); assert.equal(await staticFile.text(), 'export const isolated = true;')
  const nestedAsset = await fetch(origin + '/galaxy/fixture-asset.bin', { redirect: 'manual' })
  assert.equal(nestedAsset.status, 200); assert.equal(nestedAsset.headers.get('location'), null)
  assert.match(nestedAsset.headers.get('content-type') ?? '', /application\/octet-stream/)
  assert.deepEqual(Buffer.from(await nestedAsset.arrayBuffer()), galaxyAsset, '/galaxy assets must retain their exact bytes instead of receiving SPA HTML')
  for (const path of ['/assets/missing.glb', '/galaxy/missing-asset.bin', '/unregistered-page']) {
    const response = await fetch(origin + path, { redirect: 'manual' })
    assert.equal(response.status, 404, `${path}: missing resources must not silently receive SPA HTML`)
  }
  assert.equal(report.outboundRequests, 0)
  report.publicCorpus = { works: snapshot.items.length, topics: discovery.questions.length, inspectedArticles: answers.length, excerptCount: highlights.highlights.length }
  check(`Real local HTTP: ${discovery.questions.length} public topics / ${answers.length} articles, exact paragraphs/highlights, errors and ${spaPaths.length} direct SPA URLs including land/journey reloads; same-name /galaxy directory does not redirect, asset bytes stay intact and missing assets return 404; no external requests`)

  const explorer = await componentModule('src/features/galaxy/App.tsx', ['./lib/integration', './lib/storage', './lib/search-voyage', './lib/trip', './trip', './lib/useJourneyExitGuard', './lib/useWormhole', './wormhole'])
  const returnHarness = host(), returnTitle = document.title
  // Event targets stand in for DOM inputs; the keyboard handler itself is the
  // actual component effect. Modal state is entered through its real controls.
  class InputTarget {
    constructor(selector) { this.selector = selector }
    closest(selectors) { return selectors.split(',').some(selector => selector.trim() === this.selector) ? this : null }
  }
  replaceGlobal('Element', InputTarget)
  replaceGlobal('document', Object.assign(new EventTarget(), { title: returnTitle, fullscreenElement: null }))
  Object.assign(window, { setTimeout, clearTimeout })
  galaxy.default()
  const disposeReturnHost = returnHarness.effects.map(effect => effect()).filter(value => typeof value === 'function')
  const componentFetch = globalThis.fetch
  const pageData = { ...discovery, questions: discovery.questions.map(question => ({
    ...question, answersExpanded: true,
    answers: question.answers.map(item => answers.find(detail => detail.id === item.id) ?? item),
  })) }
  globalThis.fetch = async input => new Response(JSON.stringify(String(input).startsWith('/api/explore') ? pageData
    : String(input) === '/api/health' ? health
      : { answerId: answer.id, highlights: [], method: 'extractive' }), { status: 200, headers: { 'content-type': 'application/json' } })
  const interactive = interactiveComponent(returnHarness, explorer.default)
  const findButton = label => {
    const button = elements(interactive.tree).find(element => element.type === 'button' && element.props['aria-label'] === label)
    assert.ok(button, `actual GalaxyExplorer must render ${label}`)
    return button
  }
  const keyboard = (properties = {}) => {
    const event = new Event('keydown', { cancelable: true })
    for (const [name, value] of Object.entries({ key: 'h', repeat: false, isComposing: false, ...properties }))
      Object.defineProperty(event, name, { value, configurable: true })
    window.dispatchEvent(event)
    return event
  }
  const expectBlockedReturn = (properties, reason) => {
    const before = returnHarness.navigations.length
    const event = keyboard(properties)
    assert.equal(returnHarness.navigations.length, before, reason)
    assert.equal(event.defaultPrevented, false, `${reason}: leave the key available to its original context`)
  }
  const expectReturn = (properties = {}) => {
    const before = returnHarness.navigations.length
    assert.equal(keyboard(properties).defaultPrevented, true)
    if (returnHarness.navigations.length === before) {
      interactive.render()
      assert.ok(elements(interactive.tree).some(element => element.props.title === '是否导出漫游足迹'), 'a dirty trip must offer the export choice before navigating')
      const discard = elements(interactive.tree).find(element => element.type === 'button' && element.props.children === '不导出，返回观星台')
      assert.ok(discard, 'the user can return without authorizing an export')
      discard.props.onClick()
      interactive.render()
    }
    assert.equal(returnHarness.navigations.length, before + 1, 'one confirmed return must produce exactly one router transition')
    assert.deepEqual(returnHarness.navigations.at(-1), defaultReturn)
    assert.deepEqual(returnHarness.assignments, [], 'integrated return must not trigger a full-page navigation')
  }
  try {
    interactive.render()
    const returnButton = findButton('返回观星台')
    assert.equal(returnButton.props['aria-keyshortcuts'], 'H')
    assert.ok(elements(returnButton).some(element => element.type === 'span' && element.props.children === '返回观星台'), 'return destination must have visible text, not only an icon or tooltip')
    returnButton.props.onClick()
    assert.deepEqual(returnHarness.navigations, [defaultReturn], 'the actual button must reach the integrated observatory route while data is still loading')
    expectReturn()
    expectReturn({ key: 'H' })
    for (const selector of ['input', 'textarea', 'select', '[contenteditable="true"]'])
      expectBlockedReturn({ target: new InputTarget(selector) }, `typing in ${selector} must not leave the galaxy`)
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'repeat', 'isComposing'])
      expectBlockedReturn({ [modifier]: true }, `${modifier} must not trigger a return`)

    // Settle only the mocked corpus responses; no user browser or external API.
    for (let pass = 0; pass < 3; pass++) { await new Promise(resolveTick => setImmediate(resolveTick)); interactive.render() }
    for (const label of ['知识行囊', '探索足迹']) {
      findButton(label).props.onClick(); interactive.render()
      assert.equal(elements(interactive.tree).find(element => element.props.className === 'interface').props.inert, true)
      expectBlockedReturn({}, `${label} must keep its modal keyboard focus`)
      keyboard({ key: 'Escape' }); interactive.render()
      expectReturn()
    }
    elements(interactive.tree).find(element => element.type === './components/GalaxyScene').props.onDepthChange(2)
    interactive.render()
    findButton('打开原文阅览').props.onClick(); interactive.render()
    assert.ok(elements(interactive.tree).some(element => element.type === './components/ReadingRoom'))
    expectBlockedReturn({}, 'H must not interrupt an open article reader')
    keyboard({ key: 'Escape' }); interactive.render()
    expectReturn()
    elements(interactive.tree).find(element => element.type === './components/GalaxyScene').props.onDepthChange(2)
    interactive.render()
    findButton('留下思考').props.onClick(); interactive.render()
    expectBlockedReturn({}, 'H must not interrupt a reflection dialog')
    keyboard({ key: 'Escape' }); interactive.render()
    expectReturn()
  } finally {
    interactive.dispose()
    disposeReturnHost.reverse().forEach(dispose => dispose())
    globalThis.fetch = componentFetch
  }
  const afterReturnUnmount = returnHarness.navigations.length
  keyboard()
  assert.equal(returnHarness.navigations.length, afterReturnUnmount, 'unmount must remove the real keyboard listener')
  verifyLegacyStorage()
  check('Actual GalaxyExplorer return button has visible destination text and H; real click/key callbacks navigate once through the host, protect typing/modifiers/repeat/composition/readers/dialogs and remove keyboard handlers on exit')

  // Drive the real entry bridge and effect cleanup with deliberately late mock
  // responses. Ignoring abort inside this transport verifies the App's own
  // signal guards, rather than relying on a well-behaved fetch implementation.
  const voyageHarness = host()
  replaceGlobal('document', Object.assign(new EventTarget(), { title: 'Search lifecycle test', fullscreenElement: null }))
  Object.assign(window, { setTimeout, clearTimeout })
  const motionMedia = Object.assign(new EventTarget(), { matches: false })
  window.matchMedia = () => motionMedia
  const pendingSearches = [], lifecycleCalls = []
  const lifecycleFetch = globalThis.fetch
  globalThis.fetch = (input, init) => {
    const path = String(input)
    lifecycleCalls.push(path)
    if (path === '/api/health') return Promise.resolve(new Response(JSON.stringify(health)))
    assert.ok(path.startsWith('/api/explore?'), `unexpected lifecycle request: ${path}`)
    return new Promise(resolveResponse => pendingSearches.push({ path, signal: init.signal, resolveResponse }))
  }
  const entrySource = {
    id: `url:${answer.url}`, remoteId: answer.id, title: answer.title,
    author: answer.author, summary: answer.excerpt, source: '知乎',
    kind: 'summary', url: answer.url, tags: ['隔离阅读来源'],
  }
  const entrySources = [entrySource]
  const voyagePage = interactiveComponent(voyageHarness, () => explorer.default({ entrySources }))
  const sceneProps = () => {
    const scene = elements(voyagePage.tree).find(element => element.type === './components/GalaxyScene')
    assert.ok(scene, 'real App must keep its scene mounted during search')
    return scene.props
  }
  const settleVoyage = async () => {
    for (let pass = 0; pass < 3; pass++) { await new Promise(resolveTick => setImmediate(resolveTick)); voyagePage.render() }
  }
  const resultFor = query => ({ ...pageData, query, questions: pageData.questions.map((question, index) => ({ ...question, id: `topic-${query}-${index}` })) })
  let voyageDisposed = false
  try {
    voyagePage.render()
    await settleVoyage()
    assert.deepEqual(lifecycleCalls, ['/api/health'], 'journey entrySources must not perform another explore, expand or highlight request')
    assert.equal(sceneProps().voyage, null, 'source entry must not run a black-hole transition')
    assert.equal(sceneProps().questions[0].answers[0].id, entrySource.remoteId)
    assert.deepEqual(sceneProps().questions[0].answers[0].paragraphs, [entrySource.summary])
    assert.equal(sceneProps().questions[0].answers[0].isExcerpt, true, 'entry summaries must remain explicitly partial source text')
    check('Actual GalaxyExplorer reads entrySources without a new content request or search transition and keeps the original source identity/summary label')

    window.Wanderwise.enter({ query: 'older' })
    voyagePage.render(); voyagePage.render()
    assert.equal(pendingSearches.length, 1)
    assert.equal(sceneProps().voyage.phase, 'collapse')
    assert.equal(sceneProps().questions[0].answers[0].id, entrySource.remoteId, 'old source remains visible while collapsing')
    window.Wanderwise.enter({ query: 'latest' })
    voyagePage.render(); voyagePage.render()
    assert.equal(pendingSearches.length, 2)
    assert.equal(pendingSearches[0].signal.aborted, true, 'a superseded query must abort its request')
    assert.equal(pendingSearches[1].signal.aborted, false)
    pendingSearches[0].resolveResponse(new Response(JSON.stringify(resultFor('older'))))
    await settleVoyage()
    assert.ok(sceneProps().questions.every(question => !question.id.startsWith('topic-older-')), 'late superseded response must not replace the visible scene')

    // Toggling reduced motion mid-collapse must release its completion wait;
    // no clock injection or real animation-duration sleep is necessary.
    motionMedia.matches = true
    motionMedia.dispatchEvent(new Event('change'))
    voyagePage.render(); voyagePage.render()
    pendingSearches[1].resolveResponse(new Response(JSON.stringify(resultFor('latest'))))
    await settleVoyage()
    assert.equal(sceneProps().voyage, null, 'reduced motion must cancel collapse/birth while preserving the result')
    assert.ok(sceneProps().questions.length > 0)
    assert.ok(sceneProps().questions.every(question => question.id.startsWith('topic-latest-')), 'only the latest request may commit its result')

    window.Wanderwise.enter({ query: 'after-exit' })
    voyagePage.render(); voyagePage.render()
    assert.equal(pendingSearches.length, 3)
    voyagePage.dispose(); voyageDisposed = true
    assert.equal(pendingSearches[2].signal.aborted, true, 'leaving the galaxy must abort the active content request')
    const updatesAfterExit = voyagePage.updates
    pendingSearches[2].resolveResponse(new Response(JSON.stringify(resultFor('after-exit'))))
    for (let pass = 0; pass < 3; pass++) await new Promise(resolveTick => setImmediate(resolveTick))
    assert.equal(voyagePage.updates, updatesAfterExit, 'late completion after unmount must not update React state')
    assert.equal(window.Wanderwise, undefined, 'search page unmount must remove its entry bridge')
    check('Actual search effects abort superseded and unmounted requests, ignore late results, keep the departing scene and release collapse immediately when reduced motion is enabled')
  } finally {
    if (!voyageDisposed) voyagePage.dispose()
    globalThis.fetch = lifecycleFetch
  }
  verifyLegacyStorage()

  const now = '2026-09-13T12:00:00.000Z'
  const saved = { id: answer.id, type: 'answer', title: answer.title, excerpt: answer.paragraphs[0], author: answer.author,
    url: answer.url, questionId: answer.questionId, answerId: answer.id, query: '', savedAt: now }
  const reflection = { id: 'integration-reflection', targetId: answer.id, targetTitle: answer.title, text: '这是一条隔离测试笔记，不写入用户浏览器。', query: '', quote: answer.paragraphs[0], createdAt: now }
  const stop = { id: 'integration-stop', type: 'answer', title: answer.title, questionId: answer.questionId, answerId: answer.id, query: '', visitedAt: now }
  assert.deepEqual(storage.loadCollection(), [])
  assert.equal(storage.saveCollection([saved, saved]), true); assert.deepEqual(storage.loadCollection(), [saved])
  assert.equal(storage.saveReflections([reflection]), true); assert.deepEqual(storage.loadReflections(), [reflection])
  assert.equal(storage.saveJourney([stop]), true); assert.deepEqual(storage.loadJourney(), [stop])
  const notebook = storage.exportNotebook(storage.loadCollection(), storage.loadReflections(), storage.loadJourney())
  assert.ok(notebook.includes(reflection.text)); assert.ok(notebook.includes(answer.url)); verifyLegacyStorage()
  values.set('wanderwise.collection.v1', '{broken')
  assert.deepEqual(storage.loadCollection(), [], 'corrupt new collection must not break old journey or galaxy entry')
  assert.equal(storage.saveCollection([saved]), true)
  window.localStorage = { getItem() { throw new Error('isolated blocked storage') }, setItem() { throw new Error('isolated quota limit') } }
  assert.deepEqual(storage.loadCollection(), []); assert.equal(storage.saveCollection([saved]), false)
  window.localStorage = memoryStorage; verifyLegacyStorage()
  check('Real galaxy storage saves/de-duplicates articles, reflections and journey, exports notes and tolerates storage failure without modifying old eight fields or cocktail recipes')
  report.passed = true
  console.log(`Galaxy connection passed: ${report.checks.length} integration groups; no browser, no credentials, no user storage and no external API calls.`)
} catch (error) {
  report.passed = false; report.failure = error.stack; process.exitCode = 1; console.error(error)
} finally {
  globalThis.fetch = originalFetch
  if (server) { server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose)) }
  await loader.unregister()
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else delete globalThis[name]
  }
  await rm(runtime, { recursive: true, force: true })
  await writeFile(join(output, 'integration-report.json'), JSON.stringify(report, null, 2))
}
