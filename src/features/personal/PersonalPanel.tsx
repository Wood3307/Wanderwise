import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { ArrowUpRight, Bookmark, BookOpen, Check, Compass, Download, Feather, Leaf, LoaderCircle, Plus, Search, Sparkles, Upload, X } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useGameStore } from '@/state/gameStore'
import { api, normalizeSearchSource } from './api'
import type { SearchResponse, SynthesisResponse } from './api'
import type { ContentSource, PersonalNote, PersonalWork } from './types'
import { exportPersonalSpace, importPersonalSpace, usePersonalStore } from './store'
import SourceCard from './SourceCard'
import GalaxyVoyageLog from './GalaxyVoyageLog'
import './personal.css'
import './workspaces.css'

export type PersonalTab = 'search' | 'collections' | 'notes' | 'works' | 'journeys' | 'interests' | 'synthesis' | 'reading'
type Workspace = 'cabinet' | 'synth' | 'journal' | 'mascot' | 'library'
const WORKSPACES: Record<Workspace,{title:string;description:string;tabs:PersonalTab[]}> = {
  cabinet:{title:'取出一份曾打动你的材料',description:'资料柜 · 收藏、摘录与独立手记',tabs:['collections','notes']},
  synth:{title:'把材料，写成自己的观点',description:'思想合成台 · 联系、分歧、反例与新的表达',tabs:['synthesis']},
  journal:{title:'翻到上次停下的那一页',description:'旅程日志 · 沿原来的停靠点继续出发',tabs:['journeys']},
  mascot:{title:'和看山一起，把问题问得更清楚',description:'阅读伙伴 · 查找真实讨论与来源',tabs:['search','interests','reading']},
  library:{title:'在灯下，继续读与写',description:'私人书架 · 最近阅读与自己的作品',tabs:['reading','works']},
}
const TABS = [
  { id: 'reading', name: '灯下续读', icon: BookOpen, subtitle: '回到上次读过的段落，让思绪慢慢接上。' },
  { id: 'search', name: '与看山找寻', icon: Search, subtitle: '把一个问题，放进更辽阔的讨论里。' },
  { id: 'collections', name: '想法收纳柜', icon: Bookmark, subtitle: '在世界里遇见的启发，都有一个安放之处。' },
  { id: 'notes', name: '我的手记', icon: Feather, subtitle: '记下此刻的疑问，也留住想法发生的过程。' },
  { id: 'works', name: '我的作品', icon: BookOpen, subtitle: '从阅读与漫游中，长出自己的表达。' },
  { id: 'journeys', name: '漫行者日志', icon: Compass, subtitle: '沿着上次的足迹，继续未完成的相遇。' },
  { id: 'interests', name: '我的兴趣', icon: Leaf, subtitle: '你来定义自己关心什么，随时可以改变。' },
  { id: 'synthesis', name: '思维合成台', icon: Sparkles, subtitle: '让不同的材料相遇，再由你决定想法的方向。' },
] as const
const date = (value: string) => new Date(value).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
const errorText = (error: unknown) => error instanceof Error ? error.message : '暂时没有完成，请稍后重试。'

function Empty({ children }: { children: ReactNode }) {
  return <div className="ms-empty"><BookOpen size={28} strokeWidth={1}/><p>{children}</p></div>
}

function ReadingView() {
  const data=usePersonalStore(s=>s.data)
  const recent=Object.entries(data.reading??{}).sort((a,b)=>b[1].updatedAt.localeCompare(a[1].updatedAt)).map(([id,progress])=>({source:data.sources[id],progress})).filter(item=>item.source)
  return <div className="ms-stack">{recent.length?recent.map(({source,progress})=><section className="library-reading-entry" key={source.id}><p className="ms-eyebrow">上次读到第 {progress.paragraph+1} 段 · {date(progress.updatedAt)}</p><SourceCard source={source}/></section>):<Empty>静读一份收藏后，它会留在这里。作品放在旁边的书架上。</Empty>}</div>
}

function SearchView() {
  const [query, setQuery] = useState('')
  const [provider, setProvider] = useState<'zhihu' | 'global'>('zhihu')
  const [results, setResults] = useState<ContentSource[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  const interests = usePersonalStore(s => s.data.interests)
  useEffect(() => () => request.current?.abort(), [])
  async function search(event: FormEvent) {
    event.preventDefault()
    if (!query.trim()) return
    request.current?.abort()
    const controller = new AbortController(); request.current = controller
    setBusy(true); setError(''); setNotice(''); setResults([])
    try {
      const response = await api<SearchResponse>(`/api/search?${new URLSearchParams({ q: query.trim(), provider })}`, { signal: controller.signal })
      if (controller.signal.aborted) return
      const items = response.items.map(normalizeSearchSource)
      items.forEach(item => usePersonalStore.getState().putSource(item))
      setResults(items)
      setNotice(`${response.cached ? '读自本地检索缓存' : '已取得新结果并缓存到本地'} · ${items.length} 条${response.notice ? ` · ${response.notice}` : ''}`)
    } catch (error) { if (!controller.signal.aborted) setError(errorText(error)) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  return <div className="ms-stack">
    <div className="ms-letter"><span>看山的小纸条</span><p>从一个感兴趣的问题开始吧。遇见好的讨论，可以收进柜子，也可以写下自己的不同看法。</p></div>
    <form className="ms-search-form" onSubmit={search}>
      <label className="ms-field">搜索范围<select value={provider} onChange={event => setProvider(event.target.value as 'zhihu' | 'global')}><option value="zhihu">知乎讨论</option><option value="global">全网来源</option></select></label>
      <label className="ms-field ms-search-query">想了解什么？<input maxLength={160} value={query} onChange={event => setQuery(event.target.value)} placeholder="比如：为什么落日会让人想起往事"/></label>
      <button className="ms-button ms-button-primary" type="submit" disabled={busy || !query.trim()}>{busy ? <LoaderCircle className="ms-spin" size={16}/> : <Search size={16}/>} {busy ? '找寻中' : '开始找寻'}</button>
      {busy && <button className="ms-button" type="button" onClick={() => { request.current?.abort(); setBusy(false); setNotice('已停止这次找寻。') }}>停止</button>}
    </form>
    {!!interests.length && <div className="ms-tags">{interests.slice(0, 8).map(tag => <button type="button" key={tag} onClick={() => setQuery(tag)}>{tag}</button>)}</div>}
    {error && <p className="ms-error" role="alert">{error}</p>}
    {notice && <p className="ms-notice" role="status">{notice}</p>}
    <div className="ms-source-grid">{results.map(source => <SourceCard key={source.id} source={source}/>)}</div>
    {!busy && !results.length && <Empty>{notice ? '暂时没有找到相关内容，换一个更具体的关键词试试。' : '结果保留作者、摘要和原文入口；收藏和笔记会留在这间小屋。'}</Empty>}
  </div>
}

function CollectionsView({ onSearch }: { onSearch: () => void }) {
  const data = usePersonalStore(s => s.data)
  const [filter, setFilter] = useState('')
  const sources = [...new Set(data.collections.map(item => item.sourceId))].map(id => data.sources[id]).filter(Boolean)
  const visible = sources.filter(source => `${source.title} ${source.author} ${source.summary}`.toLowerCase().includes(filter.toLowerCase()))
  return <div className="ms-stack">
    <div className="ms-inline"><label className="ms-field ms-grow">在收藏中寻找<input value={filter} onChange={event => setFilter(event.target.value)} placeholder="标题、作者或一句话"/></label><button className="ms-button" onClick={onSearch}><Search size={15}/> 找新内容</button></div>
    <p className="ms-muted">{sources.length} 份收藏 · 取消收藏后，已经写下的笔记仍会保留。</p>
    <div className="ms-source-grid">{visible.map(source => <SourceCard key={source.id} source={source}/>)}</div>
    {!visible.length && <Empty>{filter ? '没有匹配的收藏。' : '从看山的搜索、星系或旅程中收藏一份材料，它就会出现在这里。'}</Empty>}
  </div>
}

function NoteEditor({ note, onSaved }: { note?: PersonalNote; onSaved: (id: string) => void }) {
  const [title, setTitle] = useState(note?.title ?? '')
  const [text, setText] = useState(note?.text ?? '')
  const [saved, setSaved] = useState(false)
  return <form className="ms-stack ms-editor" onSubmit={event => { event.preventDefault(); const id = usePersonalStore.getState().saveNote({ ...note, title: title.trim() || '一页新手记', text }); setSaved(true); onSaved(id) }}>
    <label className="ms-field">手记标题<input value={title} maxLength={120} onChange={event => { setTitle(event.target.value); setSaved(false) }} placeholder="给此刻的想法起个名字"/></label>
    {note?.quote && <blockquote className="ms-quote">{note.quote}</blockquote>}
    <label className="ms-field">我想记下<textarea rows={9} maxLength={6000} value={text} onChange={event => { setText(event.target.value); setSaved(false) }} placeholder="一个还没想明白的问题，也值得留下。"/></label>
    <div className="ms-inline"><button className="ms-button ms-button-primary" disabled={!text.trim()}>{saved ? <Check size={16}/> : <Feather size={16}/>} {saved ? '已保存' : '保存手记'}</button><span className="ms-muted">保存在当前浏览器，导出后可带往别处。</span></div>
  </form>
}

function NotesView() {
  const notes = usePersonalStore(s => s.data.notes)
  const [selected, setSelected] = useState<string | null>(notes[0]?.id ?? null)
  const note = notes.find(item => item.id === selected)
  return <div className="ms-split">
    <div className="ms-index"><button className="ms-button" onClick={() => setSelected(null)}><Plus size={15}/> 新的一页</button>{notes.map(item => <button key={item.id} className={`ms-index-item ${selected === item.id ? 'is-selected' : ''}`} onClick={() => setSelected(item.id)}><strong>{item.title}</strong><span>{item.text.slice(0, 54) || '尚未写下内容'}</span><small>{date(item.updatedAt)}</small></button>)}</div>
    <NoteEditor key={note?.id ?? 'new'} note={note} onSaved={setSelected}/>
  </div>
}

function WorkEditor({ work, onClose }: { work: PersonalWork; onClose: () => void }) {
  const [title, setTitle] = useState(work.title)
  const [text, setText] = useState(work.text)
  const [saved, setSaved] = useState(false)
  const sources = usePersonalStore(s => s.data.sources)
  const journey = usePersonalStore(s => work.kind === 'journey' ? s.data.journeys.find(item => item.id === work.journeyId) : undefined)
  const navigate = useNavigate()
  const photos = [0, 1, 2].flatMap(index => {
    const src = journey?.progress.drafts[`photo${index}`]
    return src && /^data:image\/(?:jpeg|png|webp);base64,/.test(src) ? [{ index, src, caption: journey?.progress.drafts[`caption${index}`] ?? '' }] : []
  })
  return <form className="ms-stack ms-editor" onSubmit={event => { event.preventDefault(); usePersonalStore.getState().saveWork({ ...work, title: title.trim() || '未命名作品', text }); setSaved(true) }}>
    <label className="ms-field">作品标题<input value={title} maxLength={120} onChange={event => { setTitle(event.target.value); setSaved(false) }}/></label>
    {journey && <section className="ms-stack" aria-label="旅程实景照片">
      <div className="ms-inline"><div className="ms-grow"><p className="ms-eyebrow">这次旅程里的真实画面</p><p className="ms-muted">{journey.title}</p></div><button type="button" className="ms-button" onClick={() => { onClose(); navigate(`/journey/${journey.realmId}?trip=${encodeURIComponent(journey.id)}`) }}>继续这次旅程<ArrowUpRight size={16}/></button></div>
      {photos.length ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))', gap: 12 }}>{photos.map(photo => <figure key={photo.index} style={{ margin: 0, minWidth: 0 }}><img src={photo.src} alt={photo.caption || `这次旅程的第 ${photo.index + 1} 幅实景照片`} loading="lazy" style={{ display: 'block', width: '100%', aspectRatio: '4 / 3', objectFit: 'contain', borderRadius: 8, background: '#111b17' }}/><figcaption className="ms-muted" style={{ marginTop: 8, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{photo.caption || `第 ${photo.index + 1} 幅 · 尚未填写画面说明`}</figcaption></figure>)}</div> : <p className="ms-muted">这次旅程尚未保存实景照片，继续探索时可以拍下沿途画面。</p>}
    </section>}
    <label className="ms-field">我的表达<textarea rows={12} maxLength={10000} value={text} onChange={event => { setText(event.target.value); setSaved(false) }}/></label>
    <button className="ms-button ms-button-primary ms-fit" disabled={!text.trim()}>{saved ? <Check size={15}/> : <Feather size={15}/>} {saved ? '修改已保存' : '保存修改'}</button>
    {!!work.sourceIds.length && <details className="ms-details"><summary>这份作品的材料 · {work.sourceIds.length}</summary><div className="ms-stack">{work.sourceIds.map(id => sources[id] && <SourceCard key={id} source={sources[id]}/>)}</div></details>}
  </form>
}

function WorksView({ onCreate, onClose }: { onCreate: () => void; onClose: () => void }) {
  const works = usePersonalStore(s => s.data.works)
  const [selected, setSelected] = useState<string | undefined>(works[0]?.id)
  const work = works.find(item => item.id === selected) ?? works[0]
  if (!work) return <div className="ms-stack"><Empty>在合成台写下一份想法，或在旅程中完成一次创作。这里会慢慢成为你的作品集。</Empty><button className="ms-button ms-button-primary ms-fit" onClick={onCreate}><Sparkles size={15}/> 开始创作</button></div>
  return <div className="ms-split"><div className="ms-index"><button className="ms-button" onClick={onCreate}><Plus size={15}/> 写新作品</button>{works.map(item => <button key={item.id} className={`ms-index-item ${work.id === item.id ? 'is-selected' : ''}`} onClick={() => setSelected(item.id)}><strong>{item.title}</strong><span>{item.kind === 'journey' ? '旅程创作' : '我的想法'} · {date(item.createdAt)}</span></button>)}</div><WorkEditor key={work.id} work={work} onClose={onClose}/></div>
}

function JourneysView({ onClose, selectedGalaxyTripId }: { onClose: () => void; selectedGalaxyTripId?: string }) {
  const journeys = usePersonalStore(s => s.data.journeys)
  const galaxyVoyages = usePersonalStore(s => s.data.galaxyVoyages)
  const navigate = useNavigate()
  return <div className="ms-stack"><GalaxyVoyageLog selectedTripId={selectedGalaxyTripId}/>{journeys.map((journey, index) => <article key={journey.id} className="ms-journey"><span className="ms-journey-number">{String(journeys.length - index).padStart(2, '0')}</span><div className="ms-grow"><p className="ms-eyebrow">{date(journey.createdAt)} · {journey.progress.completed ? '已完成' : '等待继续'}</p><h3>{journey.title}</h3><p>{journey.personalText || journey.recipe.prompt}</p><span className="ms-muted">走过 {journey.progress.visited.length} 个停靠点 · 收录 {journey.sourceIds.length} 份材料</span></div><button className="ms-button" onClick={() => { onClose(); navigate(`/journey/${journey.realmId}?trip=${encodeURIComponent(journey.id)}`) }}>{journey.progress.completed ? '再走一遍' : '继续漫游'}<ArrowUpRight size={16}/></button></article>)}{!journeys.length && !galaxyVoyages.length && <Empty>从观星台出发吧。你选择导出的星空足迹和配方旅程，会分别留在这里。</Empty>}</div>
}

function InterestsView() {
  const data = usePersonalStore(s => s.data)
  const [input, setInput] = useState('')
  return <div className="ms-stack">
    <div className="ms-letter"><span>关于我的一小部分</span><p>这些标签由你亲手填写，用来帮助寻找内容。不会根据浏览行为给你推断性格或人格。</p></div>
    <form className="ms-inline" onSubmit={event => { event.preventDefault(); usePersonalStore.getState().setInterests([...data.interests, ...input.split(/[,，、\n]/)]); setInput('') }}><label className="ms-field ms-grow">新增兴趣<input maxLength={160} value={input} onChange={event => setInput(event.target.value)} placeholder="摄影、海洋、古典音乐……"/></label><button className="ms-button ms-button-primary" disabled={!input.trim() || data.interests.length >= 30}><Plus size={15}/> 加入</button></form>
    <div className="ms-tags">{data.interests.map(tag => <button key={tag} onClick={() => usePersonalStore.getState().setInterests(data.interests.filter(item => item !== tag))} aria-label={`移除兴趣 ${tag}`}>{tag}<X size={12}/></button>)}</div><p className="ms-muted">最多 30 个标签 · 点击标签即可移除。</p>
    <div className="ms-settings"><h3>小屋里的陪伴</h3><label><input type="checkbox" checked={data.settings.mascotAnimated} onChange={event => usePersonalStore.getState().settings({ mascotAnimated: event.target.checked })}/> 让刘看山自然地活动</label><label><input type="checkbox" checked={data.settings.mascotHints} onChange={event => usePersonalStore.getState().settings({ mascotHints: event.target.checked })}/> 显示看山的轻声提示</label></div>
  </div>
}

function SynthesisView() {
  const data = usePersonalStore(s => s.data)
  const sources = [...new Set(data.collections.map(item => item.sourceId))].map(id => data.sources[id]).filter(Boolean)
  const [selected, setSelected] = useState<string[]>([])
  const [personal, setPersonal] = useState<string[]>([])
  const [prompt, setPrompt] = useState('')
  const [draft, setDraft] = useState('')
  const [draftTitle, setDraftTitle] = useState('')
  const [draftSources, setDraftSources] = useState<string[]>([])
  const [draftKind, setDraftKind] = useState<'manual' | 'ai'>('manual')
  const [workId, setWorkId] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [health, setHealth] = useState<{ configured: boolean } | null>(null)
  const request = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    api<{ synthesis?: { configured: boolean } }>('/api/health', { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setHealth(result.synthesis ?? { configured: false }) }).catch(() => { if (!controller.signal.aborted) setHealth({ configured: false }) })
    return () => { controller.abort(); request.current?.abort() }
  }, [])
  const materials = [...data.notes.map(note => ({ key: `note:${note.id}`, title: note.title, text: note.text, kind: '手记' })), ...data.works.map(work => ({ key: `work:${work.id}`, title: work.title, text: work.text, kind: '作品' }))]
  const personalText = materials.filter(item => personal.includes(item.key)).map(item => `【${item.kind}：${item.title}】\n${item.text}`).join('\n\n')
  const chosen = selected.map(id => data.sources[id]).filter(Boolean)
  function resetDraft(text: string, kind: 'manual' | 'ai', sourceIds: string[]) {
    setDraft(text); setDraftTitle(prompt.trim().slice(0, 80) || '材料相遇之后'); setDraftSources(sourceIds); setDraftKind(kind); setWorkId(undefined); setNotice('')
  }
  function manual() {
    request.current?.abort(); setBusy(false); setError('')
    const titles = chosen.map((source, index) => `${index + 1}. ${source.title}`).join('\n')
    resetDraft(`我想追问\n${prompt.trim() || '这些材料之间，会有什么联系？'}\n\n我选的材料\n${titles || '从自己的观察开始。'}\n\n它们相遇的地方\n\n\n一个不同的解释或反例\n\n\n我可以尝试的小实验\n`, 'manual', [...selected])
  }
  async function generate() {
    if (!prompt.trim() || personalText.length > 8000) return
    request.current?.abort(); const controller = new AbortController(); request.current = controller
    setBusy(true); setError(''); setNotice('')
    const sourceSnapshot = [...selected]
    try {
      const response = await api<SynthesisResponse>('/api/synthesis', { method: 'POST', signal: controller.signal, body: JSON.stringify({ mode: 'idea', prompt: prompt.trim(), sourceIds: chosen.map(source => source.remoteId ?? source.id), personalText }) })
      if (controller.signal.aborted) return
      resetDraft(response.draft.text, 'ai', sourceSnapshot)
    } catch (error) { if (!controller.signal.aborted) setError(errorText(error)) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  return <div className="ms-stack">
    <div className="ms-letter"><span>一次思想的小实验</span><p>选择最多四份收藏，让它们围绕一个问题相遇。手记和作品只在你勾选后加入 AI 请求；生成的草稿由你编辑、采纳。</p></div>
    <fieldset className="ms-materials"><legend>01 · 选择材料 <span>{selected.length} / 4</span></legend>{sources.length ? sources.map(source => <label key={source.id} className="ms-choice"><input type="checkbox" checked={selected.includes(source.id)} disabled={busy || !selected.includes(source.id) && selected.length >= 4} onChange={event => setSelected(event.target.checked ? [...selected, source.id] : selected.filter(id => id !== source.id))}/><span><strong>{source.title}</strong><small>{source.author || source.source}</small></span></label>) : <p className="ms-muted">还没有收藏，可以先写下自己的问题。</p>}</fieldset>
    {!!materials.length && <details className="ms-details"><summary>加入我的手记或作品 · 已选 {personal.length} 份</summary><div className="ms-materials">{materials.map(item => <label key={item.key} className="ms-choice"><input type="checkbox" checked={personal.includes(item.key)} disabled={busy} onChange={event => setPersonal(event.target.checked ? [...personal, item.key] : personal.filter(key => key !== item.key))}/><span><strong>{item.title}</strong><small>{item.kind} · {item.text.length} 字</small></span></label>)}</div></details>}
    {personal.length > 0 && <p className={personalText.length > 8000 ? 'ms-error' : 'ms-muted'}>将发送已勾选的个人材料 {personalText.length} / 8000 字{personalText.length > 8000 ? '，请减少所选材料。' : '。'}</p>}
    <label className="ms-field">02 · 这次想追问<textarea rows={3} value={prompt} maxLength={2000} disabled={busy} onChange={event => setPrompt(event.target.value)} placeholder="比如：照片里的留白，能否帮助我理解音乐里的停顿？"/></label>
    <div className="ms-inline"><button className="ms-button ms-button-primary" type="button" onClick={manual}><Feather size={16}/> 从手工模板开始</button><button className="ms-button" type="button" disabled={!health?.configured || busy || !prompt.trim() || personalText.length > 8000} onClick={generate}>{busy ? <LoaderCircle className="ms-spin" size={16}/> : <Sparkles size={16}/>} {busy ? '正在合成草稿' : '请 AI 帮我连接'}</button>{busy && <button className="ms-button" onClick={() => { request.current?.abort(); setBusy(false); setNotice('已停止等待草稿；已发送的服务请求可能仍消耗额度。') }}>停止</button>}</div>
    <p className="ms-muted">{health === null ? '正在查看 AI 服务状态……' : health.configured ? 'AI 合成可直接使用，每日额度有限；手工创作随时可用。' : 'AI 服务暂未连接，手工创作完整可用。'}</p>
    {error && <p className="ms-error" role="alert">{error}</p>}{notice && <p className="ms-notice" role="status">{notice}</p>}
    {!!draft && <div className="ms-editor ms-stack"><div className="ms-inline"><span className="ms-eyebrow">03 · {draftKind === 'ai' ? 'AI 创作草稿 · 请核对并编辑' : '手工创作模板 · 由你亲自完成'}</span></div><label className="ms-field">作品标题<input maxLength={120} value={draftTitle} onChange={event => setDraftTitle(event.target.value)}/></label><label className="ms-field">让它成为你的表达<textarea rows={13} maxLength={10000} value={draft} onChange={event => { setDraft(event.target.value); setNotice('') }}/></label><button className="ms-button ms-button-primary ms-fit" disabled={!draft.trim() || busy} onClick={() => { const id = usePersonalStore.getState().saveWork({ id: workId, title: draftTitle.trim() || '材料相遇之后', text: draft, sourceIds: draftSources, kind: 'idea' }); setWorkId(id); setNotice('作品已保存在「我的作品」，材料来源会一同保留。') }}><Check size={16}/>{workId ? '保存作品修改' : '采纳为我的作品'}</button></div>}
  </div>
}

export default function PersonalPanel({ initialTab = 'collections', initialGalaxyTripId, onClose, workspace }: { initialTab?: PersonalTab; initialGalaxyTripId?: string; onClose?: () => void; workspace?: Workspace }) {
  const [tab, setTab] = useState<PersonalTab>(initialTab)
  const [transferNotice, setTransferNotice] = useState('')
  const data = usePersonalStore(s => s.data)
  const ready = usePersonalStore(s => s.ready)
  const storageError = usePersonalStore(s => s.error)
  const closePanel = useGameStore(s => s.closePanel)
  const fileInput = useRef<HTMLInputElement>(null)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const close = onClose ?? closePanel
  const desk = workspace ? WORKSPACES[workspace] : undefined
  const tabs = desk ? TABS.filter(item=>desk.tabs.includes(item.id)) : TABS
  const openSearch = () => workspace ? useGameStore.getState().openPanel('mascot') : setTab('search')
  const openSynthesis = () => workspace ? useGameStore.getState().openPanel('synth') : setTab('synthesis')
  const active = TABS.find(item => item.id === tab)!
  const counts: Partial<Record<PersonalTab, number>> = { collections: data.collections.length, notes: data.notes.length, works: data.works.length, journeys: data.journeys.length + data.galaxyVoyages.length }
  return <Dialog open onOpenChange={open => { if (!open) close() }}><DialogContent className={`ms-personal ${workspace?`home-workspace workspace-${workspace}`:''}`} showCloseButton={false}>
    <header className="ms-panel-header"><span className="ms-panel-seal"><BookOpen size={22} strokeWidth={1.3}/></span><div className="ms-grow"><p className="ms-eyebrow">WANDERWISE · 我的精神小屋</p><DialogTitle>{desk?.title ?? '把世界的回声，留在这里'}</DialogTitle><DialogDescription>{desk?.description ?? '收藏、手记与作品，保存在当前浏览器的个人空间。'}</DialogDescription></div><button className="ms-close" onClick={close} aria-label="关闭个人空间"><X size={20}/></button></header>
    <div className="ms-panel-layout"><nav className="ms-panel-nav" aria-label="个人空间栏目">{tabs.map(({ id, name, icon: Icon }) => <button key={id} aria-current={tab === id ? 'page' : undefined} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}><Icon size={17}/><span>{name}</span>{counts[id] !== undefined && <small>{counts[id]}</small>}</button>)}<div className="ms-nav-foot"><span>灯火里，慢慢生长。</span><p>小屋是你的私人空间。</p></div></nav>
      <main className="ms-panel-main" key={tab}><div className="ms-section-heading"><active.icon size={20} strokeWidth={1.4}/><div><h2>{active.name}</h2><p>{active.subtitle}</p></div></div>
        {storageError && <div className="ms-error" role="alert">{storageError}<button className="ms-button" onClick={exportPersonalSpace}><Download size={14}/> 导出个人空间</button></div>}
        {!ready ? <p className="ms-notice" role="status">正在打开个人空间……</p> : tab === 'reading' ? <ReadingView/> : tab === 'search' ? <SearchView/> : tab === 'collections' ? <CollectionsView onSearch={openSearch}/> : tab === 'notes' ? <NotesView/> : tab === 'works' ? <WorksView onCreate={openSynthesis} onClose={close}/> : tab === 'journeys' ? <JourneysView onClose={close} selectedGalaxyTripId={initialGalaxyTripId}/> : tab === 'interests' ? <InterestsView/> : <SynthesisView/>}
      </main></div>
    <footer className="ms-panel-footer"><span role="status">{transferNotice || '本机保存 · 可导出备份与迁移'}</span><div><button className="ms-button" onClick={exportPersonalSpace}><Download size={14}/> 导出</button><button className="ms-button" onClick={() => fileInput.current?.click()}><Upload size={14}/> 导入</button><input ref={fileInput} type="file" accept="application/json,.json" className="ms-file-input" aria-label="导入个人空间 JSON" onChange={async event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; if (file.size > 12_000_000) { setTransferNotice('文件过大，请选择 12 MB 以内的个人空间 JSON。'); return } try { await importPersonalSpace(await file.text()); if (mounted.current) setTransferNotice('已合并个人空间，原有数据已自动备份。') } catch (error) { if (mounted.current) setTransferNotice(`导入未完成：${errorText(error)}`) } }}/></div></footer>
  </DialogContent></Dialog>
}
