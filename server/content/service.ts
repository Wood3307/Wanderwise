/* eslint-disable no-control-regex -- Validate text before passing it as an argument value. */
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { ApiError, plainText, safeZhihuUrl } from '../galaxy/zhihu.js';
import { sourcePrefix } from '../galaxy/source-format.js';
import { createCliRunner, defaultCliPath } from './cli.js';
import type { CliRunner } from './cli.js';
import { ContentStore, digest } from './store.js';
import type { ContentItem, ContentResponse, SearchContext } from './types.js';

export function contentQuery(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) throw new ApiError(400, 'INVALID_QUERY', '请输入不超过 200 字的单行检索词。');
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ');
}
function webUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port || !url.hostname.includes('.')) return undefined;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^utm_|^(spm|source)$/i.test(key)) url.searchParams.delete(key);
    return url.href;
  } catch { return undefined; }
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

export function normalizeItems(raw: unknown, source: 'zhihu' | 'global', kind: ContentItem['kind'], fetchedAt: string, questionId?: string): ContentResponse {
  const payload = record(raw);
  const data = record(payload.Data ?? payload.data);
  const entries = data.Items ?? data.items ?? data.Answers ?? data.answers;
  if (!Array.isArray(entries)) throw new ApiError(502, 'UPSTREAM_INVALID_RESPONSE', '知乎返回的内容结构无法识别。');
  const unique = new Map<string, ContentItem>();
  for (const [index, entry] of entries.slice(0, 50).entries()) {
    const value = record(entry);
    const rawUrl = value.Url ?? value.URL ?? value.url ?? value.AnswerUrl;
    const validated = source === 'zhihu' ? safeZhihuUrl(rawUrl) : webUrl(rawUrl);
    if (!validated) continue;
    const url = webUrl(validated)!;
    const pathname = new URL(url).pathname;
    const actualQuestionId = pathname.match(/^\/question\/(\d+)/)?.[1];
    if (questionId && actualQuestionId && actualQuestionId !== questionId) continue;
    const contentType = source === 'global' ? 'webpage' : /\/answer\//.test(pathname) ? 'answer' : /^\/p\//.test(pathname) ? 'article' : 'question';
    if (kind === 'answer_summary' && contentType !== 'answer') continue;
    const number = pathname.match(/\/(\d+)\/?$/)?.[1];
    const id = source === 'global' ? `web-${digest(url).slice(0, 20)}` : `${contentType}-${number}`;
    if (kind === 'hot_summary' && unique.has(id)) continue;
    const author = record(value.Author);
    const title = sourcePrefix(plainText(value.Title ?? value.title ?? value.QuestionTitle), 400) || (kind === 'answer_summary' ? `${plainText(value.AuthorName ?? author.Name) || '知乎作者'}的回答` : '');
    if (!title) continue;
    unique.set(id, {
      id, title, author: plainText(value.AuthorName ?? author.Name ?? author.name ?? value.author ?? value.SiteName).slice(0, 120) || '作者未提供',
      summary: sourcePrefix(plainText(value.ContentText ?? value.Summary ?? value.Snippet ?? value.summary ?? value.snippet, true), 12_000),
      url, source, kind, contentType, fetchedAt,
      ...((actualQuestionId ?? questionId) ? { questionId: actualQuestionId ?? questionId } : {}),
      ...(kind === 'hot_summary' ? { hotRank: index + 1 } : {}),
    });
  }
  const paging = record(data.Paging ?? data.paging);
  return { items: [...unique.values()], cached: false, fetchedAt, notice: '内容为来源提供的摘要或截取文本，并非全文。请打开原文查看完整内容。',
    ...(Object.keys(paging).length ? { paging: { isEnd: Boolean(paging.IsEnd ?? paging.is_end), ...(Number.isInteger(paging.NextOffset) ? { nextOffset: Number(paging.NextOffset) } : {}) } } : {}) };
}

export interface ContentServiceOptions {
  store: ContentStore; runner?: CliRunner; cliPath?: string; now?: () => number;
  globalLimit?: number; visitorLimit?: number; configured?: boolean;
}
export class ContentService {
  readonly store: ContentStore;
  readonly runner: CliRunner;
  readonly configured: boolean;
  private readonly now: () => number;
  private readonly globalLimit: number;
  private readonly visitorLimit: number;
  private readonly pending = new Map<string, Promise<ContentResponse>>();
  private queue: Promise<void> = Promise.resolve();
  constructor(options: ContentServiceOptions) {
    this.store = options.store;
    this.runner = options.runner ?? createCliRunner(options.cliPath);
    this.configured = options.configured ?? Boolean(options.runner || existsSync(options.cliPath ?? process.env.ZHIHU_CLI_PATH ?? defaultCliPath));
    this.now = options.now ?? Date.now;
    this.globalLimit = options.globalLimit ?? 200;
    this.visitorLimit = options.visitorLimit ?? 20;
  }
  private request(key: string, args: string[], context: SearchContext, source: 'zhihu' | 'global', kind: ContentItem['kind'], questionId?: string): Promise<ContentResponse> {
    const cached = this.store.get(key);
    if (cached && !context.refresh) return Promise.resolve(cached);
    const pending = this.pending.get(key);
    if (pending) return pending;
    if (!this.configured) return Promise.reject(new ApiError(503, 'ZHIHU_CLI_UNAVAILABLE', '实时搜索尚未连接，精选内容和已有缓存仍可使用。'));
    if (this.pending.size >= 6) return Promise.reject(new ApiError(429, 'SEARCH_BUSY', '正在处理较多检索，请稍后再试。'));
    // Reserve both budgets atomically before invoking the upstream. Failures still cost an attempt.
    this.store.reserve('search', context.visitorId, this.globalLimit, this.visitorLimit);
    const task = this.queue.then(async () => {
      const value = normalizeItems(await this.runner(args), source, kind, new Date(this.now()).toISOString(), questionId);
      this.store.put(key, value);
      return value;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    this.queue = task.then(() => {}, () => {});
    return task;
  }
  search(rawQuery: unknown, provider: 'zhihu' | 'global', context: SearchContext): Promise<ContentResponse> {
    const query = contentQuery(rawQuery);
    if (!['zhihu', 'global'].includes(provider)) throw new ApiError(400, 'INVALID_PROVIDER', '请选择知乎或全网搜索。');
    return this.request(`search:${provider}:${digest(query)}`, ['search', provider, `--query=${query}`, '--count', '10'], context, provider, 'search_summary');
  }
  hot(context: SearchContext): Promise<ContentResponse> {
    return this.request('hot:zhihu:20', ['hot', '--limit', '20'], context, 'zhihu', 'hot_summary');
  }
  answers(questionId: string, context: SearchContext, offset = 0): Promise<ContentResponse> {
    if (!/^\d{1,30}$/.test(questionId) || !Number.isInteger(offset) || offset < 0 || offset > 1000) throw new ApiError(400, 'INVALID_QUESTION_ID', '问题编号或分页无效。');
    return this.request(`answers:${questionId}:${offset}`, ['question', 'answers', '--question-url', `https://www.zhihu.com/question/${questionId}`, '--offset', String(offset), '--limit', '20'], context, 'zhihu', 'answer_summary', questionId);
  }
  /** Build-time reviewed local source manifest, never browser-supplied source claims. */
  registerCurated(raw: unknown): number {
    if (!Array.isArray(raw)) throw new Error('Curated source manifest must be an array');
    const items: ContentItem[] = raw.map((entry) => {
      const value = record(entry);
      const url = webUrl(value.url);
      if (typeof value.id !== 'string' || !/^curated-[a-z0-9-]+$/.test(value.id) || !url || !plainText(value.title) || !plainText(value.summary)) throw new Error('Invalid curated source');
      return { id: value.id, title: plainText(value.title), author: plainText(value.author) || '作者未提供', summary: plainText(value.summary), url, source: 'global', kind: 'curated', contentType: 'webpage', fetchedAt: typeof value.fetchedAt === 'string' && Number.isFinite(Date.parse(value.fetchedAt)) ? value.fetchedAt : new Date(this.now()).toISOString() };
    });
    this.store.put('curated:manifest:v1', { items, cached: true, fetchedAt: new Date(this.now()).toISOString(), notice: '人工核验来源的导读摘要，并非原文全文。' });
    return items.length;
  }
  /** Reads ONLY the legacy public cache table; never opens user, note or favorite records. */
  importLegacy(path: string): { imported: number; skipped: number } {
    if (!existsSync(path)) return { imported: 0, skipped: 0 };
    const marker = `legacy:${digest(path)}`;
    if (this.store.db.prepare('SELECT value FROM metadata WHERE key=?').get(marker)) return { imported: 0, skipped: 0 };
    const old = new DatabaseSync(path, { readOnly: true });
    let imported = 0, skipped = 0;
    try {
      const hasCache = old.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cache'").get();
      if (!hasCache) return { imported, skipped };
      const rows = old.prepare("SELECT key,data FROM cache WHERE key LIKE 'zhihu:v1:%' LIMIT 10000").all();
      for (const row of rows) {
        try {
          const entries = JSON.parse(String(row.data));
          if (!Array.isArray(entries)) { skipped++; continue; }
          const items: ContentItem[] = entries.flatMap((raw) => {
            const value = record(raw);
            if (value.source !== 'zhihu' || value.kind !== 'search_summary' || value.verifiedQuote === true || !safeZhihuUrl(value.url)) return [];
            const at = typeof value.retrievedAt === 'number' ? new Date(value.retrievedAt * 1000).toISOString() : new Date(0).toISOString();
            return normalizeItems({ Data: { Items: [{ Title: value.title, Url: value.url, ContentText: value.text, AuthorName: value.author }] } }, 'zhihu', 'search_summary', at).items;
          });
          if (!items.length) { skipped++; continue; }
          this.store.put(`search:zhihu:${String(row.key).slice('zhihu:v1:'.length)}`, { items, cached: true, fetchedAt: items[0].fetchedAt, notice: '来自旧项目保留的知乎搜索摘要。' });
          imported++;
        } catch { skipped++; }
      }
      this.store.db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run(marker, JSON.stringify({ imported, skipped, at: this.now() }));
    } finally { old.close(); }
    return { imported, skipped };
  }
}
