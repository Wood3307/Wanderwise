/* eslint-disable no-control-regex -- Reject control bytes at the API input boundary. */
import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ApiError, ZhihuService } from './zhihu.js';
import { enrichHighlights, extractHighlights, getModelStatus } from './highlights.js';
import { AccessService, cookies } from '../content/access.js';
import type { SynthesisService } from '../content/synthesis.js';
import type { SearchContext } from '../content/types.js';
import { AssociationService, associationPrompt } from './associations.js';

function exploreQuery(raw: unknown): string {
  if (raw !== undefined && typeof raw !== 'string') throw new ApiError(400, 'INVALID_QUERY', '请提供单个探索问题。');
  const query = typeof raw === 'string' ? raw.trim() : '';
  if (query.length > 160 || /[\u0000-\u001f\u007f]/.test(query)) throw new ApiError(400, 'INVALID_QUERY', '探索问题需为不超过 160 字的单行文字。');
  return query;
}

export function createApp(service: ZhihuService, options: { distDir?: string; refreshPublic?: boolean; access?: AccessService; synthesis?: SynthesisService; associations?: AssociationService } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.use(express.json({ limit: '48kb', strict: true }));
  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
  // Bound API use per client without trusting client-supplied forwarding headers.
  const clients = new Map<string, { startsAt: number; count: number }>();
  app.use('/api', (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    const parsed = cookies(request.headers.cookie);
    const visitor = options.access?.visitor(parsed.mirror_visitor);
    const secureCookie = request.secure || request.get('x-forwarded-proto') === 'https';
    if (visitor?.cookie) response.cookie('mirror_visitor', visitor.cookie, { httpOnly: true, sameSite: 'lax', secure: secureCookie, maxAge: 365 * 86400_000, path: '/' });
    response.locals.visitorId = visitor?.id ?? request.ip ?? 'local';
    const key = response.locals.visitorId;
    const now = Date.now();
    let client = clients.get(key);
    if (!client || now - client.startsAt >= 60_000) {
      if (clients.size >= 1000) clients.delete(clients.keys().next().value!);
      client = { startsAt: now, count: 0 };
      clients.set(key, client);
    }
    if (++client.count > 90) {
      response.setHeader('Retry-After', '60');
      next(new ApiError(429, 'RATE_LIMITED', '请求较频繁，请稍后再试。'));
      return;
    }
    next();
  });
  app.get('/api/health', (_request, response) => {
    response.json({ ok: true, configured: service.configured, publicCount: service.publicCount, model: getModelStatus(), content: { configured: Boolean(service.content?.configured), cache: service.content ? 'sqlite' : 'memory' }, synthesis: { configured: Boolean(options.synthesis && service.content?.configured), accessRequired: false } });
  });
  const context = (response: express.Response, refresh: unknown): SearchContext => {
    if (refresh !== undefined && refresh !== 'true' && refresh !== 'false') throw new ApiError(400, 'INVALID_REFRESH', 'refresh 仅支持 true 或 false。');
    return { visitorId: response.locals.visitorId, refresh: refresh === 'true' };
  };
  const mutationOrigin = (request: express.Request) => {
    // Public access does not allow a different site to trigger a paid operation.
    const origin = request.get('origin');
    let sameHost = true;
    if (origin) { try { sameHost = new URL(origin).host === request.get('host'); } catch { sameHost = false; } }
    if (request.get('sec-fetch-site') === 'cross-site' || !sameHost) throw new ApiError(403, 'CROSS_ORIGIN_REQUEST', '请从当前项目页面发起操作。');
  };
  // Direct visitors use the same signed identity and configured daily AI limits
  // as synthesis. One optional CLI answer expands the ideas; destinations are
  // searched only after the traveler chooses one. Unavailable/exhausted AI keeps
  // the local semantic exploration usable.
  const associations = options.associations ?? new AssociationService({ requireActor: true, model: service.content?.configured && options.synthesis ? async (input, _signal, actor) => {
    const content = service.content!;
    options.synthesis!.reserveBudget(actor!);
    return content.runner(['answer', `--query=${associationPrompt(input)}`, '--model', 'zhida-fast-1p5', '--output', 'json'], 10_000);
  } : undefined });
  app.post('/api/associations', async (request, response, next) => {
    try {
      mutationOrigin(request);
      const actor = response.locals.visitorId as string;
      response.json(await associations.discover(request.body, actor));
    } catch (error) { next(error); }
  });
  app.get('/api/search', async (request, response, next) => {
    try {
      if (!service.content) throw new ApiError(503, 'CONTENT_UNAVAILABLE', '统一检索服务尚未连接。');
      const provider = request.query.provider ?? 'zhihu';
      if (provider !== 'zhihu' && provider !== 'global') throw new ApiError(400, 'INVALID_PROVIDER', '请选择知乎或全网搜索。');
      response.json(await service.content.search(request.query.q, provider, context(response, request.query.refresh)));
    } catch (error) { next(error); }
  });
  app.get('/api/hot', async (request, response, next) => {
    try {
      if (!service.content) throw new ApiError(503, 'CONTENT_UNAVAILABLE', '热点服务尚未连接。');
      response.json(await service.content.hot(context(response, request.query.refresh)));
    } catch (error) { next(error); }
  });
  app.post('/api/synthesis', async (request, response, next) => {
    try {
      mutationOrigin(request);
      if (!options.synthesis) throw new ApiError(503, 'AI_UNAVAILABLE', 'AI 服务暂未连接。');
      const actor = response.locals.visitorId as string;
      response.json(await options.synthesis.generate(request.body, actor));
    } catch (error) { next(error); }
  });
  app.get('/api/explore', async (request, response, next) => {
    try {
      const query = exploreQuery(request.query.q);
      const mode = request.query.mode;
      if (mode !== undefined && mode !== 'public') throw new ApiError(400, 'INVALID_MODE', '请选择有效的探索来源。');
      if (mode === 'public' && options.refreshPublic !== false) void service.refreshPublic();
      response.json(await service.explore(query, context(response, undefined), mode));
    } catch (error) { next(error); }
  });
  app.get('/api/questions/:questionId', async (request, response, next) => {
    try { response.json(await service.question(request.params.questionId, exploreQuery(request.query.q), context(response, undefined))); }
    catch (error) { next(error); }
  });
  app.get('/api/answers/:answerId/highlights', async (request, response, next) => {
    try {
      const query = exploreQuery(request.query.q);
      const questionId = request.query.questionId;
      if (typeof questionId !== 'string') throw new ApiError(400, 'INVALID_QUESTION_ID', '请选择文章所属的问题。');
      const answer = await service.findAnswer(request.params.answerId, questionId, query, context(response, undefined));
      // Public reading remains free of AI consumption; explicit generation has a separate budgeted endpoint.
      response.json(options.synthesis ? { answerId: answer.id, highlights: extractHighlights(answer, query), method: 'extractive' } : await enrichHighlights(answer, query));
    } catch (error) { next(error); }
  });
  app.get('/api/knowledge/:workId', async (request, response, next) => {
    try { response.json(await service.knowledge(request.params.workId)); }
    catch (error) { next(error); }
  });
  app.use('/api', (_request, _response, next) => next(new ApiError(404, 'NOT_FOUND', '该接口不存在。')));
  const distDir = resolve(options.distDir ?? 'dist');
  if (existsSync(resolve(distDir, 'index.html'))) {
    // /galaxy is a client route as well as an asset directory; do not redirect it to /galaxy/.
    app.use(express.static(distDir, { index: false, redirect: false }));
    app.get(['/', '/home', '/observatory', '/galaxy', '/world', '/canvas', '/land', '/journey/:realmId'], (_request, response) => response.sendFile(resolve(distDir, 'index.html')));
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express requires all four arguments to recognize an error handler.
  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    const safe = error instanceof ApiError ? error : error?.type === 'entity.parse.failed' ? new ApiError(400, 'INVALID_JSON', '请求内容不是有效 JSON。') : error?.type === 'entity.too.large' ? new ApiError(413, 'BODY_TOO_LARGE', '提交的材料过长。') : new ApiError(500, 'INTERNAL_ERROR', '服务暂时无法完成请求，请稍后重试。');
    response.status(safe.status).json({ error: safe.code, message: safe.message, ...(safe.upstreamStatus ? { upstreamStatus: safe.upstreamStatus } : {}) });
  };
  app.use(errorHandler);
  return app;
}
