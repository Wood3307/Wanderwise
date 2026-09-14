import type { JourneyStop, Reflection, SavedItem } from '../types';
import { loadCurrentJourney, saveCurrentJourney } from './trip';

const KEYS = {
  collection: 'wanderwise.collection.v1',
  reflections: 'wanderwise.reflections.v1',
} as const;

const MAX_RECORDS = { collection: 500, reflections: 500 } as const;
const MAX_STORAGE_LENGTH = 4_000_000;
type RecordValidator<T> = (value: unknown) => T | undefined;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function text(value: unknown, max: number, allowEmpty = false): value is string {
  return typeof value === 'string' && value.length <= max && (allowEmpty || value.trim().length > 0);
}

function optionalText(value: unknown, max: number): value is string | undefined {
  return value === undefined || text(value, max, true);
}

function timestamp(value: unknown): value is string {
  return text(value, 64) && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}

function sourceUrl(value: unknown): string | undefined {
  if (!text(value, 4000)) return undefined;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

const savedItem: RecordValidator<SavedItem> = (value) => {
  const item = record(value);
  if (!item || !text(item.id, 512) || (item.type !== 'question' && item.type !== 'answer')
    || !text(item.title, 2000) || !text(item.excerpt, 30_000, true)
    || !text(item.questionId, 512) || !text(item.query, 300, true)
    || !timestamp(item.savedAt) || !optionalText(item.author, 1000)
    || !optionalText(item.answerId, 512) || !optionalText(item.url, 4000)) return undefined;
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    excerpt: item.excerpt,
    questionId: item.questionId,
    query: item.query,
    savedAt: item.savedAt,
    ...(item.author !== undefined ? { author: item.author } : {}),
    ...(item.answerId !== undefined ? { answerId: item.answerId } : {}),
    ...(sourceUrl(item.url) ? { url: sourceUrl(item.url) } : {}),
  };
};

const reflection: RecordValidator<Reflection> = (value) => {
  const item = record(value);
  if (!item || !text(item.id, 512) || !text(item.targetId, 512)
    || !text(item.targetTitle, 2000) || !text(item.text, 50_000)
    || !text(item.query, 300, true) || !timestamp(item.createdAt)
    || !optionalText(item.quote, 30_000)) return undefined;
  return {
    id: item.id,
    targetId: item.targetId,
    targetTitle: item.targetTitle,
    text: item.text,
    query: item.query,
    createdAt: item.createdAt,
    ...(item.quote !== undefined ? { quote: item.quote } : {}),
  };
};

function read<T extends { id: string }>(key: string, limit: number, validate: RecordValidator<T>, identity: (item: T) => string = item => item.id): T[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw || raw.length > MAX_STORAGE_LENGTH) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const result: T[] = [];
    // Do not traverse an unbounded imported or corrupted array.
    for (const value of parsed.slice(0, limit * 2)) {
      const item = validate(value);
      if (!item || seen.has(identity(item))) continue;
      result.push(item);
      seen.add(identity(item));
      if (result.length === limit) break;
    }
    return result;
  } catch {
    // Private browsing, disabled storage, and malformed JSON must not block entry.
    return [];
  }
}

function write<T extends { id: string }>(key: string, items: T[], limit: number, validate: RecordValidator<T>, identity: (item: T) => string = item => item.id): boolean {
  try {
    if (!Array.isArray(items)) return false;
    const normalized: T[] = [];
    const seen = new Set<string>();
    for (const value of items.slice(0, limit)) {
      const item = validate(value);
      if (!item) return false;
      if (!seen.has(identity(item))) normalized.push(item);
      seen.add(identity(item));
    }
    const serialized = JSON.stringify(normalized);
    if (serialized.length > MAX_STORAGE_LENGTH) return false;
    window.localStorage.setItem(key, serialized);
    return true;
  } catch {
    return false;
  }
}

const savedIdentity = (item: SavedItem) => `${item.type}:${item.id}`;
export const loadCollection = (): SavedItem[] => read(KEYS.collection, MAX_RECORDS.collection, savedItem, savedIdentity);
export const saveCollection = (items: SavedItem[]): boolean => write(KEYS.collection, items, MAX_RECORDS.collection, savedItem, savedIdentity);
export const loadReflections = (): Reflection[] => read(KEYS.reflections, MAX_RECORDS.reflections, reflection);
export const saveReflections = (items: Reflection[]): boolean => write(KEYS.reflections, items, MAX_RECORDS.reflections, reflection);
export const loadJourney = loadCurrentJourney;
export const saveJourney = saveCurrentJourney;

function markdown(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/([\\`*_{}\[\]()#+.!|~-])/g, '\\$1');
}

function quote(value: string): string {
  return value.split(/\r?\n/).map((line) => `> ${markdown(line)}`).join('\n');
}

/** Export only source excerpts and the user's own notes; no inferred insights. */
export function exportNotebook(collection: SavedItem[], reflections: Reflection[], journey: JourneyStop[]): string {
  const lines = [
    '# Wanderwise · 认知旅行手记',
    '',
    `导出时间：${new Date().toISOString()}`,
    '',
    '这份手记记录本机保存的知乎内容摘录、你写下的思考和本次旅行的探索足迹。摘录不等于原文全文，请通过来源链接阅读原文。',
    '',
    '## 知识行囊',
    '',
  ];
  if (!collection.length) lines.push('尚未收藏内容。', '');
  for (const item of collection) {
    lines.push(`### ${markdown(item.title).replace(/\r?\n/g, ' ')}`, '',
      `类型：${item.type === 'question' ? '问题' : '回答'}${item.author ? ` · 作者：${markdown(item.author)}` : ''}`,
      '', `出发问题：${markdown(item.query || '未指定')}`, '', `收藏时间：${item.savedAt}`, '');
    const url = sourceUrl(item.url);
    if (url) lines.push(`[阅读知乎原文](<${url.replace(/</g, '%3C').replace(/>/g, '%3E')}>)`, '');
    if (item.excerpt) lines.push('内容摘录：', '', quote(item.excerpt), '');
  }
  lines.push('## 我的思考', '');
  if (!reflections.length) lines.push('尚未留下思考。', '');
  for (const item of reflections) {
    lines.push(`### ${markdown(item.targetTitle).replace(/\r?\n/g, ' ')}`, '',
      `记录时间：${item.createdAt}`, '', `出发问题：${markdown(item.query || '未指定')}`, '');
    if (item.quote) lines.push('触发这段思考的原文摘录：', '', quote(item.quote), '');
    lines.push('我的思考：', '', markdown(item.text), '');
  }
  lines.push('## 探索足迹', '');
  if (!journey.length) lines.push('尚未产生探索足迹。', '');
  for (const item of [...journey].sort((a, b) => Date.parse(a.visitedAt) - Date.parse(b.visitedAt))) {
    lines.push(`- ${item.visitedAt} · ${item.type === 'question' ? '问题' : '回答'}：${markdown(item.title).replace(/\r?\n/g, ' ')}（出发问题：${markdown(item.query || '未指定')}）`);
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function downloadMarkdown(content: string, filename: string): void {
  const blob = new Blob(['\uFEFF', content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const safeName = filename.replace(/[\\/\u0000-\u001F]/g, '-').slice(0, 180) || 'wanderwise-notebook.md';
  link.download = safeName.endsWith('.md') ? safeName : `${safeName}.md`;
  link.hidden = true;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Allow the browser to start consuming the Blob before releasing it.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
