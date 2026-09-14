import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCollectionTree } from './collectionTree'
import type { CollectionRecord, ContentSource, PersonalData } from './types'

const at = '2026-09-14T05:30:00.000Z'
function empty(): PersonalData {
  return { version: 1, migrated: true, sources: {}, collections: [], notes: [], works: [], journeys: [], galaxyVoyages: [], recipes: [], interests: [], returnAnchor: null,
    poses: {}, settings: { mascotAnimated: false, mascotHints: false, muted: true }, legacy: {} }
}
function source(id: string, overrides: Partial<ContentSource> = {}): ContentSource {
  return { id, title: `真实标题 ${id}`, author: '原作者', summary: `来源摘要 ${id}`, url: `https://example.org/${id}`, source: '公开来源', kind: 'summary', fetchedAt: at, ...overrides }
}
function collection(id: string, sourceId: string, excerpt = ''): CollectionRecord { return { id, sourceId, excerpt, createdAt: at } }
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value) }
  return value
}

test('an empty collection tree does not manufacture leaves from interests, notes or works', () => {
  const data = empty()
  data.interests = ['文学', '摄影']
  data.notes = [{ id: 'note', title: '尚未收藏的想法', text: '私人手记', createdAt: at, updatedAt: at }]
  data.works = [{ id: 'work', title: '作品', text: '私人作品', sourceIds: [], createdAt: at, kind: 'idea' }]
  assert.deepEqual(buildCollectionTree(deepFreeze(data)), [])
})

test('journey ingredient identifiers use the same Chinese topic names as the bar', () => {
  const data = empty()
  data.sources.a = source('a', { tags: ['literature'] })
  data.sources.b = source('b', { tags: ['文学'] })
  data.collections = [collection('a-leaf', 'a'), collection('b-leaf', 'b')]
  const topics = buildCollectionTree(deepFreeze(data))
  assert.equal(topics.length, 1)
  assert.equal(topics[0].label, '文学')
  assert.equal(topics[0].leaves.length, 2)
})

test('topics prefer the first nonempty tag, then the galaxy query, then 未归枝', () => {
  const data = empty()
  data.sources.a = source('a', { tags: ['', '  ', ' 摄影 ', '文学'], galaxy: { id: 'a', type: 'question', questionId: 'a', query: '不应优先的检索' } })
  data.sources.b = source('b', { tags: ['\t', '\n'], galaxy: { id: 'b', type: 'question', questionId: 'b', query: ' 月光与自然 ' } })
  data.sources.c = source('c', { galaxy: { id: 'c', type: 'answer', questionId: 'q', query: ' \n ' } })
  data.sources.d = source('d')
  data.collections = ['a', 'b', 'c', 'd'].map(id => collection(`saved-${id}`, id))
  const topics = buildCollectionTree(deepFreeze(data))
  assert.deepEqual(topics.map(topic => topic.label), ['摄影', '月光与自然', '未归枝'])
  assert.deepEqual(topics.map(topic => topic.leaves.map(leaf => leaf.id)), [['saved-a'], ['saved-b'], ['saved-c', 'saved-d']])
  assert.equal(topics.flatMap(topic => topic.leaves).length, data.collections.length)
})

test('invalid legacy tag values are skipped without discarding a collection', () => {
  const data = empty()
  data.sources.a = source('a', { tags: [null, 3, false, ' ', '海洋'] as unknown as string[] })
  data.collections = [collection('saved', 'a')]
  assert.equal(buildCollectionTree(data)[0].label, '海洋')
  assert.equal(buildCollectionTree(data)[0].leaves[0].id, 'saved')
})

test('a missing source remains an explicit leaf including prototype-like source ids', () => {
  const data = empty()
  data.collections = [collection('missing', 'deleted-source', '仍需保留的摘录'), collection('prototype-key', 'toString')]
  const [topic] = buildCollectionTree(deepFreeze(data))
  assert.equal(topic.label, '未归枝')
  assert.equal(topic.leaves.length, 2)
  assert.deepEqual(topic.leaves[0], { id: 'missing', sourceId: 'deleted-source', title: '来源已缺失', excerpt: '仍需保留的摘录', excerptKind: 'excerpt', source: undefined, createdAt: at })
  assert.equal(topic.leaves[1].source, undefined)
  assert.equal(topic.leaves[1].title, '来源已缺失')
  assert.equal(topic.leaves[1].excerptKind, 'none')
})

test('each collection is one leaf even when source ids or stored excerpts repeat', () => {
  const data = empty()
  data.sources.a = source('a', { tags: ['自然'], summary: '官方返回摘要' })
  data.collections = [collection('summary-save', 'a', '官方返回摘要'), collection('quote-one', 'a', '第一段摘录'), collection('quote-two', 'a', '第二段摘录'), collection('same-quote-different-record', 'a', '第一段摘录')]
  data.collections[1].createdAt = '2026-09-14T05:31:00.000Z'
  const [topic] = buildCollectionTree(deepFreeze(data))
  assert.deepEqual(topic.leaves.map(leaf => leaf.id), data.collections.map(item => item.id))
  assert.deepEqual(topic.leaves.map(leaf => leaf.excerpt), data.collections.map(item => item.excerpt))
  assert.deepEqual(topic.leaves.map(leaf => leaf.createdAt), data.collections.map(item => item.createdAt))
  assert.deepEqual(topic.leaves.map(leaf => leaf.excerptKind), ['summary', 'excerpt', 'excerpt', 'excerpt'])
  assert.ok(topic.leaves.every(leaf => leaf.source === data.sources.a))
})

test('summary classification is conservative while original titles, summaries and excerpts remain exact', () => {
  const data = empty()
  data.sources.a = source('a', { title: '  诗与光影\n原题  ', summary: '  这是一份摘要。\n', tags: ['文学'] })
  data.collections = [collection('same-summary', 'a', '这是一份摘要。'), collection('retained-spacing', 'a', '  单独保存的文字\n'), collection('blank', 'a', ' \n\t')]
  const before = structuredClone(data)
  const leaves = buildCollectionTree(deepFreeze(data))[0].leaves
  assert.deepEqual(leaves.map(leaf => leaf.excerptKind), ['summary', 'excerpt', 'none'])
  assert.ok(leaves.every(leaf => leaf.title === before.sources.a.title))
  assert.equal(leaves[1].excerpt, before.collections[1].excerpt)
  assert.equal(leaves[2].excerpt, ' \n\t')
  assert.equal(leaves[0].source?.summary, before.sources.a.summary)
  assert.deepEqual(data, before)
})

test('Unicode and long labels retain their full text and stable ids independent of input order', () => {
  const labels = ['摄影 🌌 / 月光', 'Café 与 Café', '自然与文学的交叉问题'.repeat(20), '__proto__', 'a/b', 'a%2Fb', '\ud800']
  const data = empty()
  labels.forEach((label, i) => { data.sources[`s${i}`] = source(`s${i}`, { tags: [label] }); data.collections.push(collection(`c${i}`, `s${i}`)) })
  const topics = buildCollectionTree(deepFreeze(data))
  assert.deepEqual(topics.map(topic => topic.label), labels)
  assert.equal(new Set(topics.map(topic => topic.id)).size, labels.length)
  assert.ok(topics.every(topic => /^collection-topic:[a-f0-9-]+$/.test(topic.id)))
  const reversed = buildCollectionTree({ ...data, collections: [...data.collections].reverse() })
  for (const topic of topics) assert.equal(reversed.find(item => item.label === topic.label)?.id, topic.id)
  assert.deepEqual(buildCollectionTree(data), topics)
})

test('removing a collection only removes that leaf and does not mutate other collections or notes', () => {
  const data = empty()
  data.sources.a = source('a', { tags: ['自然'] }); data.sources.b = source('b', { tags: ['摄影'] })
  data.collections = [collection('remove-me', 'a', '第一段'), collection('keep-same-source', 'a', '第二段'), collection('keep-other-source', 'b', '另一来源')]
  data.notes = [{ id: 'independent-note', sourceId: 'a', title: '自己的判断', text: '取消收藏也保留这条手记', quote: '第一段', createdAt: at, updatedAt: at }]
  const before = structuredClone(data)
  const originalTopics = buildCollectionTree(deepFreeze(data))
  const after = { ...data, collections: data.collections.filter(item => item.id !== 'remove-me') }
  const remaining = buildCollectionTree(deepFreeze(after))
  assert.deepEqual(remaining.flatMap(topic => topic.leaves.map(leaf => leaf.id)), ['keep-same-source', 'keep-other-source'])
  remaining.forEach(topic => {
    const original = originalTopics.find(item => item.id === topic.id)!
    assert.deepEqual(topic.leaves, original.leaves.filter(leaf => leaf.id !== 'remove-me'))
  })
  assert.deepEqual(data, before)
  assert.deepEqual(after.notes, before.notes)
  assert.equal(after.notes, data.notes)
  assert.equal(after.sources, data.sources)
  const onlyOther = buildCollectionTree({ ...after, collections: after.collections.filter(item => item.sourceId === 'b') })
  assert.equal(onlyOther[0].id, remaining.find(topic => topic.label === '摄影')!.id)
})
