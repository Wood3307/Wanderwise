import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Answer, ExploreResponse, Question, SourceMode } from '../src/types.js';

const PUBLIC_BASE = 'https://api.zhihu.com/km-indep-home/hackathon/v2/knowledge';
const SEARCH_URL = 'https://developer.zhihu.com/api/v1/content/zhihu_search';
const PALETTE = ['#89baff', '#b2a2ff', '#6ee4d3', '#ffc28e', '#e6a0d7', '#9dd8ff'];
const STOP_WORDS = new Set('如何 怎么 怎样 为什么 什么 哪些 这个 那个 我们 你们 他们 一个 一些 可以 应该 需要 以及 还是 进行 通过 自己 时候 但是 就是 现在 有什么 有没有 怎么样 更好 起来 是否 不同 问题 话题 探索 发现 知识 的 了 和 与 在 是 吗 呢 地 得 不 很 更 最 对 把 被'.split(' '));
const MAX_RESPONSE_BYTES = 1_500_000;

export interface PublicItem {
  work_id: string;
  title?: string;
  description?: string;
  labels?: unknown[];
  [key: string]: unknown;
}
export interface PublicDetail {
  work_id: string;
  chapter_name?: string;
  author_name?: string;
  introduction?: string;
  content?: string;
  [key: string]: unknown;
}
export interface PublicSnapshot {
  fetchedAt: string;
  sourceUrl: string;
  items: PublicItem[];
  details: Record<string, PublicDetail>;
}
export interface SearchItem {
  Title?: string;
  ContentType?: string;
  ContentID?: string;
  ContentText?: string;
  Url?: string;
  AuthorName?: string;
  VoteUpCount?: number;
  RankingScore?: number;
}

/** Only these safe, application-owned messages may cross the API boundary. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public upstreamStatus?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export function plainText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<(?:br\s*\/?|\/p|\/div|\/li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:x[\da-f]+|\d+);/gi, (entity) => {
      const named: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' };
      if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
      const number = entity.toLowerCase().startsWith('&#x') ? parseInt(entity.slice(3, -1), 16) : parseInt(entity.slice(2, -1), 10);
      return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : '';
    })
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractKeywords(query: string): string[] {
  const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
  const segments = [...segmenter.segment(plainText(query).normalize('NFKC'))]
    .filter((part) => part.isWordLike)
    .map((part) => part.segment.toLowerCase())
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
  return [...new Set(segments)].slice(0, 8);
}

export function validWorkId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9]{1,30}$/.test(value);
}

export function safeZhihuUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['zhihu.com', 'www.zhihu.com', 'zhuanlan.zhihu.com'].includes(url.hostname) || url.username || url.password || url.port) return undefined;
    if (!/^\/(?:question\/\d+(?:\/answer\/\d+)?|answer\/\d+|p\/\d+)\/?$/.test(url.pathname)) return undefined;
    return url.href;
  } catch { return undefined; }
}

function idHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}
function normalizedTitle(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\s?？!！。]+/g, '');
}
function paragraphs(value: string): string[] {
  return value.split(/\n+/).map((part) => part.trim()).filter(Boolean);
}
function matchScore(title: string, body: string, terms: string[]): number {
  if (!terms.length) return 0;
  const titleLower = title.toLowerCase();
  const bodyLower = body.toLowerCase();
  return terms.reduce((score, term) => score + (titleLower.includes(term) ? 1 : bodyLower.includes(term) ? 0.35 : 0), 0) / terms.length;
}

/** Group only real question identities/titles; do not invent related questions or authors. */
export function adaptSearch(items: SearchItem[], query: string): Question[] {
  const terms = extractKeywords(query);
  const records = items.slice(0, 10).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const title = plainText(item.Title).slice(0, 400);
    const url = safeZhihuUrl(item.Url);
    const type = String(item.ContentType ?? '').toLowerCase();
    if (!title || !url || !['answer', 'question', 'article'].includes(type)) return [];
    const questionId = new URL(url).pathname.match(/^\/question\/(\d+)/)?.[1];
    const contentId = typeof item.ContentID === 'string' && /^\d+$/.test(item.ContentID) ? item.ContentID : new URL(url).pathname.match(/\/(\d+)\/?$/)?.[1];
    return [{ item, title, url, type, questionId, contentId }];
  });
  const titleIds = new Map<string, Set<string>>();
  for (const record of records) {
    if (!record.questionId || record.type === 'article') continue;
    const key = normalizedTitle(record.title);
    const ids = titleIds.get(key) ?? new Set<string>();
    ids.add(record.questionId);
    titleIds.set(key, ids);
  }
  const groups = new Map<string, Question>();
  records.forEach((record, index) => {
    const { item, title, type, contentId, url } = record;
    const knownIds = titleIds.get(normalizedTitle(title));
    const questionId = record.questionId ?? (knownIds?.size === 1 ? [...knownIds][0] : undefined);
    const id = type === 'article' ? `article-${contentId ?? idHash(url)}` : questionId ? `question-${questionId}` : `title-${idHash(normalizedTitle(title))}`;
    const content = plainText(item.ContentText).slice(0, 12000);
    const lexical = matchScore(title, content, terms);
    const relevance = Math.min(1, Math.max(0.3, 0.45 + lexical * 0.4 + (1 - index / 10) * 0.15));
    let question = groups.get(id);
    if (!question) {
      question = { id, title, excerpt: content.slice(0, 180), keywords: extractKeywords(title).slice(0, 4), relevance, color: PALETTE[groups.size % PALETTE.length], answers: [], url: questionId && type !== 'article' ? `https://www.zhihu.com/question/${questionId}` : url };
      groups.set(id, question);
    }
    question.relevance = Math.max(question.relevance, relevance);
    if (type === 'question') return;
    const answerId = `${type}-${contentId ?? idHash(url)}`;
    if (question.answers.some((answer) => answer.id === answerId)) return;
    const split = paragraphs(content);
    question.answers.push({
      id: answerId,
      title: split[0]?.slice(0, 100) || title,
      author: plainText(item.AuthorName).slice(0, 100) || '作者未提供',
      excerpt: content.slice(0, 220),
      paragraphs: split,
      url,
      relevance,
      ...(typeof item.VoteUpCount === 'number' && Number.isFinite(item.VoteUpCount) && item.VoteUpCount >= 0 ? { votes: Math.floor(item.VoteUpCount) } : {}),
      isExcerpt: true,
    });
  });
  return [...groups.values()].sort((a, b) => b.relevance - a.relevance);
}

export function adaptPublicAnswer(item: PublicItem, detail?: PublicDetail): Answer {
  const title = plainText(detail?.chapter_name || item.title).slice(0, 400) || '未提供标题';
  const content = plainText(detail?.content).slice(0, 20000);
  const intro = plainText(detail?.introduction || item.description);
  return {
    id: `knowledge-${item.work_id}`,
    workId: item.work_id,
    title,
    author: plainText(detail?.author_name).slice(0, 100) || '作者未提供',
    excerpt: (intro || content).slice(0, 220),
    paragraphs: paragraphs(content || intro),
    url: `${PUBLIC_BASE}/${encodeURIComponent(item.work_id)}`,
    relevance: 0.7,
    // The event API currently truncates most content to 3,000 characters.
    isExcerpt: true,
  };
}

export function adaptPublic(snapshot: PublicSnapshot, query: string): Question[] {
  const terms = extractKeywords(query);
  const normalizedQuery = plainText(query).toLowerCase();
  return snapshot.items.slice(0, 40).flatMap((item, index) => {
    const answer = adaptPublicAnswer(item, snapshot.details[item.work_id]);
    const body = `${answer.excerpt}\n${answer.paragraphs.join('\n')}`;
    const score = matchScore(answer.title, body, terms);
    if (normalizedQuery && !(terms.length ? score > 0 : `${answer.title}\n${body}`.toLowerCase().includes(normalizedQuery))) return [];
    const relevance = normalizedQuery ? Math.min(1, 0.4 + score * 0.6) : 0.85 - index * 0.035;
    answer.relevance = relevance;
    return [{
      id: `knowledge-${item.work_id}`,
      title: plainText(item.title) || answer.title,
      excerpt: answer.excerpt,
      keywords: extractKeywords(answer.title).slice(0, 4),
      relevance,
      color: PALETTE[index % PALETTE.length],
      answers: [answer],
      url: answer.url,
    }];
  }).sort((a, b) => b.relevance - a.relevance);
}

export function validateSnapshot(raw: unknown): PublicSnapshot | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Partial<PublicSnapshot>;
  if (!Array.isArray(value.items) || !value.details || typeof value.details !== 'object' || typeof value.fetchedAt !== 'string' || !Number.isFinite(Date.parse(value.fetchedAt))) return undefined;
  const items = value.items.filter((item) => item && typeof item === 'object' && validWorkId(item.work_id)).slice(0, 40);
  const details: Record<string, PublicDetail> = {};
  for (const item of items) {
    const detail = value.details[item.work_id];
    if (detail && typeof detail === 'object' && detail.work_id === item.work_id) details[item.work_id] = detail;
  }
  return { fetchedAt: value.fetchedAt, sourceUrl: `${PUBLIC_BASE}/list`, items, details };
}

export async function loadSnapshot(): Promise<PublicSnapshot> {
  try {
    const data = JSON.parse(await readFile(new URL('./data/zhihu-public.json', import.meta.url), 'utf8'));
    const snapshot = validateSnapshot(data);
    if (snapshot) return snapshot;
  } catch { /* An unavailable snapshot is represented by an empty corpus. */ }
  return { fetchedAt: new Date(0).toISOString(), sourceUrl: `${PUBLIC_BASE}/list`, items: [], details: {} };
}

export interface ZhihuServiceOptions {
  secret?: string;
  snapshot: PublicSnapshot;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

export class ZhihuService {
  private snapshot: PublicSnapshot;
  private source: SourceMode = 'zhihu-cache';
  private fetchImpl: typeof fetch;
  private now: () => number;
  private secret: string;
  private timeoutMs: number;
  private cache = new Map<string, { at: number; response: ExploreResponse }>();
  private pendingSearches = new Map<string, Promise<ExploreResponse>>();
  private pendingDetails = new Map<string, Promise<Answer>>();
  private refreshPromise?: Promise<void>;
  private refreshAttemptAt = -Infinity;
  public publicError?: ApiError;

  constructor(options: ZhihuServiceOptions) {
    this.snapshot = validateSnapshot(options.snapshot) ?? { fetchedAt: new Date(0).toISOString(), sourceUrl: `${PUBLIC_BASE}/list`, items: [], details: {} };
    this.secret = options.secret?.trim() ?? '';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 8000;
  }

  get configured(): boolean { return Boolean(this.secret); }
  get publicCount(): number { return this.snapshot.items.length; }

  private async fetchJson(url: string, authenticated = false): Promise<unknown> {
    const parsed = new URL(url);
    if (!(url === SEARCH_URL || (parsed.origin === 'https://developer.zhihu.com' && parsed.pathname === '/api/v1/content/zhihu_search') || (parsed.origin === 'https://api.zhihu.com' && /^\/km-indep-home\/hackathon\/v2\/knowledge\/(?:list|[0-9]{1,30})$/.test(parsed.pathname)))) {
      throw new ApiError(400, 'INVALID_SOURCE', '不支持的知乎内容来源。');
    }
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (authenticated) {
      headers.Authorization = `Bearer ${this.secret}`;
      headers['X-Request-Timestamp'] = String(Math.floor(this.now() / 1000));
      headers['Content-Type'] = 'application/json';
    }
    try {
      const response = await this.fetchImpl(url, { headers, redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs) });
      if (!response.ok) throw new ApiError(response.status === 429 ? 429 : 502, 'UPSTREAM_HTTP_ERROR', `知乎接口暂时不可用（HTTP ${response.status}），请稍后重试。`, response.status);
      if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) throw new ApiError(502, 'UPSTREAM_TOO_LARGE', '知乎返回的内容超过读取上限。');
      const reader = response.body?.getReader();
      if (!reader) throw new ApiError(502, 'UPSTREAM_INVALID_RESPONSE', '知乎接口未返回有效内容。');
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new ApiError(502, 'UPSTREAM_TOO_LARGE', '知乎返回的内容超过读取上限。');
        }
        chunks.push(chunk.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) throw new ApiError(504, 'UPSTREAM_TIMEOUT', '知乎接口响应超时，请稍后重试。');
      throw new ApiError(502, 'UPSTREAM_UNAVAILABLE', '暂时无法读取知乎内容，请稍后重试。');
    }
  }

  private publicExplore(query: string, prefix?: string): ExploreResponse {
    const questions = adaptPublic(this.snapshot, query);
    const notice = [prefix, this.configured ? '当前展示知乎黑客松公开知识内容。' : '未配置知乎搜索密钥，当前仅检索知乎黑客松公开知识内容。', this.source === 'zhihu-cache' ? '内容来自本地真实内容快照。' : '', this.publicError?.message, '作品按独立知识节点展示；正文为官方接口提供的节选，亮度依据关键词匹配。', query && !questions.length ? '公开内容中暂无匹配结果，可调整关键词，或配置密钥后搜索知乎。' : ''].filter(Boolean).join('');
    return { query, keywords: extractKeywords(query), questions, source: this.source, notice, fetchedAt: this.snapshot.fetchedAt };
  }

  async explore(query: string): Promise<ExploreResponse> {
    if (!this.secret || !query) return this.publicExplore(query);
    const existing = this.cache.get(query);
    if (existing && this.now() - existing.at < 5 * 60_000) return existing.response;
    const pending = this.pendingSearches.get(query);
    if (pending) return pending;
    if (this.pendingSearches.size >= 4) throw new ApiError(429, 'TOO_MANY_SEARCHES', '正在处理较多探索请求，请稍后再试。');
    const task = this.search(query).finally(() => this.pendingSearches.delete(query));
    this.pendingSearches.set(query, task);
    return task;
  }

  private async search(query: string): Promise<ExploreResponse> {
    const url = new URL(SEARCH_URL);
    url.searchParams.set('Query', query);
    url.searchParams.set('Count', '10');
    const raw = await this.fetchJson(url.href, true);
    if (!raw || typeof raw !== 'object') throw new ApiError(502, 'UPSTREAM_INVALID_RESPONSE', '知乎搜索返回了无法识别的数据。');
    const payload = raw as { Code?: number; Data?: { Items?: SearchItem[] } };
    if (payload.Code !== 0) {
      if (payload.Code === 20001) throw new ApiError(502, 'ZHIHU_AUTH_FAILED', '知乎搜索鉴权失败，请检查服务端的 Access Secret 配置。');
      if (payload.Code === 30001) throw new ApiError(429, 'ZHIHU_RATE_LIMITED', '知乎搜索额度或频率已受限，请稍后再试。');
      throw new ApiError(502, 'ZHIHU_SEARCH_FAILED', '知乎搜索暂时未能完成，请稍后重试。');
    }
    if (!Array.isArray(payload.Data?.Items)) throw new ApiError(502, 'UPSTREAM_INVALID_RESPONSE', '知乎搜索返回了无法识别的数据。');
    const questions = adaptSearch(payload.Data.Items, query);
    const response: ExploreResponse = { query, keywords: extractKeywords(query), questions, source: 'zhihu-search', fetchedAt: new Date(this.now()).toISOString(), notice: questions.length ? '来自知乎实时搜索。正文为搜索接口返回的摘要，完整内容请查看原文；亮度依据关键词匹配与搜索排序。' : '知乎搜索暂未返回可展示的匹配内容，请调整关键词再试。' };
    if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(query, { at: this.now(), response });
    return response;
  }

  async knowledge(workId: string): Promise<Answer> {
    if (!validWorkId(workId)) throw new ApiError(400, 'INVALID_WORK_ID', '知识内容编号格式无效。');
    const item = this.snapshot.items.find((entry) => entry.work_id === workId);
    if (!item) throw new ApiError(404, 'KNOWLEDGE_NOT_FOUND', '未找到该知识内容，请从探索结果中选择。');
    const cached = this.snapshot.details[workId];
    if (cached) return adaptPublicAnswer(item, cached);
    const pending = this.pendingDetails.get(workId);
    if (pending) return pending;
    if (this.pendingDetails.size >= 3) throw new ApiError(429, 'TOO_MANY_READS', '正在读取较多内容，请稍后再试。');
    const task = (async () => {
      const raw = await this.fetchJson(`${PUBLIC_BASE}/${encodeURIComponent(workId)}`);
      if (!raw || typeof raw !== 'object' || (raw as PublicDetail).work_id !== workId) throw new ApiError(502, 'UPSTREAM_INVALID_RESPONSE', '知乎未返回对应的知识内容。');
      const detail = raw as PublicDetail;
      this.snapshot.details[workId] = detail;
      return adaptPublicAnswer(item, detail);
    })().finally(() => this.pendingDetails.delete(workId));
    this.pendingDetails.set(workId, task);
    return task;
  }

  /** Bounded background refresh; initial browsing can immediately use the real snapshot. */
  refreshPublic(force = false): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    if (!force && this.now() - this.refreshAttemptAt < 15 * 60_000) return Promise.resolve();
    this.refreshAttemptAt = this.now();
    this.refreshPromise = this.performPublicRefresh().finally(() => { this.refreshPromise = undefined; });
    return this.refreshPromise;
  }

  private async performPublicRefresh(): Promise<void> {
    try {
      const raw = await this.fetchJson(`${PUBLIC_BASE}/list`);
      if (!Array.isArray(raw)) throw new ApiError(502, 'UPSTREAM_INVALID_RESPONSE', '知乎公开知识列表格式已变化。');
      const items = raw.filter((item): item is PublicItem => item && typeof item === 'object' && validWorkId(item.work_id)).slice(0, 20);
      const details: Record<string, PublicDetail> = {};
      // At most 20 detail reads, in sequential batches of 3. No automatic retry.
      for (let offset = 0; offset < items.length; offset += 3) {
        await Promise.all(items.slice(offset, offset + 3).map(async (item) => {
          const detail = await this.fetchJson(`${PUBLIC_BASE}/${encodeURIComponent(item.work_id)}`);
          if (!detail || typeof detail !== 'object' || (detail as PublicDetail).work_id !== item.work_id) throw new ApiError(502, 'UPSTREAM_INVALID_RESPONSE', '知乎未返回对应的知识内容。');
          details[item.work_id] = detail as PublicDetail;
        }));
      }
      this.snapshot = { fetchedAt: new Date(this.now()).toISOString(), sourceUrl: `${PUBLIC_BASE}/list`, items, details };
      this.source = 'zhihu-public';
      this.publicError = undefined;
    } catch (error) {
      this.publicError = error instanceof ApiError ? error : new ApiError(502, 'UPSTREAM_UNAVAILABLE', '暂时无法刷新知乎公开内容。');
      // Keep the verified snapshot; never synthesize content after an upstream failure.
    }
  }
}
