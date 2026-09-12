import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ApiError, ZhihuService } from './zhihu.js';
import { enrichHighlights, getModelStatus } from './highlights.js';

function exploreQuery(raw: unknown): string {
  if (raw !== undefined && typeof raw !== 'string') throw new ApiError(400, 'INVALID_QUERY', '请提供单个探索问题。');
  const query = (raw ?? '').trim();
  if (query.length > 160 || /[\u0000-\u001f\u007f]/.test(query)) throw new ApiError(400, 'INVALID_QUERY', '探索问题需为不超过 160 字的单行文字。');
  return query;
}

export function createApp(service: ZhihuService, options: { distDir?: string; refreshPublic?: boolean } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
  // Bound API use per client without trusting client-supplied forwarding headers.
  const clients = new Map<string, { startsAt: number; count: number }>();
  app.use('/api', (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    const key = request.ip || 'local';
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
    response.json({ ok: true, configured: service.configured, publicCount: service.publicCount, model: getModelStatus() });
  });
  app.get('/api/explore', async (request, response, next) => {
    try {
      const query = exploreQuery(request.query.q);
      if (options.refreshPublic !== false) void service.refreshPublic();
      response.json(await service.explore(query));
    } catch (error) { next(error); }
  });
  app.get('/api/questions/:questionId', async (request, response, next) => {
    try { response.json(await service.question(request.params.questionId, exploreQuery(request.query.q))); }
    catch (error) { next(error); }
  });
  app.get('/api/answers/:answerId/highlights', async (request, response, next) => {
    try {
      const query = exploreQuery(request.query.q);
      const questionId = request.query.questionId;
      if (typeof questionId !== 'string') throw new ApiError(400, 'INVALID_QUESTION_ID', '请选择文章所属的问题。');
      const answer = await service.findAnswer(request.params.answerId, questionId, query);
      response.json(await enrichHighlights(answer, query));
    } catch (error) { next(error); }
  });
  app.get('/api/knowledge/:workId', async (request, response, next) => {
    try { response.json(await service.knowledge(request.params.workId)); }
    catch (error) { next(error); }
  });
  app.use('/api', (_request, _response, next) => next(new ApiError(404, 'NOT_FOUND', '该接口不存在。')));
  const distDir = resolve(options.distDir ?? 'dist');
  if (existsSync(resolve(distDir, 'index.html'))) {
    app.use(express.static(distDir, { index: false }));
    app.get('*', (_request, response) => response.sendFile(resolve(distDir, 'index.html')));
  }
  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    const safe = error instanceof ApiError ? error : new ApiError(500, 'INTERNAL_ERROR', '服务暂时无法完成请求，请稍后重试。');
    response.status(safe.status).json({ error: safe.code, message: safe.message, ...(safe.upstreamStatus ? { upstreamStatus: safe.upstreamStatus } : {}) });
  };
  app.use(errorHandler);
  return app;
}
