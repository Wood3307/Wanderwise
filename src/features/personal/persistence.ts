import { z } from 'zod'
import type { ContentSource, PersonalData } from './types'
import { normalizeJourneyExport } from '../galaxy/lib/trip'
import { MAX_GALAXY_VOYAGES, mergeGalaxyVoyages } from './galaxyVoyageData'

const string = z.string().max(60_000)
const pose = z.object({ position: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]), yaw: z.number().finite(), pitch: z.number().finite() })
const ingredient = z.enum(['literature', 'photography', 'philosophy', 'nature', 'music'])
const recipe = z.object({ id: string, first: ingredient, second: ingredient, firstPercent: z.number().min(10).max(90), name: string, prompt: string })
const source = z.object({ contentType:z.enum(['answer','question','article','webpage']).optional(), id: string, remoteId: string.optional(), title: string, author: string, summary: string, url: string, source: string, kind: z.enum(['summary','article','question','excerpt','curated']), fetchedAt: string, tags: z.array(string).optional(), readingGuide: string.optional(), legacyWorkId: string.optional(), galaxy: z.object({id:string,type:z.enum(['question','answer']),questionId:string,answerId:string.optional(),query:string}).optional() })
const galaxyVoyage = z.unknown().transform((value, context) => {
  const packet = normalizeJourneyExport(value)
  if (!packet) { context.addIssue({ code: 'custom', message: '漫游足迹格式无效' }); return z.NEVER }
  return packet
})
export const personalSchema = z.object({
  version: z.literal(1), migrated: z.boolean(), sources: z.record(z.string(), source),
  collectionSeedVersions: z.array(z.string().max(100)).max(100).optional(),
  reading: z.record(z.string(), z.object({paragraph:z.number().int().min(0).max(100000),updatedAt:z.string().datetime()})).optional(),
  collections: z.array(z.object({id:string,sourceId:string,excerpt:string,createdAt:string,legacyId:string.optional()})).max(5000),
  notes: z.array(z.object({id:string,sourceId:string.optional(),title:string,text:string,quote:string.optional(),createdAt:string,updatedAt:string})).max(5000),
  works: z.array(z.object({id:string,title:string,text:string,sourceIds:z.array(string),journeyId:string.optional(),createdAt:string,kind:z.enum(['idea','journey'])})).max(2000),
  journeys: z.array(z.object({id:string,realmId:string,title:string,recipe,personalText:string,contentVersion:z.number(),sourceIds:z.array(string),createdAt:string,progress:z.object({visited:z.array(string),drafts:z.record(z.string(), string),completed:z.boolean(),pose:pose.optional(),activeStation:string.optional()})})).max(1000),
  galaxyVoyages: z.array(galaxyVoyage).max(MAX_GALAXY_VOYAGES).default([]),
  recipes:z.array(recipe),interests:z.array(string),returnAnchor:z.object({route:z.string().regex(/^\/(observatory|land|journey\/[a-z-]+)$/),label:string,journeyId:string.optional(),stationId:string.optional(),sourceId:string.optional(),pose:pose.optional()}).nullable(),
  poses:z.record(z.string(), pose),settings:z.object({mascotAnimated:z.boolean(),mascotHints:z.boolean(),muted:z.boolean()}),legacy:z.record(z.string(), z.unknown()),
})
export function safeSourceUrl(value: string): string {
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : '' } catch { return '' }
}
function cleanSourceUrl(value: string): string {
  const safe = safeSourceUrl(value)
  if (!safe) return ''
  const parsed = new URL(safe)
  parsed.hash = ''
  for (const key of [...parsed.searchParams.keys()]) if (/^(utm_|source$)/i.test(key)) parsed.searchParams.delete(key)
  return parsed.href
}
function zhihuAnswerId(value: string): string | undefined {
  const safe = safeSourceUrl(value)
  if (!safe) return
  const parsed = new URL(safe)
  if (!['zhihu.com', 'www.zhihu.com'].includes(parsed.hostname) || parsed.port) return
  return parsed.pathname.match(/^(?:\/question\/[0-9]{1,30})?\/answer\/([0-9]{1,30})\/?$/)?.[1]
}
export function canonicalSource(source: ContentSource): ContentSource {
  const url = safeSourceUrl(source.url)
  const answerId = zhihuAnswerId(url)
  const canonical = answerId ? `https://www.zhihu.com/answer/${answerId}` : cleanSourceUrl(url)
  return { ...source, remoteId: answerId && source.kind !== 'curated' ? `answer-${answerId}` : source.remoteId ?? source.id, id: canonical ? `url:${canonical}` : source.id, url }
}
/** Alias collisions merge source metadata only. Collection and note identities remain independent. */
export function mergeSourceMetadata(previous: ContentSource | undefined, incoming: ContentSource): ContentSource {
  if (!previous) return incoming
  if (previous.kind === 'curated' || incoming.kind === 'curated') {
    const curated = previous.kind === 'curated' ? previous : incoming
    const other = previous.kind === 'curated' ? incoming : previous
    const galaxy = curated.galaxy ?? other.galaxy
    return { ...other, ...curated, ...(galaxy ? { galaxy } : {}) }
  }
  const primary = Date.parse(incoming.fetchedAt) > Date.parse(previous.fetchedAt) ? incoming : previous
  const secondary = primary === previous ? incoming : previous
  const hasAuthor = (value: string) => Boolean(value && value !== '作者未提供')
  const galaxy = [primary.galaxy, secondary.galaxy].find((value) => value && /^question-[0-9]+$/.test(value.questionId)) ?? primary.galaxy ?? secondary.galaxy
  const tags = previous.tags || incoming.tags ? [...new Set([...(previous.tags ?? []), ...(incoming.tags ?? [])])] : undefined
  return { ...secondary, ...primary, author: hasAuthor(primary.author) ? primary.author : secondary.author, summary: primary.summary.length >= secondary.summary.length ? primary.summary : secondary.summary, ...(tags ? { tags } : {}), ...(galaxy ? { galaxy } : {}) }
}
let database: Promise<IDBDatabase> | undefined
function openDatabase(): Promise<IDBDatabase> {
  if (!database) database = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('浏览器不支持个人空间存储')); return }
    const request = indexedDB.open('wanderwise-personal', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('vault')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('请关闭旧页面后重试'))
  })
  return database
}
export async function readVault(key: string): Promise<unknown> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => { const r = db.transaction('vault').objectStore('vault').get(key); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
}
export async function writeVault(key: string, value: unknown): Promise<void> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => { const tx = db.transaction('vault', 'readwrite'); tx.objectStore('vault').put(value, key); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error) })
}
export function emptyPersonalData(): PersonalData {
  return {version:1,migrated:false,sources:{},collections:[],notes:[],works:[],journeys:[],galaxyVoyages:[],recipes:[],interests:[],returnAnchor:null,poses:{},settings:{mascotAnimated:true,mascotHints:true,muted:true},legacy:{}}
}
export function validatePersonalData(value: unknown): PersonalData {
  const result = personalSchema.parse(value) as PersonalData
  result.galaxyVoyages = mergeGalaxyVoyages([], result.galaxyVoyages)
  const aliases = new Map<string, string>()
  const normalized: Record<string, ContentSource> = {}
  for (const [key, item] of Object.entries(result.sources)) {
    const canonical = canonicalSource(item)
    const oldUrl = cleanSourceUrl(item.url)
    const oldId = oldUrl ? `url:${oldUrl}` : item.id
    // v1 used the full source URL. Accept that exact former identity as well as today's identity.
    if (key !== item.id || (key !== canonical.id && key !== oldId)) throw new Error('导入文件的来源身份不一致')
    aliases.set(key, canonical.id)
    const converted = { ...item, id: canonical.id, url: canonical.url, ...(zhihuAnswerId(item.url) ? { remoteId: canonical.remoteId } : {}) }
    normalized[canonical.id] = mergeSourceMetadata(normalized[canonical.id], converted)
  }
  const remap = (id: string) => aliases.get(id) ?? id
  result.sources = normalized
  if (result.reading) {
    const reading: NonNullable<PersonalData['reading']> = {}
    for (const [alias, progress] of Object.entries(result.reading)) {
      const id = remap(alias)
      if (normalized[id] && (!reading[id] || progress.updatedAt > reading[id].updatedAt)) reading[id] = progress
    }
    result.reading = reading
  }
  result.collections = result.collections.map((item) => ({ ...item, sourceId: remap(item.sourceId) }))
  result.notes = result.notes.map((note) => note.sourceId ? { ...note, sourceId: remap(note.sourceId) } : note)
  result.works = result.works.map((work) => ({ ...work, sourceIds: [...new Set(work.sourceIds.map(remap))] }))
  result.journeys = result.journeys.map((journey) => ({ ...journey, sourceIds: [...new Set(journey.sourceIds.map(remap))] }))
  if (result.returnAnchor?.sourceId) result.returnAnchor = { ...result.returnAnchor, sourceId: remap(result.returnAnchor.sourceId) }
  if (result.collections.some(item => !result.sources[item.sourceId])) throw new Error('导入文件缺少收藏对应的来源')
  if (result.notes.some(n=>n.sourceId&&!result.sources[n.sourceId]) || [...result.works,...result.journeys].some(w=>w.sourceIds.some(id=>!result.sources[id]))) throw new Error('导入文件缺少笔记或作品引用的来源')
  if (result.returnAnchor?.sourceId && !result.sources[result.returnAnchor.sourceId]) throw new Error('导入文件缺少返回位置对应的来源')
  return result
}
