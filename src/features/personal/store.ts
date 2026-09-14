import { create } from 'zustand'
import { mixThoughtRecipe, KNOWLEDGE_INGREDIENTS } from '../../components/observatory/gardenRecipes'
import type { ThoughtRecipe } from '../../components/observatory/gardenRecipes'
import type { CollectionRecord, ContentSource, GalaxyVoyage, JourneyInstance, PersonalData, PersonalNote, PersonalWork, ScenePose, SceneReturnAnchor } from './types'
import { canonicalSource, emptyPersonalData, mergeSourceMetadata, readVault, validatePersonalData, writeVault } from './persistence'
import { applyCollectionSeed } from './collectionSeed'
import { normalizeJourneyExport } from '../galaxy/lib/trip'
import { mergeGalaxyVoyages } from './galaxyVoyageData'

const now = () => new Date().toISOString()
const uid = () => crypto.randomUUID()
const legacyDate=(value:unknown)=>{const date=new Date(typeof value==='number'||typeof value==='string'?value:0);return Number.isFinite(date.getTime())?date.toISOString():new Date(0).toISOString()}
interface PersonalState {
  ready: boolean; error: string; data: PersonalData
  putSource: (source: ContentSource) => string
  collect: (source: ContentSource, excerpt?: string, legacyId?: string) => string
  uncollect: (id: string) => void
  restoreCollection: (record: CollectionRecord) => void
  saveNote: (note: Partial<PersonalNote> & Pick<PersonalNote,'title'|'text'>) => string
  saveWork: (work: Omit<PersonalWork,'id'|'createdAt'> & {id?:string}) => string
  createJourney: (input: Pick<JourneyInstance,'realmId'|'title'|'recipe'|'personalText'|'sourceIds'>) => JourneyInstance
  updateJourney: (id:string, patch: Partial<JourneyInstance['progress']>) => void
  saveRecipe: (recipe:ThoughtRecipe) => void
  setReturn: (anchor:SceneReturnAnchor|null) => void
  savePose: (key:string,pose:ScenePose) => void
  setInterests: (interests:string[]) => void
  settings: (settings: Partial<PersonalData['settings']>) => void
  saveReading: (sourceId: string, paragraph: number) => void
}
export const usePersonalStore = create<PersonalState>((set,get)=>({
  ready:false,error:'',data:emptyPersonalData(),
  saveReading:(sourceId,paragraph)=>{if(!get().data.sources[sourceId]||!Number.isFinite(paragraph))return;set(s=>({data:{...s.data,reading:{...s.data.reading,[sourceId]:{paragraph:Math.max(0,Math.min(100000,Math.floor(paragraph))),updatedAt:now()}}}}))},
  putSource:(value)=>{const source=canonicalSource(value);set(s=>({data:{...s.data,sources:{...s.data.sources,[source.id]:mergeSourceMetadata(s.data.sources[source.id],source)}}}));return source.id},
  collect:(value,excerpt,legacyId)=>{
    const sourceId=get().putSource(value);const existing=get().data.collections.find(c=>c.sourceId===sourceId && c.excerpt===(excerpt??value.summary) && (!legacyId||c.legacyId===legacyId))
    if(existing)return existing.id
    const id=legacyId?`legacy:${legacyId}`:uid();set(s=>({data:{...s.data,collections:[{id,sourceId,excerpt:excerpt??value.summary,createdAt:now(),legacyId},...s.data.collections]}}));return id
  },
  uncollect:(id)=>set(s=>({data:{...s.data,collections:s.data.collections.filter(c=>c.id!==id&&c.legacyId!==id)}})),
  // Undo uses the record identity, including orphaned or duplicate historical leaves.
  restoreCollection:(record)=>set(s=>s.data.collections.some(c=>c.id===record.id)?s:{data:{...s.data,collections:[{...record},...s.data.collections]}}),
  saveNote:(note)=>{const id=note.id??uid();set(s=>{const existing=s.data.notes.find(n=>n.id===id);return {data:{...s.data,notes:[{...existing,...note,id,sourceId:note.sourceId??existing?.sourceId,createdAt:note.createdAt??existing?.createdAt??now(),updatedAt:now()},...s.data.notes.filter(n=>n.id!==id)]}}});return id},
  saveWork:(work)=>{const id=work.id??uid();set(s=>({data:{...s.data,works:[{...work,id,createdAt:now()},...s.data.works.filter(w=>w.id!==id)]}}));return id},
  createJourney:(input)=>{const journey:JourneyInstance={...input,id:uid(),contentVersion:1,createdAt:now(),progress:{visited:[],drafts:{},completed:false}};set(s=>({data:{...s.data,journeys:[journey,...s.data.journeys]}}));get().saveRecipe(input.recipe);return journey},
  updateJourney:(id,patch)=>set(s=>({data:{...s.data,journeys:s.data.journeys.map(j=>j.id===id?{...j,progress:{...j.progress,...patch}}:j)}})),
  saveRecipe:(recipe)=>set(s=>({data:{...s.data,recipes:[recipe,...s.data.recipes.filter(r=>r.id!==recipe.id)].slice(0,100)}})),
  setReturn:(returnAnchor)=>set(s=>({data:{...s.data,returnAnchor}})),
  savePose:(key,pose)=>set(s=>({data:{...s.data,poses:{...s.data.poses,[key]:pose}}})),
  setInterests:(interests)=>set(s=>({data:{...s.data,interests:[...new Set(interests.map(t=>t.trim()).filter(Boolean))].slice(0,30)}})),
  settings:(settings)=>set(s=>({data:{...s.data,settings:{...s.data.settings,...settings}}})),
}))
let writes:Promise<void>=Promise.resolve()
let initialized:Promise<void>|undefined
export function flushPersonalData(){return writes}
async function persistCurrentProfile(requiredTripId?: string): Promise<PersonalData> {
  // A queued write is an intent to persist, not a historical profile. Imports
  // may have committed a newer merged state while this job was waiting.
  const snapshot = usePersonalStore.getState().data
  if (requiredTripId && !snapshot.galaxyVoyages.some(trip => trip.tripId === requiredTripId)) throw new Error('待接收足迹已不在当前个人空间中')
  await writeVault('profile', snapshot)
  return snapshot
}
usePersonalStore.subscribe((state,previous)=>{
  if(!state.ready||!previous.ready||state.data===previous.data)return
  writes=writes.catch(()=>{}).then(async()=>{const snapshot=await persistCurrentProfile();if(usePersonalStore.getState().data===snapshot&&usePersonalStore.getState().error)usePersonalStore.setState({error:''})}).catch(()=>{usePersonalStore.setState({error:'本机存储暂不可用，请导出个人空间保存本次收获。'})})
})

/** Resolve only after the actual profile transaction commits; outbox acknowledgement may follow. */
export async function receiveGalaxyVoyage(value: unknown): Promise<GalaxyVoyage> {
  const packet = normalizeJourneyExport(value)
  if (!packet) throw new Error('漫游足迹格式无效')
  const state = usePersonalStore.getState()
  if (!state.ready) throw new Error('个人空间尚未准备好')
  const existing = state.data.galaxyVoyages.find(trip => trip.tripId === packet.tripId)
  if (!existing) usePersonalStore.setState({ data: { ...state.data, galaxyVoyages: mergeGalaxyVoyages(state.data.galaxyVoyages, [packet]) } })
  // Serialize with every other profile write. A retry also persists a previous in-memory receipt.
  // Acknowledge only a transaction containing this trip and the latest profile.
  const committed = writes.catch(() => {}).then(() => persistCurrentProfile(packet.tripId))
  writes = committed.then((snapshot) => {
    if (usePersonalStore.getState().data === snapshot && usePersonalStore.getState().error) usePersonalStore.setState({ error: '' })
  }).catch(() => { usePersonalStore.setState({ error: '漫游足迹尚未保存，已保留待领取记录。请释放本机空间后重试，或导出个人空间。' }) })
  await committed
  return existing ?? packet
}

const LEGACY_KEYS=['wanderwise-game-v1','wanderwise.collection.v1','wanderwise.reflections.v1','wanderwise.journey.v1','wanderwise-garden-recipes-v1']
export function initializePersonalSpace(){
  if(initialized)return initialized
  initialized=(async()=>{
    let recovered:PersonalData|undefined
    try {
      const stored=await readVault('profile')
      let data=stored?validatePersonalData(stored):emptyPersonalData()
      recovered=data
      const normalized=Boolean(stored&&JSON.stringify(stored)!==JSON.stringify(data))
      if(normalized)await writeVault(`backup-before-source-normalization:${Date.now()}`,stored)
      if(!data.migrated){
        const raw:Record<string,string>={}
        for(const key of LEGACY_KEYS){const value=localStorage.getItem(key);if(value){raw[key]=value;try{data.legacy[key]=JSON.parse(value)}catch{ /* Preserve unreadable originals in the backup. */ }}}
        await writeVault('legacy-backup-v1',raw)
        data=migrateLegacy(data)
        recovered=data
        await writeVault('profile',data)
        validatePersonalData(await readVault('profile'))
        data={...data,migrated:true};await writeVault('profile',data)
      }else if(normalized){
        await writeVault('profile',data)
        data=validatePersonalData(await readVault('profile'))
      }
      const seeded = applyCollectionSeed(data)
      if (seeded !== data) {
        await writeVault('backup-before-collection-seed-v1', data)
        recovered = validatePersonalData(seeded)
        // Collections and completion marker commit in the same IDB transaction.
        await writeVault('profile', recovered)
        data = validatePersonalData(await readVault('profile'))
      }
      usePersonalStore.setState({data,ready:true})
    }catch{
      const data=recovered??emptyPersonalData()
      for(const key of LEGACY_KEYS){try{const raw=localStorage.getItem(key);if(raw)data.legacy[key]=JSON.parse(raw)}catch{ /* Keep entry usable. */ }}
      usePersonalStore.setState({data:applyCollectionSeed(migrateLegacy(data)),ready:true,error:'本机存储暂不可用，收获暂存本次页面；请使用导出功能。'})
    }
  })();return initialized
}

export function migrateLegacy(data:PersonalData):PersonalData {
  const next=structuredClone(data)
  const game=(next.legacy['wanderwise-game-v1'] as {state?:{backpack?:Array<{id:string;workId:string;title:string;text:string;topicWord?:string;collectedAt:number}>;anchors?:Array<{id:string;text:string;mine:boolean;createdAt:number;topicWord?:string}>}})?.state
  for(const b of Array.isArray(game?.backpack)?game.backpack:[]){
    if(!b||typeof b.id!=='string'||typeof b.workId!=='string'||typeof b.title!=='string'||typeof b.text!=='string')continue
    const source:ContentSource={id:`work:${b.workId}`,title:b.title,author:'',summary:b.text,url:'',source:'知乎知识内容',kind:'excerpt',fetchedAt:legacyDate(b.collectedAt),legacyWorkId:b.workId,tags:typeof b.topicWord==='string'?[b.topicWord]:[]}
    next.sources[source.id]??=source
    if(!next.collections.some(c=>c.legacyId===b.id))next.collections.push({id:`legacy:${b.id}`,sourceId:source.id,excerpt:b.text,legacyId:b.id,createdAt:source.fetchedAt})
  }
  for(const a of Array.isArray(game?.anchors)?game.anchors:[]){if(a?.mine&&typeof a.id==='string'&&typeof a.text==='string'&&!next.notes.some(n=>n.id===`anchor:${a.id}`)){const date=legacyDate(a.createdAt);next.notes.push({id:`anchor:${a.id}`,title:typeof a.topicWord==='string'?a.topicWord:'我的想法',text:a.text,createdAt:date,updatedAt:date})}}
  const collection=next.legacy['wanderwise.collection.v1']
  if(Array.isArray(collection))for(const item of collection){
    if(!item||typeof item.id!=='string'||typeof item.title!=='string'||!['question','answer'].includes(item.type)||typeof item.questionId!=='string')continue
    const source=canonicalSource({id:`galaxy:${item.type}:${item.id}`,remoteId:typeof item.answerId==='string'?item.answerId:item.id,title:item.title,author:typeof item.author==='string'?item.author:'',summary:typeof item.excerpt==='string'?item.excerpt:'',url:typeof item.url==='string'?item.url:'',source:'知乎',kind:item.type==='question'?'question':'summary',fetchedAt:legacyDate(item.savedAt),galaxy:{id:item.id,type:item.type,questionId:item.questionId,answerId:typeof item.answerId==='string'?item.answerId:undefined,query:typeof item.query==='string'?item.query:''}})
    next.sources[source.id]=mergeSourceMetadata(next.sources[source.id],source)
    const id=`galaxy:${item.type}:${item.id}`
    if(!next.collections.some(c=>c.id===id))next.collections.push({id,sourceId:source.id,excerpt:source.summary,createdAt:source.fetchedAt})
  }
  const reflections=next.legacy['wanderwise.reflections.v1']
  if(Array.isArray(reflections))for(const n of reflections){if(n&&typeof n.id==='string'&&typeof n.text==='string'&&!next.notes.some(x=>x.id===n.id)){next.notes.push({id:n.id,title:typeof n.targetTitle==='string'?n.targetTitle:'星系手记',text:n.text,quote:typeof n.quote==='string'?n.quote:undefined,createdAt:legacyDate(n.createdAt),updatedAt:legacyDate(n.createdAt)})}}
  const recipes=next.legacy['wanderwise-garden-recipes-v1']
  if(Array.isArray(recipes))for(const r of recipes){
    if(r&&KNOWLEDGE_INGREDIENTS.some(i=>i.id===r.first)&&KNOWLEDGE_INGREDIENTS.some(i=>i.id===r.second)&&r.first!==r.second&&typeof r.firstPercent==='number'&&Number.isFinite(r.firstPercent)){
      const recipe=mixThoughtRecipe(r.first,r.second,r.firstPercent)
      if(!next.recipes.some(item=>item.id===recipe.id))next.recipes.push(recipe)
    }
  }
  return next
}

function mergePersonalImport(current:PersonalData,incoming:PersonalData):PersonalData {
  const merge=<T extends {id:string}>(a:T[],b:T[])=>[...new Map([...a,...b].map(x=>[x.id,x])).values()]
  const sources={...current.sources};for(const source of Object.values(incoming.sources))sources[source.id]=mergeSourceMetadata(sources[source.id],source)
  const data:PersonalData={...current,sources,collections:merge(current.collections,incoming.collections),notes:merge(current.notes,incoming.notes),works:merge(current.works,incoming.works),journeys:merge(current.journeys,incoming.journeys),galaxyVoyages:mergeGalaxyVoyages(current.galaxyVoyages,incoming.galaxyVoyages),recipes:merge(current.recipes,incoming.recipes),interests:[...new Set([...current.interests,...incoming.interests])],returnAnchor:current.returnAnchor??incoming.returnAnchor,legacy:{...current.legacy,...incoming.legacy}}
  if (current.collectionSeedVersions || incoming.collectionSeedVersions) data.collectionSeedVersions = [...new Set([...(current.collectionSeedVersions ?? []), ...(incoming.collectionSeedVersions ?? [])])]
  if(current.reading||incoming.reading){data.reading={...current.reading};for(const [id,progress] of Object.entries(incoming.reading??{})){if(!data.reading[id]||progress.updatedAt>data.reading[id].updatedAt)data.reading[id]=progress}}
  return data
}
export async function importPersonalSpace(raw:string){
  if(raw.length>12_000_000)throw new Error('个人空间文件过大')
  const incoming=validatePersonalData(JSON.parse(raw))
  // Imports share the profile queue with receipt acknowledgements and reading
  // updates. Never install a snapshot captured before those edits arrived.
  const committed=writes.catch(()=>{}).then(async()=>{
    await writeVault(`backup-before-import:${Date.now()}`,validatePersonalData(usePersonalStore.getState().data))
    for (;;) {
      const snapshot=usePersonalStore.getState().data
      const data=mergePersonalImport(validatePersonalData(snapshot),incoming)
      await writeVault('profile',data)
      validatePersonalData(await readVault('profile'))
      // State edits stay available while IndexedDB is working. If an export or
      // reader changed it, commit their merged data before publishing success.
      if(usePersonalStore.getState().data!==snapshot)continue
      usePersonalStore.setState({data})
      return
    }
  })
  writes=committed.catch(()=>{})
  await committed
}
export function exportPersonalSpace(){
  const data=JSON.stringify(usePersonalStore.getState().data,null,2);const url=URL.createObjectURL(new Blob([data],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`wanderwise-personal-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
