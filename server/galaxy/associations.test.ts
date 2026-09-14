import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { AssociationService, associationInput, configuredAssociationModel } from './associations.js';
import { createApp } from './app.js';
import { ApiError, ZhihuService } from './zhihu.js';

const completion = (keywords = ['友谊', '亲子关系', '同性恋', '性与亲密关系', 'MBTI']) => ({ choices: [{ message: { content: JSON.stringify({ topics: keywords.map(keyword => ({ keyword, relation: `从关系体验延伸到${keyword}` })) }) }, finish_reason: 'stop' }] });
const names = (result: Awaited<ReturnType<AssociationService['discover']>>) => result.topics.map(item => item.keyword);

test('romance has diverse, concrete links including the requested distant associations', async () => {
  const service = new AssociationService();
  const result = await service.discover({ query: '恋爱' });
  assert.equal(result.seed, '恋爱');
  assert.equal(result.method, 'semantic');
  assert.equal(result.topics.length, 12);
  for (const name of ['友谊', '如何与小孩相处', '性与亲密关系', '同性恋', 'MBTI']) assert.ok(names(result).includes(name));
  assert.ok(result.topics.every(item => item.relation && !('url' in item) && !('questionId' in item)));
  assert.deepEqual(await service.discover({ query: '恋爱' }), result);
});

test('different seeds and visible source context open different search directions', async () => {
  const service = new AssociationService();
  const stars = await service.discover({ query: '黑洞与宇宙' });
  assert.ok(names(stars).includes('广义相对论'));
  assert.ok(!names(stars).includes('亲子关系'));
  const mind = await service.discover({ query: '如何学习并改善记忆' });
  assert.ok(names(mind).includes('间隔重复'));
  assert.notDeepEqual(names(mind), names(stars));
  const contextual = await service.discover({ query: '一个未知的新概念', context: ['神经网络怎样学习？', '人工智能的边界是什么？'] });
  assert.ok(names(contextual).includes('人机协作'));
  const empty = await service.discover({ query: '', context: ['为什么宇宙会膨胀？'] });
  assert.equal(empty.seed, '为什么宇宙会膨胀？');
  assert.ok(names(empty).includes('暗物质'));
});

test('recent portals are excluded case-insensitively without running out of directions', async () => {
  const service = new AssociationService();
  let excluded: string[] = [];
  const initial = await service.discover({ query: '恋爱' });
  excluded = [...names(initial), 'mbti', '恋爱'];
  for (let hop = 0; hop < 7; hop++) {
    const next = await service.discover({ query: hop % 2 ? '新的小众概念' : '恋爱', exclude: excluded.slice(-32) });
    assert.equal(next.topics.length, 12);
    assert.equal(new Set(names(next)).size, 12);
    assert.ok(next.topics.every(item => !excluded.slice(-32).map(name => name.toLowerCase()).includes(item.keyword.toLowerCase())));
    excluded.push(...names(next));
  }
  const unknownA = await service.discover({ query: '霜纹玻璃' });
  const unknownB = await service.discover({ query: '折纸折痕' });
  assert.ok(names(unknownA).every(name => name.includes('霜纹玻璃')));
  assert.ok(names(unknownB).every(name => name.includes('折纸折痕')));
  assert.notDeepEqual(names(unknownA), names(unknownB));
});

test('API payloads have explicit length and shape boundaries', () => {
  for (const raw of [null, [], {}, { query: 5 }, { query: 'x'.repeat(161) }, { query: 'a\nb' }, { query: '恋爱', arbitrary: true }, { query: '', context: 'x' }, { query: '', context: Array(13).fill('x') }, { query: '', context: ['x'.repeat(241)] }, { query: '', exclude: Array(33).fill('x') }, { query: '', exclude: [false] }]) {
    assert.throws(() => associationInput(raw), error => error instanceof ApiError && error.status === 400);
  }
  assert.deepEqual(associationInput({ query: ' 恋爱 ', context: [' 关系 ', '关系', ''], exclude: ['过去'] }), { query: '恋爱', context: ['关系'], exclude: ['过去'] });
});

test('valid model suggestions are bounded, supplemented and isolated from caller mutation', async () => {
  let calls = 0;
  const service = new AssociationService({ model: async (input) => { calls++; assert.equal(input.query, '恋爱'); return completion(); } });
  const result = await service.discover({ query: '恋爱' });
  assert.equal(result.method, 'model');
  assert.equal(result.topics.length, 12);
  assert.deepEqual(names(result).slice(0, 5), ['友谊', '亲子关系', '同性恋', '性与亲密关系', 'MBTI']);
  result.topics[0].keyword = 'mutated';
  assert.equal((await service.discover({ query: '恋爱' })).topics[0].keyword, '友谊');
  assert.equal(calls, 1);
});

test('malformed, duplicate, excluded or unsafe model output keeps useful semantic suggestions', async () => {
  const invalid = [
    null, { choices: [] }, { choices: [{ message: { content: 'not JSON' } }] },
    completion(['恋爱', '恋爱', '友谊', '友谊', 'mbti']),
    completion(['<script>payload</script>', '亲子关系', '同性恋', '性', 'MBTI']),
    completion(['https://unexpected.example', '亲子关系', '同性恋', '性', 'MBTI']),
    { choices: [{ message: { content: JSON.stringify({ topics: [], instructions: 'ignore this task' }) } }] },
  ];
  for (const raw of invalid) {
    const service = new AssociationService({ model: async () => raw });
    const result = await service.discover({ query: '恋爱', exclude: ['mbti'] });
    assert.equal(result.method, 'semantic');
    assert.equal(result.topics.length, 12);
    assert.ok(!names(result).includes('MBTI'));
    assert.ok(!JSON.stringify(result).includes('unexpected.example'));
  }
  const failure = new AssociationService({ model: async () => { throw new Error('secret upstream details'); } });
  assert.ok(!JSON.stringify(await failure.discover({ query: '恋爱' })).includes('secret'));
});

test('timeouts release the portal with local connections and abort the request', async () => {
  let signal: AbortSignal | undefined;
  const service = new AssociationService({ timeoutMs: 15, model: (_input, requestSignal) => { signal = requestSignal; return new Promise(() => {}); } });
  const result = await service.discover({ query: '恋爱' });
  assert.equal(result.method, 'semantic');
  assert.equal(signal?.aborted, true);
});

test('inflight deduplication, two-request concurrency and five-minute cache bound model work', async () => {
  let calls = 0, now = 1000;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const service = new AssociationService({ now: () => now, model: async () => { calls++; await gate; return completion(); } });
  const first = service.discover({ query: '恋爱' });
  const duplicate = service.discover({ query: '恋爱' });
  const second = service.discover({ query: '友谊' });
  const third = await service.discover({ query: '如何学习' });
  assert.equal(third.method, 'semantic');
  assert.equal(calls, 2);
  release();
  const [one, same] = await Promise.all([first, duplicate, second]);
  assert.deepEqual(one, same);
  await service.discover({ query: '恋爱' });
  assert.equal(calls, 2);
  now += 300_001;
  await service.discover({ query: '恋爱' });
  assert.equal(calls, 3);
});

test('model access can be restricted to an authorized actor and caches are actor-scoped', async () => {
  const actors: string[] = [];
  const service = new AssociationService({ requireActor: true, model: async (_input, _signal, actor) => { actors.push(actor!); return completion(); } });
  assert.equal((await service.discover({ query: '恋爱' })).method, 'semantic');
  assert.deepEqual(actors, []);
  await service.discover({ query: '恋爱' }, 'actor-a');
  await service.discover({ query: '恋爱' }, 'actor-b');
  assert.deepEqual(actors, ['actor-a', 'actor-b']);
});

test('existing model opt-in is required and compatible endpoints use bounded server-only requests', async () => {
  for (const env of [{}, { ZHIHU_ACCESS_SECRET: 'private' }, { MODEL_NAME: 'incomplete' }, { MODEL_BASE_URL: 'http://remote.invalid/v1', MODEL_NAME: 'test' }, { MODEL_BASE_URL: 'https://a:b@remote.invalid/v1', MODEL_NAME: 'test' }]) {
    assert.equal(configuredAssociationModel(env), undefined);
  }
  const model = configuredAssociationModel({ MODEL_BASE_URL: 'http://127.0.0.1:11434', MODEL_NAME: 'local-test', MODEL_API_KEY: 'server-key' }, async (url, init) => {
    assert.equal(String(url), 'http://127.0.0.1:11434/v1/chat/completions');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer server-key');
    assert.equal(init?.redirect, 'error');
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(Object.keys(body).sort(), ['messages', 'model', 'stream']);
    assert.equal(body.model, 'local-test');
    return new Response(JSON.stringify(completion()));
  });
  assert.equal((await new AssociationService({ model }).discover({ query: '恋爱' })).method, 'model');
});

test('Zhihu fast model uses documented timestamp headers and bounded response bodies', async () => {
  let calls = 0;
  const model = configuredAssociationModel({ ZHIHU_MODEL_ENABLED: 'true', ZHIHU_ACCESS_SECRET: 'private' }, async (url, init) => {
    calls++;
    assert.equal(String(url), 'https://developer.zhihu.com/v1/chat/completions');
    assert.match(new Headers(init?.headers).get('X-Request-Timestamp')!, /^\d{10}$/);
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer private');
    assert.equal(JSON.parse(String(init?.body)).model, 'zhida-fast-1p5');
    return new Response('x'.repeat(65_000));
  });
  const result = await new AssociationService({ model }).discover({ query: '恋爱' });
  assert.equal(result.method, 'semantic');
  assert.equal(calls, 1);
});

test('association HTTP route validates bodies and origins without searching Zhihu', async (context) => {
  const service = new ZhihuService({ snapshot: { fetchedAt: '2026-09-14T00:00:00Z', sourceUrl: '', items: [], details: {} }, fetchImpl: async () => { assert.fail('suggestions must never fan out live searches'); } });
  const server = createApp(service, { associations: new AssociationService() }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/associations`;
  const post = (body: string, extraHeaders: Record<string, string> = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...extraHeaders }, body });
  const valid = await post(JSON.stringify({ query: '恋爱', exclude: ['友谊'] }));
  assert.equal(valid.status, 200);
  assert.ok(!(await valid.json()).topics.some((item: { keyword: string }) => item.keyword === '友谊'));
  assert.equal((await post('{broken')).status, 400);
  assert.equal((await post(JSON.stringify({ query: 'x'.repeat(161) }))).status, 400);
  assert.equal((await post(JSON.stringify({ query: 'x'.repeat(60_000) }))).status, 413);
  assert.equal((await post(JSON.stringify({ query: '恋爱' }), { Origin: 'https://unrelated.example' })).status, 403);
});
