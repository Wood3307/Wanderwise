import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Answer, ExploreResponse, Question, QuestionResponse, SourceMode } from '../src/types.js';
import { extractHighlights } from './highlights.js';
import { sourceLiterals, sourcePrefix } from './source-format.js';

const PUBLIC_BASE = 'https://api.zhihu.com/km-indep-home/hackathon/v2/knowledge';
const SEARCH_URL = 'https://developer.zhihu.com/api/v1/content/zhihu_search';
const HOT_URL = 'https://developer.zhihu.com/api/v1/content/hot_list';
const PALETTE = ['#89baff', '#b2a2ff', '#6ee4d3', '#ffc28e', '#e6a0d7', '#9dd8ff'];
const STOP_WORDS = new Set('如何 怎么 怎样 为什么 什么 哪些 这个 那个 我们 你们 他们 一个 一些 可以 应该 需要 以及 还是 进行 通过 自己 时候 但是 就是 现在 有什么 有没有 怎么样 更好 起来 是否 不同 问题 话题 探索 发现 知识 的 了 和 与 在 是 吗 呢 地 得 不 很 更 最 对 把 被'.split(' '));
const MAX_RESPONSE_BYTES = 1_500_000;
const SEARCH_CACHE_MS = 5 * 60_000;
const SEARCH_INTERVAL_MS = 1100;
const SEARCH_LIMIT_COOLDOWN_MS = 60_000;
const HOT_CACHE_MS = 5 * 60_000;
const HOT_STALE_MS = 30 * 60_000;
const HOT_QUESTION_MS = 2 * 60 * 60_000;
const HOT_RETRY_MS = 60_000;

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
export interface HotItem {
  Title?: string;
  Url?: string;
  Summary?: string;
  ThumbnailUrl?: string;
}

/** Only these safe, application-owned messages may cross the API boundary. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public upstreamStatus?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:x[\da-f]+|\d+);/gi, (entity) => {
    const named: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const number = entity.toLowerCase().startsWith('&#x') ? parseInt(entity.slice(3, -1), 16) : parseInt(entity.slice(2, -1), 10);
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : '';
  });
}

/** Recover explicit source TeX only; no remote image fetching or inference. */
function equationMarkup(source: string, protect: (value: string) => string, restore: (value: string) => string): string {
  const tags = /<(img|span|math)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  let result = '', offset = 0, match: RegExpExecArray | null;
  while ((match = tags.exec(source))) {
    const tag = match[0];
    const attribute = (name: string) => {
      const found = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
      const value = found?.[1] ?? found?.[2] ?? found?.[3];
      return value === undefined ? undefined : decodeEntities(restore(value));
    };
    let formula = attribute('data-tex') || attribute('data-latex');
    const isImage = match[1].toLowerCase() === 'img';
    if (!formula && isImage && (/\bztext-math\b/i.test(attribute('class') ?? '') || attribute('eeimg') !== undefined)) formula = attribute('alt');
    if (!formula && isImage) {
      for (const name of ['src', 'data-src', 'data-original', 'data-actualsrc']) {
        const value = attribute(name);
        if (!value) continue;
        try {
          const url = new URL(value, 'https://www.zhihu.com');
          if (url.protocol === 'https:' && ['zhihu.com', 'www.zhihu.com'].includes(url.hostname)
            && !url.username && !url.password && !url.port && url.pathname === '/equation') formula = url.searchParams.get('tex') ?? undefined;
        } catch { /* An invalid image URL is not a formula source. */ }
        if (formula) break;
      }
    }
    if (!formula?.trim() || formula.length > 4000) continue;
    let end = tags.lastIndex;
    if (!isImage && !/\/\s*>$/.test(tag)) {
      // Skip the complete math node, including a rendered fallback nested inside it.
      const boundaries = new RegExp(`<(/?)${match[1]}\\b(?:[^>"']|"[^"]*"|'[^']*')*>`, 'gi');
      boundaries.lastIndex = end;
      let depth = 1, boundary: RegExpExecArray | null;
      while ((boundary = boundaries.exec(source))) {
        depth += boundary[1] ? -1 : /\/\s*>$/.test(boundary[0]) ? 0 : 1;
        if (!depth) { end = boundaries.lastIndex; break; }
      }
      if (depth) continue;
    }
    const tex = formula.trim();
    const delimited = /^(?:\$|\\[[(]|\\begin\{)/.test(tex) ? tex : tex.includes('\n') ? `\\[${tex}\\]` : `$${tex}$`;
    result += source.slice(offset, match.index) + protect(delimited);
    offset = end;
    tags.lastIndex = end;
  }
  return result + source.slice(offset);
}

export function plainText(value: unknown, preserveFormatting = false): string {
  if (typeof value !== 'string') return '';
  const input = value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  // Markdown code and TeX are source text, even when they contain angle brackets.
  // Protect complete literal spans before removing real HTML around them.
  const literals: string[] = [];
  let marker = '\uE000literal:';
  while (input.includes(marker)) marker += ':';
  const protect = (literal: string) => {
    literals.push(literal);
    return `${marker}${literals.length - 1}\uE001`;
  };
  const restore = (text: string) => text.replace(new RegExp(`${marker}(\\d+)\uE001`, 'g'), (_, index: string) => literals[Number(index)]);
  let protectedValue = '', cursor = 0;
  for (const span of sourceLiterals(input)) {
    const literal = input.slice(span.start, span.end);
    protectedValue += input.slice(cursor, span.start) + protect(span.kind === 'math' ? decodeEntities(literal) : literal);
    cursor = span.end;
  }
  protectedValue += input.slice(cursor);
  let text = protectedValue
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  text = equationMarkup(text, protect, restore)
    .replace(/<(?:br\s*\/?|\/p|\/div|\/li)>/gi, '\n')
    .replace(/<\/?[a-z][\w:-]*(?:\s+(?:[^<>"']|"[^"]*"|'[^']*')*)?\s*\/?>/gi, '');
  text = decodeEntities(text);
  if (!preserveFormatting) text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  // Reinsert literals after whitespace handling, retaining code indentation and TeX spacing.
  text = restore(text);
  return preserveFormatting ? text.replace(/^\n+|\n+$/g, '') : text;
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
function sourceTitle(value: unknown): string {
  return plainText(value).replace(/\s*[-–—|]\s*知乎\s*$/u, '').trim();
}
function normalizedTitle(value: string): string {
  return sourceTitle(value).normalize('NFKC').toLowerCase().replace(/[\s?？!！。]+/g, '');
}
function paragraphs(value: string): string[] {
  const lines = value.split('\n');
  const offsets: number[] = [];
  let position = 0;
  for (const line of lines) { offsets.push(position); position += line.length + 1; }
  const literals = sourceLiterals(value);
  const output: string[] = [];
  const listItem = /^[ \t]{0,3}(?:[-+*]|\d{1,9}[.)])\s+/;
  const indented = /^(?: {4}|\t)/;
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    let end = index + 1;
    const fence = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    const lineEnd = offsets[index] + line.length;
    const multiline = literals.find(span => span.start >= offsets[index] && span.start <= lineEnd && span.end > lineEnd);
    if (fence) {
      const close = new RegExp(`^[ \\t]{0,3}${fence[0]}{${fence.length},}[ \\t]*$`);
      while (end < lines.length && !close.test(lines[end])) end++;
      if (end < lines.length) end++;
    } else if (multiline) {
      while (end < lines.length && offsets[end] < multiline.end) end++;
    } else if (listItem.test(line) || /^[ \t]{0,3}>/.test(line)) {
      // Keep a Markdown list/quote and its lazy continuation lines together.
      while (end < lines.length) {
        if (lines[end].trim()) { end++; continue; }
        let next = end + 1;
        while (next < lines.length && !lines[next].trim()) next++;
        if (next < lines.length && (listItem.test(lines[next]) || indented.test(lines[next]) || /^[ \t]{0,3}>/.test(lines[next]))) end = next;
        else break;
      }
    } else if (indented.test(line)) {
      while (end < lines.length && (indented.test(lines[end]) || (!lines[end].trim() && indented.test(lines[end + 1] ?? '')))) end++;
    } else if (line.includes('|') && /^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/.test(lines[end] ?? '')) {
      end++;
      while (end < lines.length && lines[end].includes('|') && lines[end].trim()) end++;
    }
    // A list/quote may contain a formula with blank lines. Its closing delimiter
    // belongs to the same source paragraph even if prose block rules stop early.
    let crossing = literals.find(span => span.start < (offsets[end] ?? value.length) && span.end > (offsets[end] ?? value.length));
    while (crossing) {
      while (end < lines.length && offsets[end] < crossing.end) end++;
      crossing = literals.find(span => span.start < (offsets[end] ?? value.length) && span.end > (offsets[end] ?? value.length));
    }
    const part = lines.slice(index, end).join('\n');
    output.push(end > index + 1 || indented.test(line) ? part : part.trim());
    index = end;
  }
  return output;
}
function matchScore(title: string, body: string, terms: string[]): number {
  if (!terms.length) return 0;
  const titleLower = title.toLowerCase();
  const bodyLower = body.toLowerCase();
  return terms.reduce((score, term) => score + (titleLower.includes(term) ? 1 : bodyLower.includes(term) ? 0.35 : 0), 0) / terms.length;
}

export function validNodeId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(value);
}

function withHighlights(answer: Answer, query: string): Answer {
  return { ...answer, highlights: extractHighlights(answer, query), highlightMethod: 'extractive' };
}

function answerHeadline(answer: Answer, query: string): string {
  const terms = extractKeywords(query);
  const candidates = (answer.highlights ?? []).map((highlight) => ({
    text: highlight.text,
    score: matchScore(highlight.text, '', terms)
      + (/关键|建议|首先|需要|可以|因此|本质|具体|能够|取决于/.test(highlight.text) ? 0.2 : 0)
      - (/大家好|谢邀|感谢邀请|关注我|公众号|我是/.test(highlight.text) ? 1 : 0),
  })).sort((a, b) => b.score - a.score);
  const quote = candidates[0]?.text || answer.paragraphs[0] || answer.title;
  const literals = sourceLiterals(quote);
  const sentenceEnd = [...quote.matchAll(/[。！？](?:\s|$)/g)]
    .find(match => !literals.some(span => span.start <= match.index! && span.end > match.index!));
  const firstSentence = sentenceEnd ? quote.slice(0, sentenceEnd.index! + sentenceEnd[0].length).trim() : quote;
  const prefix = sourcePrefix(firstSentence, 60, 400);
  // Extremely long formulae stay in the reader; use the actual question title
  // when no complete source prefix fits in a readable label.
  return prefix ? `${prefix}${prefix.length < firstSentence.length ? '…' : ''}` : answer.title;
}

function searchIdentity(item: SearchItem) {
  if (!item || typeof item !== 'object') return undefined;
  const title = sourcePrefix(sourceTitle(item.Title), 400);
  const url = safeZhihuUrl(item.Url);
  const type = String(item.ContentType ?? '').toLowerCase();
  if (!title || !url || !['answer', 'question', 'article'].includes(type)) return undefined;
  const pathname = new URL(url).pathname;
  if (type === 'answer' && !/^\/(?:question\/\d+\/answer|answer)\/\d+\/?$/.test(pathname)) return undefined;
  if (type === 'article' && !/^\/p\/\d+\/?$/.test(pathname)) return undefined;
  if (type === 'question' && !/^\/question\/\d+\/?$/.test(pathname)) return undefined;
  return {
    item, title, url, type,
    questionId: pathname.match(/^\/question\/(\d+)/)?.[1],
    // The source URL is authoritative if a search record has a conflicting ContentID.
    contentId: pathname.match(/\/(\d+)\/?$/)?.[1],
  };
}

/** Group only real question identities/titles; do not invent related questions or authors. */
export function adaptSearch(items: SearchItem[], query: string): Question[] {
  const terms = extractKeywords(query);
  const records = items.slice(0, 10).flatMap((item) => {
    const record = searchIdentity(item);
    return record ? [record] : [];
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
    const content = sourcePrefix(plainText(item.ContentText, true), 12000);
    const lexical = matchScore(title, content, terms);
    const relevance = Math.min(1, Math.max(0.3, 0.45 + lexical * 0.4 + (1 - index / 10) * 0.15));
    let question = groups.get(id);
    if (!question) {
      question = { id, title, excerpt: sourcePrefix(content, 180, 600), keywords: extractKeywords(title).slice(0, 4), relevance, color: PALETTE[groups.size % PALETTE.length], answers: [], url: questionId && type !== 'article' ? `https://www.zhihu.com/question/${questionId}` : url, kind: type === 'article' ? 'article' : 'question', answersExpanded: type === 'article' };
      groups.set(id, question);
    }
    question.relevance = Math.max(question.relevance, relevance);
    if (type === 'question') return;
    const answerId = `${type}-${contentId ?? idHash(url)}`;
    if (question.answers.some((answer) => answer.id === answerId)) return;
    const split = paragraphs(content);
    const answer = withHighlights({
      id: answerId,
      title,
      author: plainText(item.AuthorName).slice(0, 100) || '作者未提供',
      excerpt: sourcePrefix(content, 220, 600),
      paragraphs: split,
      url,
      relevance,
      ...(typeof item.VoteUpCount === 'number' && Number.isFinite(item.VoteUpCount) && item.VoteUpCount >= 0 ? { votes: Math.floor(item.VoteUpCount) } : {}),
      isExcerpt: true,
    }, query);
    // Answers have no independent article title in this API: label them with a verbatim salient quote.
    if (type === 'answer') answer.title = answerHeadline(answer, query);
    question.answers.push(answer);
  });
  return [...groups.values()].sort((a, b) => b.relevance - a.relevance);
}

/** A hot-list summary describes a question; it is never an answer or an author. */
export function adaptHot(items: HotItem[]): Question[] {
  const seen = new Set<string>();
  return items.slice(0, 30).flatMap((item, index): Question[] => {
    if (!item || typeof item !== 'object') return [];
    const title = sourcePrefix(sourceTitle(item.Title), 400);
    const url = safeZhihuUrl(item.Url);
    if (!title || !url) return [];
    const parsed = new URL(url);
    const id = parsed.pathname.match(/^\/question\/([0-9]{1,30})\/?$/)?.[1];
    if (!id || !['zhihu.com', 'www.zhihu.com'].includes(parsed.hostname) || seen.has(id)) return [];
    seen.add(id);
    return [{
      id: `question-${id}`, title, url: `https://www.zhihu.com/question/${id}`,
      excerpt: sourcePrefix(plainText(item.Summary), 300, 600),
      keywords: extractKeywords(title).slice(0, 4),
      relevance: Math.max(0.36, 1 - index * 0.045), color: PALETTE[(seen.size - 1) % PALETTE.length],
      kind: 'question', answers: [], answersExpanded: false, hotRank: index + 1,
    }];
  }).slice(0, 12);
}

export function adaptPublicAnswer(item: PublicItem, detail?: PublicDetail, query = ''): Answer {
  const title = sourcePrefix(plainText(detail?.chapter_name || item.title), 400) || '未提供标题';
  const content = sourcePrefix(plainText(detail?.content, true), 20000);
  const intro = plainText(detail?.introduction || item.description, true);
  return withHighlights({
    id: `knowledge-${item.work_id}`,
    workId: item.work_id,
    title,
    author: plainText(detail?.author_name).slice(0, 100) || '作者未提供',
    excerpt: sourcePrefix(intro || content, 220, 600),
    paragraphs: paragraphs(content || intro),
    url: `${PUBLIC_BASE}/${encodeURIComponent(item.work_id)}`,
    relevance: 0.7,
    // The event API currently truncates most content to 3,000 characters.
    isExcerpt: true,
  }, query);
}

const PUBLIC_TOPICS = [
  { id: 'career', title: '职场成长', terms: ['职场', '职业', '老板', '加薪', '升职', '工作', '管理', '公司'], color: '#89baff' },
  { id: 'learning', title: '学习与行动', terms: ['学习', '注意力', '专注', '目标', '任务', '行动', '自律', '效率'], color: '#6ee4d3' },
  { id: 'relationships', title: '心理与关系', terms: ['心理', '人际', '拒绝', '被动', '主动', '关系', '认知', '感受'], color: '#b2a2ff' },
];

function publicTopic(answer: Answer) {
  const text = `${answer.excerpt}\n${answer.paragraphs.join('\n')}`;
  const ranked = PUBLIC_TOPICS.map((topic) => ({
    topic,
    score: topic.terms.reduce((sum, term) => sum + (answer.title.includes(term) ? 10 : text.includes(term) ? 1 : 0), 0),
  })).sort((a, b) => b.score - a.score);
  return ranked[0].score ? ranked[0].topic : { id: 'discovery', title: '知识拾遗', terms: [], color: '#ffc28e' };
}

export function adaptPublic(snapshot: PublicSnapshot, query: string): Question[] {
  const terms = extractKeywords(query);
  const normalizedQuery = plainText(query).toLowerCase();
  const groups = new Map<string, Question>();
  const seen = new Set<string>();
  snapshot.items.slice(0, 40).forEach((item, index) => {
    if (seen.has(item.work_id)) return;
    seen.add(item.work_id);
    const answer = adaptPublicAnswer(item, snapshot.details[item.work_id], query);
    const body = `${answer.excerpt}\n${answer.paragraphs.join('\n')}`;
    const score = matchScore(answer.title, body, terms);
    // Filter each real work before grouping so a matching topic cannot smuggle in unrelated works.
    if (normalizedQuery && !(terms.length ? score > 0 : `${answer.title}\n${body}`.toLowerCase().includes(normalizedQuery))) return;
    const relevance = normalizedQuery ? Math.min(1, 0.4 + score * 0.6) : 0.85 - index * 0.035;
    answer.relevance = relevance;
    const topic = publicTopic(answer);
    let group = groups.get(topic.id);
    if (!group) {
      group = { id: `topic-${topic.id}`, title: topic.title, excerpt: '', keywords: ['主题聚合', ...topic.terms.slice(0, 3)], relevance, color: topic.color, answers: [], kind: 'topic', answersExpanded: true };
      groups.set(topic.id, group);
    }
    group.answers.push(answer);
    group.relevance = Math.max(group.relevance, relevance);
    group.excerpt = `主题聚合 · ${group.answers.length} 篇知乎公开作品`;
  });
  return [...groups.values()].map((group) => ({ ...group, answers: group.answers.sort((a, b) => b.relevance - a.relevance) })).sort((a, b) => b.relevance - a.relevance);
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
  wait?: (milliseconds: number) => Promise<void>;
}

export class ZhihuService {
  private snapshot: PublicSnapshot;
  private source: SourceMode = 'zhihu-cache';
  private fetchImpl: typeof fetch;
  private now: () => number;
  private secret: string;
  private timeoutMs: number;
  private wait: (milliseconds: number) => Promise<void>;
  private searchQueue: Promise<void> = Promise.resolve();
  private queuedSearchCount = 0;
  private searchStartedAt = -Infinity;
  private searchLimitedUntil = -Infinity;
  private searchLimitError?: ApiError;
  private cache = new Map<string, { at: number; response: ExploreResponse }>();
  private pendingSearches = new Map<string, Promise<ExploreResponse>>();
  private expandedQuestions = new Map<string, { at: number; response: QuestionResponse }>();
  private pendingQuestions = new Map<string, Promise<QuestionResponse>>();
  private pendingDetails = new Map<string, Promise<Answer>>();
  private refreshPromise?: Promise<void>;
  private refreshAttemptAt = -Infinity;
  private hotCache?: { at: number; response: ExploreResponse };
  private pendingHot?: Promise<ExploreResponse>;
  private hotAttemptAt = -Infinity;
  private hotError?: ApiError;
  private hotQuestions = new Map<string, { at: number; question: Question }>();
  public publicError?: ApiError;

  constructor(options: ZhihuServiceOptions) {
    this.snapshot = validateSnapshot(options.snapshot) ?? { fetchedAt: new Date(0).toISOString(), sourceUrl: `${PUBLIC_BASE}/list`, items: [], details: {} };
    this.secret = options.secret?.trim() ?? '';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.wait = options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  get configured(): boolean { return Boolean(this.secret); }
  get publicCount(): number { return this.snapshot.items.length; }

  private async fetchJson(url: string, authenticated = false): Promise<unknown> {
    const parsed = new URL(url);
    if (!((parsed.origin === 'https://developer.zhihu.com' && ['/api/v1/content/zhihu_search', '/api/v1/content/hot_list'].includes(parsed.pathname)) || (parsed.origin === 'https://api.zhihu.com' && /^\/km-indep-home\/hackathon\/v2\/knowledge\/(?:list|[0-9]{1,30})$/.test(parsed.pathname)))) {
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
    const notice = [prefix, this.configured ? '当前展示知乎黑客松公开知识内容。' : '未配置知乎搜索密钥，当前仅检索知乎黑客松公开知识内容。', this.source === 'zhihu-cache' ? '内容来自本地真实内容快照。' : '', this.publicError?.message, '首层是按真实作品标题和内容整理的主题聚合，并非同一知乎问题下的回答；第二层保留每篇作品的原题与作者，第三层展示可追溯的原文精华节选。', query && !questions.length ? '公开内容中暂无匹配结果，可调整关键词，或配置密钥后搜索知乎。' : ''].filter(Boolean).join('');
    return { query, keywords: extractKeywords(query), questions, source: this.source, notice, fetchedAt: this.snapshot.fetchedAt };
  }

  async explore(query: string, mode?: 'public'): Promise<ExploreResponse> {
    if (mode === 'public') return this.publicExplore(query);
    if (!query) return this.hotExplore();
    if (!this.secret) return this.publicExplore(query);
    const existing = this.cache.get(query);
    if (existing && this.now() - existing.at < SEARCH_CACHE_MS) return existing.response;
    const pending = this.pendingSearches.get(query);
    if (pending) return pending;
    if (this.pendingSearches.size >= 4) throw new ApiError(429, 'TOO_MANY_SEARCHES', '正在处理较多探索请求，请稍后再试。');
    const task = this.search(query).finally(() => this.pendingSearches.delete(query));
    this.pendingSearches.set(query, task);
    return task;
  }

  private rememberedHotQuestion(id: string): Question | undefined {
    const now = this.now();
    for (const [key, entry] of this.hotQuestions) {
      if (now - entry.at >= HOT_QUESTION_MS) this.hotQuestions.delete(key);
    }
    return this.hotQuestions.get(id)?.question;
  }

  private rememberHotQuestions(questions: Question[]) {
    this.rememberedHotQuestion('');
    for (const question of questions) {
      const existing = this.hotQuestions.get(question.id)?.question;
      this.hotQuestions.delete(question.id);
      if (this.hotQuestions.size >= 200) this.hotQuestions.delete(this.hotQuestions.keys().next().value!);
      this.hotQuestions.set(question.id, {
        at: this.now(),
        question: existing?.answersExpanded ? { ...question, answers: existing.answers, answersExpanded: true } : question,
      });
    }
  }

  private staleHot(error: ApiError): ExploreResponse {
    if (this.hotCache && this.now() - this.hotCache.at < HOT_STALE_MS) {
      return { ...this.hotCache.response, stale: true, notice: `当前暂时无法更新知乎热榜，展示上次成功获取的热点（获取时间 ${this.hotCache.response.fetchedAt}）。${error.message}` };
    }
    throw error;
  }

  private async hotExplore(): Promise<ExploreResponse> {
    if (!this.secret) throw new ApiError(503, 'ZHIHU_NOT_CONFIGURED', '尚未配置知乎 Access Secret，暂时无法读取当前热点。');
    if (this.hotCache && this.now() - this.hotCache.at < HOT_CACHE_MS) return this.hotCache.response;
    if (this.pendingHot) return this.pendingHot;
    // A failed hot-list fetch is paced separately from answer searches.
    if (this.hotError && this.now() - this.hotAttemptAt < HOT_RETRY_MS) return this.staleHot(this.hotError);
    this.hotAttemptAt = this.now();
    const task = this.fetchHot().catch((error: unknown) => {
      this.hotError = error instanceof ApiError ? error : new ApiError(502, 'ZHIHU_HOT_FAILED', '知乎热榜暂时未能获取，请稍后重试。');
      return this.staleHot(this.hotError);
    }).finally(() => { this.pendingHot = undefined; });
    this.pendingHot = task;
    return task;
  }

  private async fetchHot(): Promise<ExploreResponse> {
    const raw = await this.fetchJson(`${HOT_URL}?Limit=20`, true);
    if (!raw || typeof raw !== 'object') throw new ApiError(502, 'UPSTREAM_INVALID_RESPONSE', '知乎热榜返回了无法识别的数据。');
    const payload = raw as { Code?: number; Data?: { Items?: HotItem[] } };
    if (payload.Code !== 0) {
      if (payload.Code === 20001) throw new ApiError(502, 'ZHIHU_AUTH_FAILED', '知乎热榜鉴权失败，请检查服务端的 Access Secret 配置。');
      if (payload.Code === 30001) throw new ApiError(429, 'ZHIHU_RATE_LIMITED', '知乎热榜额度或频率已受限，请稍后再试。');
      throw new ApiError(502, 'ZHIHU_HOT_FAILED', '知乎热榜暂时未能获取，请稍后重试。');
    }
    if (!Array.isArray(payload.Data?.Items)) throw new ApiError(502, 'UPSTREAM_INVALID_RESPONSE', '知乎热榜返回了无法识别的数据。');
    const questions = adaptHot(payload.Data.Items);
    const response: ExploreResponse = {
      query: '', keywords: [], questions, source: 'zhihu-hot', fetchedAt: new Date(this.now()).toISOString(),
      notice: questions.length
        ? '来自知乎当前热榜，按原榜顺序展示问题。进入星系后检索同一问题下的回答，热榜摘要不会作为回答。'
        : '知乎当前热榜未返回可展示的问题，可尝试搜索感兴趣的话题。',
    };
    this.hotCache = { at: this.now(), response };
    this.hotError = undefined;
    this.rememberHotQuestions(questions);
    return response;
  }

  private scheduleSearch(task: () => Promise<SearchItem[]>): Promise<SearchItem[]> {
    if (this.now() < this.searchLimitedUntil) return Promise.reject(this.searchLimitError);
    if (this.queuedSearchCount >= 4) return Promise.reject(new ApiError(429, 'TOO_MANY_SEARCHES', '正在处理较多探索请求，请稍后再试。'));
    const preceding = this.searchQueue;
    this.queuedSearchCount++;
    const scheduled = (async () => {
      await preceding;
      if (this.now() < this.searchLimitedUntil) throw this.searchLimitError;
      // A conservative local pacing rule, not a claim about the upstream's quota policy.
      const remaining = SEARCH_INTERVAL_MS - (this.now() - this.searchStartedAt);
      if (remaining > 0) await this.wait(remaining);
      if (this.now() < this.searchLimitedUntil) throw this.searchLimitError;
      this.searchStartedAt = this.now();
      try { return await task(); }
      catch (error) {
        if (error instanceof ApiError && (error.code === 'ZHIHU_RATE_LIMITED' || error.upstreamStatus === 429)) {
          this.searchLimitedUntil = this.now() + SEARCH_LIMIT_COOLDOWN_MS;
          this.searchLimitError = error;
        }
        throw error;
      }
    })().finally(() => { this.queuedSearchCount--; });
    this.searchQueue = scheduled.then(() => {}, () => {});
    return scheduled;
  }

  private searchItems(query: string): Promise<SearchItem[]> {
    return this.scheduleSearch(() => this.performSearchItems(query));
  }

  private async performSearchItems(query: string): Promise<SearchItem[]> {
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
    return payload.Data.Items.slice(0, 10);
  }

  private async search(query: string): Promise<ExploreResponse> {
    const questions = adaptSearch(await this.searchItems(query), query);
    const response: ExploreResponse = { query, keywords: extractKeywords(query), questions, source: 'zhihu-search', fetchedAt: new Date(this.now()).toISOString(), notice: questions.length ? '来自知乎实时搜索。进入问题后会按原题检索更多回答，仅合并可确认属于该问题的内容。正文为搜索摘要，完整内容请打开知乎原文。' : '知乎搜索暂未返回可展示的匹配内容，请调整关键词再试。' };
    if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(query, { at: this.now(), response });
    return response;
  }

  private async locateQuestion(questionId: string, query: string): Promise<{ question?: Question; source: SourceMode; exploration?: ExploreResponse }> {
    // Explicit public browsing and legacy saved public works remain independent
    // of hot-list availability and never consume an authenticated request.
    if (/^(?:topic-|knowledge-)/.test(questionId)) {
      const exploration = this.publicExplore(query);
      const question = exploration.questions.find((entry) => entry.id === questionId
        || (questionId.startsWith('knowledge-') && entry.answers.some((answer) => answer.id === questionId)));
      return { question, source: exploration.source, exploration };
    }
    if (!query) {
      const question = this.rememberedHotQuestion(questionId);
      if (question) return { question, source: 'zhihu-hot' };
    }
    const exploration = await this.explore(query);
    return { question: exploration.questions.find((entry) => entry.id === questionId), source: exploration.source, exploration };
  }

  async question(questionId: string, query: string): Promise<QuestionResponse> {
    if (!validNodeId(questionId)) throw new ApiError(400, 'INVALID_QUESTION_ID', '问题编号格式无效。');
    const { question, source, exploration } = await this.locateQuestion(questionId, query);
    if (!question) throw new ApiError(404, 'QUESTION_NOT_FOUND', '未找到该问题，请从本次探索结果中选择。');
    if (!['zhihu-search', 'zhihu-hot'].includes(source) || question.kind !== 'question') {
      return { question, ...(question.kind === 'topic' ? { notice: '此星系为主题聚合，各作品保留独立原题与作者，并非同一知乎问题下的回答。' } : {}) };
    }
    const key = `${query}\n${questionId}`;
    const existing = this.expandedQuestions.get(key);
    if (existing && this.now() - existing.at < SEARCH_CACHE_MS) return existing.response;
    const pending = this.pendingQuestions.get(key);
    if (pending) return pending;
    if (this.pendingQuestions.size >= 3) throw new ApiError(429, 'TOO_MANY_QUESTIONS', '正在读取较多问题，请稍后再试。');
    const task = this.expandQuestion(question, query).then((response) => {
      if (this.expandedQuestions.size >= 200) this.expandedQuestions.delete(this.expandedQuestions.keys().next().value!);
      this.expandedQuestions.set(key, { at: this.now(), response });
      // Keep known-answer lookups and repeated exploration in sync with the expanded question.
      const activeExploration = exploration ?? (source === 'zhihu-hot' ? this.hotCache?.response : undefined);
      const index = activeExploration?.questions.findIndex((entry) => entry.id === questionId) ?? -1;
      if (activeExploration && index >= 0) activeExploration.questions[index] = response.question;
      if (source === 'zhihu-hot') {
        const remembered = this.hotQuestions.get(questionId);
        if (remembered) remembered.question = response.question;
      }
      return response;
    }).finally(() => this.pendingQuestions.delete(key));
    this.pendingQuestions.set(key, task);
    return task;
  }

  private async expandQuestion(question: Question, query: string): Promise<QuestionResponse> {
    const targetQuestionId = question.url ? new URL(question.url).pathname.match(/^\/question\/(\d+)/)?.[1] : undefined;
    const targetTitle = normalizedTitle(question.title);
    const records = (await this.searchItems(question.title)).flatMap((item) => {
      const record = searchIdentity(item);
      return record?.type === 'answer' ? [record] : [];
    });
    // Missing IDs can be resolved by an exact title only if the known IDs do not conflict.
    const titleIds = new Set(records.filter((record) => normalizedTitle(record.title) === targetTitle && record.questionId).map((record) => record.questionId));
    const matching = records.filter((record) => {
      if (targetQuestionId && record.questionId) return record.questionId === targetQuestionId;
      if (normalizedTitle(record.title) !== targetTitle) return false;
      if (question.hotRank && targetQuestionId) return titleIds.size === 0 || (titleIds.size === 1 && titleIds.has(targetQuestionId));
      return Boolean(targetQuestionId) || !record.questionId || titleIds.size <= 1;
    });
    const additions = adaptSearch(matching.map((record) => record.item), query).flatMap((entry) => entry.answers);
    const answers = new Map(question.answers.map((answer) => [answer.id, answer]));
    for (const answer of additions) {
      const existing = answers.get(answer.id);
      if (!existing || answer.paragraphs.join('\n').length > existing.paragraphs.join('\n').length) answers.set(answer.id, answer);
    }
    const expanded: Question = { ...question, answers: [...answers.values()].sort((a, b) => b.relevance - a.relevance), answersExpanded: true };
    const added = expanded.answers.length - question.answers.length;
    const notice = !expanded.answers.length
      ? '知乎搜索未返回可确认属于该问题的回答。可打开问题原页查看；此处不会加入其他问题的内容。'
      : added > 0
        ? `已按问题原题检索，补充 ${added} 篇同题回答。当前共 ${expanded.answers.length} 篇可用摘要，不代表知乎的全部回答。`
        : `已按问题原题检索，暂无可确认的新增回答。保留当前 ${expanded.answers.length} 篇摘要，可打开知乎查看全部回答。`;
    return { question: expanded, notice };
  }

  async findAnswer(answerId: string, questionId: string, query: string): Promise<Answer> {
    if (!validNodeId(answerId) || !validNodeId(questionId)) throw new ApiError(400, 'INVALID_ANSWER_ID', '内容编号格式无效。');
    const { question, source } = await this.locateQuestion(questionId, query);
    const key = `${query}\n${questionId}`;
    const cached = this.expandedQuestions.get(key);
    const expanded = cached && this.now() - cached.at < (source === 'zhihu-hot' ? HOT_QUESTION_MS : SEARCH_CACHE_MS) ? cached.response.question : undefined;
    const answer = question && (expanded ?? question).answers.find((entry) => entry.id === answerId);
    if (!answer) throw new ApiError(404, 'ANSWER_NOT_FOUND', '未找到该文章，请从本次探索的问题中选择。');
    return answer;
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
