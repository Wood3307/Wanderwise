import CocktailVision, { type CocktailPreview } from '@/features/typography/CocktailVision'
import SceneReviewTools from '@/features/journeys/scene/SceneReviewTools'
import StarlightPath from '@/features/typography/StarlightPath'
import LivingWords from '@/features/typography/LivingWords'
import DirectionIcon from '@/features/presentation/DirectionIcon'
import JumpButton from '@/features/presentation/JumpButton'
import ReadingLight from '@/features/typography/ReadingLight'
import CollectionTreeScene, { TOPICS_PER_PAGE, LEAVES_PER_PAGE } from '@/components/observatory/CollectionTreeScene'
import CollectionTreeControls from '@/components/observatory/CollectionTreeControls'
import { buildCollectionTree, type CollectionTreeLeaf } from '@/features/personal/collectionTree'
import { collectionTreeReading } from '@/features/personal/collectionTreeReading'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { usePersonalStore } from '@/features/personal/store'
import type { CollectionRecord, ScenePose } from '@/features/personal/types'
import { getKnowledgeIngredient, type KnowledgeId, type ThoughtRecipe } from '@/components/observatory/gardenRecipes'
import type { AtmosphereResponse } from '@/features/journeys/scene/atmosphereMotion'
import { api } from '@/features/personal/api'
import type { SearchResponse } from '@/features/personal/api'
import SourceCard from '@/features/personal/SourceCard'
import '@/features/personal/personal.css'
import { Canvas } from '@react-three/fiber'
import { useProgress } from '@react-three/drei'
import { ArrowLeft, ArrowUpRight, Compass, Leaf, RotateCcw, Settings, Sparkles, Waves, Wine } from 'lucide-react'
import * as THREE from 'three'
import ObservatoryScene from '@/components/observatory/ObservatoryScene'
import ObservatoryRig from '@/components/observatory/ObservatoryRig'
import GardenWorkshop from '@/components/observatory/GardenWorkshop'
import type { ObservatoryInput } from '@/components/observatory/ObservatoryRig'
import { OBSERVATORY_SPAWN } from '@/components/observatory/layout'
import { getQualityProfile, useGameStore } from '@/state/gameStore'
import SettingsPanel from '@/components/hud/SettingsPanel'
import { Toast } from '@/components/hud/Toast'
import '@/components/hud/hud.css'
import './observatory.css'

const PCF_SHADOW_MAP = 1
const ignoreSceneAction = () => {}
const PersonalPanel = lazy(() => import('@/features/personal/PersonalPanel'))

function useMedia(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const change = () => setMatches(media.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [query])
  return matches
}

function LoadingProgress() {
  const progress = useProgress(s => s.progress)
  return <div className="observatory-loading" role="status">
    <Compass size={30} strokeWidth={1} />
    <span>正在唤醒星树下的花园</span>
    <span className="observatory-loading-track"><span style={{ width: `${progress}%` }} /></span>
  </div>
}

export default function ObservatoryPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const entry = location.state as {openWorkshop?:boolean;recipePair?:readonly [KnowledgeId,KnowledgeId];galaxyTripId?:string} | null
  const [voyageLogOpen, setVoyageLogOpen] = useState(false)
  const voyageLogButton = useRef<HTMLButtonElement|null>(null)
  const [hotOpen,setHotOpen] = useState(false)
  const [hot,setHot] = useState<SearchResponse|null>(null)
  const [hotError,setHotError] = useState('')
  const [hotLoading,setHotLoading] = useState(false)
  const hotRequest = useRef<AbortController|null>(null)
  const hotDialog = useRef<HTMLElement|null>(null)
  const closeHot = useCallback(()=>{hotRequest.current?.abort();setHotLoading(false);setHotOpen(false)},[])
  const initialPose = useRef(usePersonalStore.getState().data.poses.observatory)
  const onPose = useCallback((pose:ScenePose) => usePersonalStore.getState().savePose('observatory',pose),[])
  useEffect(() => () => hotRequest.current?.abort(),[])
  useEffect(()=>{if(!hotOpen)return;hotDialog.current?.querySelector<HTMLButtonElement>('button')?.focus();const close=(e:KeyboardEvent)=>{if(e.key==='Escape')closeHot()};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[hotOpen,closeHot])
  const loadHot = async () => {
    setHotOpen(true); if(hot || hotLoading)return; const controller=new AbortController();hotRequest.current=controller;setHotLoading(true);setHotError('')
    try { const result=await api<SearchResponse>('/api/hot',{signal:controller.signal});if(!controller.signal.aborted)setHot(result) } catch(e) {if(!controller.signal.aborted)setHotError(e instanceof Error?e.message:'热榜暂时不可用')} finally {if(!controller.signal.aborted)setHotLoading(false)}
  }
  const qualityMode = useGameStore(s => s.qualityMode)
  const panel = useGameStore(s => s.panel)
  const quality = useMemo(() => getQualityProfile(qualityMode), [qualityMode])
  const input = useRef<ObservatoryInput>({ keys: new Set(), active: true, reset: false, canvas: null })
  const [ready, setReady] = useState(false)
  const [locked, setLocked] = useState(false)
  const [nearHome, setNearHome] = useState(false)
  const [nearGalaxy, setNearGalaxy] = useState(false)
  const [nearWorkshop, setNearWorkshop] = useState(false)
  const [nearTide, setNearTide] = useState(false)
  const [nearTree, setNearTree] = useState(false)
  const [treeOpen, setTreeOpen] = useState(false)
  const [topicId, setTopicId] = useState<string | null>(null)
  const [topicPage, setTopicPage] = useState(0)
  const [leafPage, setLeafPage] = useState(0)
  // Keep a reading snapshot so removing a leaf does not close the reader mid-sentence.
  const [readingLeaf, setReadingLeaf] = useState<CollectionTreeLeaf | null>(null)
  const readingRecord = useRef<CollectionRecord | null>(null)
  const treeDialog = useRef<HTMLElement | null>(null)
  const personalData = usePersonalStore(s => s.data)
  const personalReady = usePersonalStore(s => s.ready)
  const personalError = usePersonalStore(s => s.error)
  const topics = useMemo(() => buildCollectionTree(personalData), [personalData])
  const selectedTopic = topics.find(topic => topic.id === topicId) ?? null
  const topicPages = Math.max(1, Math.ceil(topics.length / TOPICS_PER_PAGE))
  const leafPages = Math.max(1, Math.ceil((selectedTopic?.leaves.length ?? 0) / LEAVES_PER_PAGE))
  const shownTopicPage = Math.min(topicPage, topicPages - 1)
  const shownLeafPage = Math.min(leafPage, leafPages - 1)
  const readingContent = readingLeaf ? collectionTreeReading(readingLeaf) : null
  const [drinkPreview, setDrinkPreview] = useState<CocktailPreview | null>(null)
  const [workshopOpen, setWorkshopOpen] = useState(!!entry?.openWorkshop)
  const [workshopPair, setWorkshopPair] = useState(entry?.recipePair)
  const [response, setResponse] = useState<AtmosphereResponse>({ id: 0, origin: [-2.35, 1.25], color: '#87d8d0' })
  const [tideNotice, setTideNotice] = useState('')
  const resonate = useCallback((origin: [number, number] = [-2.35, 1.25]) => {
    setResponse(previous => ({ id: previous.id + 1, origin, color: '#87d8d0' }))
    setTideNotice('月泉泛起涟漪，星潮正向远岛散去。')
  }, [])
  useEffect(() => {
    if (!response.id) return
    const timeout = window.setTimeout(() => setTideNotice(''), 5600)
    return () => window.clearTimeout(timeout)
  }, [response.id])
  const wasBlocked = useRef(false)
  const nonTreeBlocked = !!panel || workshopOpen || hotOpen || voyageLogOpen
  const blocked = nonTreeBlocked || treeOpen
  const touch = useMedia('(pointer: coarse)')
  const reducedMotion = useMedia('(prefers-reduced-motion: reduce)')
  const onReady = useCallback(() => setReady(true), [])
  const onLockChange = useCallback((value: boolean) => setLocked(value), [])

  useEffect(() => {
    const previousTitle = document.title
    const controller = input.current
    document.title = '星树花园 · 漫思 Wanderwise'
    return () => { document.title = previousTitle; controller.keys.clear(); controller.active = false }
  }, [input])
  useEffect(() => {
    const controller = input.current
    controller.active = !blocked
    if (blocked) { controller.keys.clear(); controller.pauseLook?.() }
    else if (wasBlocked.current) controller.resumeLook?.()
    wasBlocked.current = blocked
  }, [blocked])

  const leave = useCallback(() => {
    input.current.keys.clear()
    if (document.pointerLockElement) document.exitPointerLock()
  }, [])
  const enterWorld = useCallback(() => {
    const pose = input.current.capturePose?.()
    if (pose) onPose(pose)
    leave()
    input.current.active = false
    useGameStore.getState().closePanel()
    usePersonalStore.getState().setReturn({route:'/observatory',label:'观星台',pose:usePersonalStore.getState().data.poses.observatory})
    navigate('/galaxy', {state:{wanderwiseEntry:true}})
  }, [leave, navigate, onPose])
  const openTree = useCallback(() => {
    if (!input.current.active) return
    const pose = input.current.capturePose?.()
    if (pose) onPose(pose)
    input.current.active = false
    input.current.pauseLook?.()
    leave()
    setTreeOpen(true)
  }, [leave, onPose])
  const closeTree = useCallback(() => {
    setReadingLeaf(null)
    setTreeOpen(false)
    requestAnimationFrame(() => {
      input.current.canvas?.focus({ preventScroll: true })
    })
  }, [])
  const selectTopic = useCallback((id: string) => { setTopicId(id); setLeafPage(0) }, [])
  const readLeaf = (id: string) => {
    const leaf = selectedTopic?.leaves.find(item => item.id === id)
    const record = personalData.collections.find(item => item.id === id)
    if (leaf && record) { readingRecord.current = { ...record }; setReadingLeaf(leaf) }
  }
  const closeReading = () => {
    setReadingLeaf(null)
    requestAnimationFrame(() => {
      if (!treeDialog.current?.contains(document.activeElement)) {
        treeDialog.current?.querySelector<HTMLElement>('[data-tree-close]')?.focus()
      }
    })
  }
  const toggleReadingCollection = () => {
    if (!readingLeaf || !readingRecord.current || !personalReady) return
    const store = usePersonalStore.getState()
    if (store.data.collections.some(item => item.id === readingLeaf.id)) store.uncollect(readingLeaf.id)
    else {
      store.restoreCollection(readingRecord.current)
    }
  }
  useEffect(() => {
    if (!treeOpen) return
    const frame = requestAnimationFrame(() => treeDialog.current?.querySelector<HTMLElement>('[data-tree-close]')?.focus())
    return () => cancelAnimationFrame(frame)
  }, [treeOpen])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.isComposing || event.altKey || event.metaKey || event.ctrlKey) return
      if (treeOpen) {
        if (readingLeaf) return // The nested reading dialog owns Escape and focus.
        if (event.key === 'Escape') { event.preventDefault(); closeTree(); return }
        if (event.key !== 'Tab') return
        const controls = Array.from(treeDialog.current?.querySelectorAll<HTMLElement>('[data-collection-tree-control]:not(:disabled)') ?? [])
          .filter(node => node.tabIndex >= 0 && node.getClientRects().length && !node.closest('[inert]'))
        event.preventDefault()
        const index = controls.indexOf(document.activeElement as HTMLElement)
        const next = index < 0 ? (event.shiftKey ? controls.length - 1 : 0)
          : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
        controls[next]?.focus()
      } else if (!blocked && !event.repeat && event.code === 'KeyT') {
        const target = event.target
        if (target instanceof HTMLElement && target.closest('input,textarea,select,[contenteditable="true"]')) return
        event.preventDefault(); openTree()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [blocked, closeTree, openTree, readingLeaf, treeOpen])
  const openWorkshop = useCallback(() => {
    input.current.active = false
    input.current.pauseLook?.()
    leave(); setWorkshopOpen(true)
  }, [leave])
  const closeWorkshop = useCallback(() => setWorkshopOpen(false), [])
  const selectIngredient = useCallback((id: KnowledgeId) => {
    setWorkshopPair([id, id === 'photography' ? 'nature' : 'photography'])
    setResponse(previous => ({ id: previous.id + 1, origin: [-2.35, 1.25], color: getKnowledgeIngredient(id).color }))
    openWorkshop()
  }, [openWorkshop])
  const onMixStart = useCallback((recipe: ThoughtRecipe) => {
    setResponse(previous => ({ id: previous.id + 1, origin: [-6.65, 1.4], color: getKnowledgeIngredient(recipe.first).color }))
  }, [])
  const returnHome = useCallback(() => {
    leave(); useGameStore.getState().closePanel()
    navigate('/home', { state: { spawn: 'balcony-observatory' } })
  }, [leave, navigate])

  return <main ref={treeDialog} role={treeOpen ? 'dialog' : undefined} aria-modal={treeOpen ? true : undefined} aria-labelledby={treeOpen ? 'collection-tree-title' : undefined} className={`observatory-page ${locked ? 'is-locked' : ''} ${treeOpen ? 'is-collection-tree' : ''}`}>
    <Canvas inert={nonTreeBlocked || !!readingLeaf} shadows={{type:PCF_SHADOW_MAP}} dpr={quality.dprMax === 1 ? 1 : [1, quality.dprMax]}
      camera={{ fov: 68, near: 0.05, far: 240, position: OBSERVATORY_SPAWN }}
      gl={{ antialias: false, powerPreference: 'high-performance', transmissionResolutionScale: .5 }}
      onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.05 }}>
      <Suspense fallback={null}>
        <ObservatoryScene quiet={blocked} collectionReading={treeOpen} quality={quality} reducedMotion={reducedMotion} onReturnHome={treeOpen ? ignoreSceneAction : returnHome} onEnterWorld={treeOpen ? ignoreSceneAction : enterWorld} onOpenWorkshop={treeOpen ? ignoreSceneAction : openWorkshop} response={response} onResonate={treeOpen ? ignoreSceneAction : resonate} onIngredient={treeOpen ? ignoreSceneAction : selectIngredient}/>
        {!nonTreeBlocked && <CollectionTreeScene open={treeOpen} near={nearTree && !nearHome && !nearGalaxy && !nearWorkshop && !nearTide} topics={topics} selectedTopicId={selectedTopic?.id ?? null} selectedLeafId={readingLeaf?.id ?? null}
          topicPage={shownTopicPage} leafPage={shownLeafPage} onOpen={openTree} onTopic={selectTopic} onLeaf={readLeaf} reducedMotion={reducedMotion}/>}
        <StarlightPath/>
        {workshopOpen && drinkPreview && <CocktailVision {...drinkPreview}/>}
        <ObservatoryRig treeOpen={treeOpen} reducedMotion={reducedMotion} onOpenTree={openTree} onNearTree={setNearTree} workshopOpen={workshopOpen} initialPose={initialPose.current} onPose={onPose} input={input} onReady={onReady} onLockChange={onLockChange} onReturnHome={returnHome} onEnterWorld={enterWorld} onOpenWorkshop={openWorkshop}
          onNearHome={setNearHome} onNearGalaxy={setNearGalaxy} onNearWorkshop={setNearWorkshop} onResonate={resonate} onNearTide={setNearTide}/>
      </Suspense>
    <SceneReviewTools/></Canvas>
    <div className="observatory-vignette" aria-hidden="true" />
    {!ready && <LoadingProgress />}

    <header className="observatory-header" inert={blocked} aria-hidden={blocked}>
      <div className="observatory-identity">
        <span className="observatory-monogram" aria-hidden="true"><Leaf strokeWidth={1} /></span>
        <div><p className="observatory-eyebrow">漫思 WANDERWISE <span>/</span> 镜海家园</p>
          <h1><LivingWords text="星树花园"/></h1>
          <p className="observatory-subtitle">在树下收集灵感，沿星光走向星河。</p>
        </div>
      </div>
      <nav aria-label="观星台导航" className="observatory-nav">
        {!!personalData.galaxyVoyages.length && <button ref={voyageLogButton} type="button" className="observatory-button" onClick={() => { leave(); setVoyageLogOpen(true) }}><Compass size={15}/>{entry?.galaxyTripId && personalData.galaxyVoyages.some(trip => trip.tripId === entry.galaxyTripId) ? '查看本次足迹' : '漫游足迹'}</button>}
        <button type="button" className="observatory-button" onClick={() => void loadHot()}><Sparkles size={15}/>外界的回声</button>
        <button type="button" className="observatory-button return-home" onClick={returnHome} aria-keyshortcuts="H"><ArrowLeft size={15} />返回小屋{!touch && <kbd>H</kbd>}</button>
        <button type="button" className="observatory-icon-button" aria-label="设置画质" title="设置画质" onClick={() => { leave(); useGameStore.getState().openPanel('settings') }}><Settings size={17} strokeWidth={1.5} /></button>
      </nav>
    </header>

    {voyageLogOpen && <Suspense fallback={null}><PersonalPanel initialTab="journeys" initialGalaxyTripId={entry?.galaxyTripId} onClose={() => { setVoyageLogOpen(false); requestAnimationFrame(() => voyageLogButton.current?.focus()) }}/></Suspense>}

    {locked && <div className="observatory-reticle" aria-hidden="true" />}
    {nearHome && !blocked && <button type="button" className="observatory-return-prompt" aria-label="通过传送门返回小屋" aria-keyshortcuts="E" onClick={returnHome}>
      {!touch && <kbd>E</kbd>}返回小屋<ArrowLeft size={16} /><small>{touch ? '点击回到阳台' : '回到阳台，继续家园漫步'}</small>
    </button>}
    {!nearHome && nearGalaxy && !blocked && <button type="button" className="observatory-return-prompt garden-galaxy-prompt" aria-keyshortcuts="E" onClick={enterWorld}>
      {!touch && <kbd>E</kbd>}沿星光出发<Sparkles size={16} /><small>穿过树枝之间，进入你的星系</small>
    </button>}
    {!nearHome && !nearGalaxy && nearWorkshop && !blocked && <button type="button" className="observatory-return-prompt garden-workshop-prompt" aria-keyshortcuts="E" onClick={openWorkshop}>
      {!touch && <kbd>E</kbd>}调一杯思想<Wine size={16} /><small>两种知识，在这里相遇</small>
    </button>}
    {!nearHome && !nearGalaxy && !nearWorkshop && nearTide && !blocked && <button type="button" className="observatory-return-prompt tide-pool-prompt" aria-keyshortcuts="E" onClick={() => resonate()}>
      {!touch && <kbd>E</kbd>}轻拨月泉<Waves size={16}/><small>让一圈涟漪，越过花园去往远岛</small>
    </button>}
    {!nearHome && !nearGalaxy && !nearWorkshop && !nearTide && nearTree && !blocked && <button type="button" className="observatory-return-prompt" aria-keyshortcuts="E" onClick={openTree}>
      {!touch && <kbd>E</kbd>}我的星树<Leaf size={16}/><small>让收藏沿枝头展开</small>
    </button>}
    {tideNotice && !blocked && <p className="tide-response-notice" role="status">{tideNotice}</p>}
    <footer className="observatory-footer" inert={blocked} aria-hidden={blocked}>
      <div className="observatory-location"><Leaf size={20} strokeWidth={1.2} /><div><span>星树下 · 花园与远方</span><small>{touch ? '方向键行走 · 拖动环顾 · 靠近后点击互动' : locked ? 'WASD 行走 · E 互动 · H 回家 · Esc 释放 · F 恢复' : '鼠标即环顾 · WASD 行走 · E 互动 · Esc 释放 · F 恢复 · H 回家'}</small></div></div>
      <div className="observatory-walk-controls">
        {!locked && <button type="button" className="observatory-icon-button" disabled={!ready} aria-label="回到观测起点" title="回到观测起点" onClick={() => { input.current.reset = true }}><RotateCcw size={16} /></button>}
      </div>
      <div className="garden-footer-actions">
        <button type="button" className="observatory-button" disabled={!ready} aria-keyshortcuts="T" onClick={openTree}><Leaf size={18}/><span>我的星树</span>{!touch && <kbd>T</kbd>}</button>
        <button type="button" className="observatory-button tide-call-button" onClick={() => resonate()} aria-label="唤起星潮"><Waves size={18}/><span>唤起星潮</span></button>
        <button type="button" className="observatory-icon-button garden-workshop-shortcut" aria-label="打开思想调酒" title="思想调酒" onClick={openWorkshop}><Wine size={20} strokeWidth={1.3} /></button>
        <button type="button" className="observatory-world-button" onClick={enterWorld}><span><small>树枝之间 · 下一段旅程</small>进入星系</span><ArrowUpRight size={23} strokeWidth={1.2} /></button>
      </div>
    </footer>

    {touch && ready && !blocked && <div className="observatory-touch-pad" aria-label="行走方向键">
      {(['', 'KeyW', '', 'KeyA', 'KeyS', 'KeyD'] as const).map((key, i) => key ? <button key={key} type="button" aria-label={{ KeyW: '向前走', KeyA: '向左走', KeyS: '向后走', KeyD: '向右走' }[key]}
        onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); input.current.keys.add(key) }}
        onPointerUp={() => input.current.keys.delete(key)} onPointerCancel={() => input.current.keys.delete(key)} onLostPointerCapture={() => input.current.keys.delete(key)}>
        <DirectionIcon code={key}/></button> : <span key={i} />)}
    </div>}
    {touch && ready && !blocked && <JumpButton onJump={() => input.current.keys.add('Space')}/>}
    {panel === 'settings' && <SettingsPanel />}
    {treeOpen && <div inert={!!readingLeaf}><CollectionTreeControls ready={personalReady} error={personalError}
      collectionCount={personalData.collections.length} topicCount={topics.length} selectedTopicLabel={selectedTopic?.label ?? null}
      selectedTopicLeafCount={selectedTopic?.leaves.length ?? 0} topicPage={shownTopicPage} topicPages={topicPages}
      leafPage={shownLeafPage} leafPages={leafPages} onTopicPage={setTopicPage} onLeafPage={setLeafPage}
      onBackTopics={() => setTopicId(null)} onExplore={enterWorld} onClose={closeTree}/></div>}
    {treeOpen && readingLeaf && readingContent && <ReadingLight id={readingLeaf.id} {...readingContent}
      saved={personalData.collections.some(item => item.id === readingLeaf.id)} saveDisabled={!personalReady}
      onSave={toggleReadingCollection} onClose={closeReading}/>}
    <div className="observatory-toast"><Toast /></div>
    {workshopOpen && <GardenWorkshop onPreview={setDrinkPreview} initialPair={workshopPair} onMixStart={onMixStart} onClose={closeWorkshop} />}
    {hotOpen && <div className="observatory-dialog-backdrop" onClick={closeHot}><section ref={hotDialog} className="ms-hot-panel" onKeyDown={e=>{if(e.key!=='Tab')return;const list=e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,textarea,select');const first=list[0],last=list[list.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}} role="dialog" aria-modal="true" aria-label="外界的回声" onClick={e => e.stopPropagation()}><button type="button" className="observatory-button" onClick={closeHot}>合上回声匣</button><p className="observatory-eyebrow">THE WORLD OUTSIDE</p><h2>外界的回声</h2><p>近期知乎话题 · 热度表示关注，不代表观点的正确性。</p>{hotLoading && <p role="status">正在打开回声匣…</p>}{hotError && <p role="alert">{hotError}</p>}{hot?.items.map(source => <SourceCard key={source.id} source={source} onExplore={item => {usePersonalStore.getState().setReturn({route:'/observatory',label:'观星台',pose:usePersonalStore.getState().data.poses.observatory});navigate(`/galaxy?q=${encodeURIComponent(item.title.slice(0,160))}`,{state:{wanderwiseEntry:true}})}}/>)}</section></div>}
  </main>
}
