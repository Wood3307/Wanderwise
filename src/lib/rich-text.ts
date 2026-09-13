import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';

/** Source text is never rewritten: parsing is a presentation-only operation. */
export function safeRichUrl(value: string): string | undefined {
  if (/\s|[\u0000-\u001f\u007f]/u.test(value)) return undefined;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
      ? url.href : undefined;
  } catch { return undefined; }
}

const markdown = new MarkdownIt({ html: false, breaks: true, linkify: false, typographer: false });
markdown.validateLink = value => Boolean(safeRichUrl(value));

function escapedAt(source: string, index: number): boolean {
  let count = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor--) count++;
  return count % 2 === 1;
}

// Runs before Markdown's backslash escaping, and after code spans have claimed
// their content. Dollar math requires a non-currency expression; explicit TeX
// delimiters remain available for numeric-only mathematics.
markdown.inline.ruler.before('escape', 'celestial_math', (state, silent) => {
  const start = state.pos, source = state.src;
  const opening = source.startsWith('\\(', start) ? '\\('
    : source.startsWith('\\[', start) ? '\\['
      : source.startsWith('$$', start) ? '$$'
        : source[start] === '$' ? '$' : '';
  if (!opening || escapedAt(source, start)) return false;
  const closing = opening === '\\(' ? '\\)' : opening === '\\[' ? '\\]' : opening;
  const display = opening === '$$' || opening === '\\[';
  const from = start + opening.length;
  if (opening === '$' && (/\s/.test(source[from] ?? '') || source[start - 1] === '$')) return false;
  let end = source.indexOf(closing, from);
  while (end >= 0 && escapedAt(source, end)) end = source.indexOf(closing, end + closing.length);
  if (end < 0 || end >= state.posMax) return false;
  const expression = source.slice(from, end);
  if (!expression.trim() || expression.length > 4000) return false;
  if (opening === '$') {
    // Do not turn "$20 and $30", "$12.50$", escaped prices, or ordinary
    // Chinese prose between currency symbols into equations.
    if (/\s/.test(source[end - 1] ?? '') || /\d/.test(source[end + 1] ?? '')
      || expression.includes('\n') || /[\u3400-\u9fff]/u.test(expression.replace(/\\text\{[^}]*\}/g, ''))
      || /^[\d\s,.+-]+$/.test(expression)
      || !/[A-Za-z\\^_=+*/<>\u03b1-\u03c9]/u.test(expression)) return false;
  }
  if (!silent) {
    const token = state.push(display ? 'math_display' : 'math_inline', 'math', 0);
    token.content = expression;
    token.markup = opening;
  }
  state.pos = end + closing.length;
  return true;
});

export interface ParsedRichText { tokens: Token[]; rich: boolean }
const cache = new Map<string, ParsedRichText>();
const ordinary = new Set(['paragraph_open', 'paragraph_close', 'inline', 'text', 'softbreak']);
function containsMarkup(tokens: Token[]): boolean {
  return tokens.some(token => !ordinary.has(token.type) || (token.children && containsMarkup(token.children)));
}
export function parseRichText(text: string): ParsedRichText {
  const existing = cache.get(text);
  if (existing) return existing;
  // Typical source prose takes the cheapest path and retains exact whitespace.
  const tokens = /[*_`~#$\\\[\]<>|\n]/.test(text) || /^\s*(?:\d+[.)]|[-+])\s/.test(text)
    ? markdown.parse(text, {}) : [];
  const parsed = { tokens, rich: containsMarkup(tokens) };
  if (cache.size >= 160) cache.delete(cache.keys().next().value!);
  cache.set(text, parsed);
  return parsed;
}

export const hasRichSyntax = (text: string): boolean => parseRichText(text).rich;
