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

const maxMathLength = 4000;
const mathEnvironment = /^\\begin\{((?:align(?:ed|at)?|alignedat|gather(?:ed)?|equation|[pbBvV]?matrix|smallmatrix|cases|array|darray|split|subarray|CD)\*?)\}/;

interface MathMatch { expression: string; display: boolean; end: number; markup: string }
function matchMath(source: string, start: number, limit = source.length): MathMatch | undefined {
  if (escapedAt(source, start)) return;
  const environment = source.slice(start, start + 32).match(mathEnvironment);
  if (environment) {
    const opening = environment[0], closing = `\\end{${environment[1]}}`;
    let cursor = start + opening.length, depth = 1;
    while (cursor < limit && cursor - start <= maxMathLength) {
      const end = source.indexOf(closing, cursor);
      if (end < 0 || end + closing.length > limit) return;
      const nested = source.indexOf(opening, cursor);
      if (nested >= 0 && nested < end && !escapedAt(source, nested)) {
        depth++; cursor = nested + opening.length; continue;
      }
      cursor = end + closing.length;
      if (!escapedAt(source, end) && --depth === 0) {
        const expression = source.slice(start, cursor);
        return expression.length <= maxMathLength
          ? { expression, display: true, end: cursor, markup: opening } : undefined;
      }
    }
    return;
  }
  const opening = source.startsWith('\\(', start) ? '\\('
    : source.startsWith('\\[', start) ? '\\['
      : source.startsWith('$$', start) ? '$$'
        : source[start] === '$' ? '$' : '';
  if (!opening) return;
  const closing = opening === '\\(' ? '\\)' : opening === '\\[' ? '\\]' : opening;
  const display = opening === '$$' || opening === '\\[';
  const from = start + opening.length;
  if (opening === '$' && source[start - 1] === '$') return;
  let end = source.indexOf(closing, from);
  while (end >= 0 && escapedAt(source, end)) end = source.indexOf(closing, end + closing.length);
  if (end < 0 || end + closing.length > limit) return;
  const expression = source.slice(from, end);
  if (!expression.trim() || expression.length > maxMathLength) return;
  if (opening === '$') {
    // Keep ordinary prices literal while accepting numeric mathematics and
    // padding inside explicitly paired delimiters (e.g. $2$, $ x_i $).
    if (/\d/.test(source[end + 1] ?? '')
      || expression.includes('\n') || /[\u3400-\u9fff]/u.test(expression.replace(/\\text\{[^}]*\}/g, ''))
      || !/[\dA-Za-z\\^_=+*/<>\u03b1-\u03c9]/u.test(expression)) return;
  }
  return { expression, display, end: end + closing.length, markup: opening };
}

// Claim whole display formulas before Markdown can split them at an empty line
// or interpret aligned rows, underscores, and asterisks as Markdown syntax.
// Indented code and enclosing code fences retain Markdown's normal precedence.
markdown.block.ruler.before('fence', 'celestial_math_block', (state, startLine, endLine, silent) => {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const start = state.bMarks[startLine] + state.tShift[startLine];
  if (!/^(?:\$\$|\\\[|\\begin\{)/.test(state.src.slice(start, start + 8))) return false;
  let content = '';
  for (let line = startLine; line < endLine && content.length <= maxMathLength + 64; line++) {
    if (line > startLine && !state.isEmpty(line) && state.sCount[line] < state.blkIndent) break;
    content = state.getLines(startLine, line + 1, state.blkIndent, false).trimStart();
    const matched = matchMath(content, 0);
    if (!matched) continue;
    // Inline prose following the closing delimiter belongs to the inline rule.
    if (content.slice(matched.end).trim()) return false;
    if (silent) return true;
    const token = state.push('math_display', 'math', 0);
    token.content = matched.expression;
    token.markup = matched.markup;
    token.map = [startLine, line + 1];
    state.line = line + 1;
    return true;
  }
  return false;
}, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });

// Runs before backslash escaping; code spans still consume their entire source
// at their opening backtick, so equations inside ordinary code remain literal.
markdown.inline.ruler.before('escape', 'celestial_math', (state, silent) => {
  const matched = matchMath(state.src, state.pos, state.posMax);
  if (!matched) return false;
  if (!silent) {
    const token = state.push(matched.display ? 'math_display' : 'math_inline', 'math', 0);
    token.content = matched.expression;
    token.markup = matched.markup;
  }
  state.pos = matched.end;
  return true;
});

// A fence explicitly labelled math/latex is a formula; all other languages,
// including unlabelled fences, remain code with no interpretation of TeX.
markdown.core.ruler.after('block', 'celestial_math_fence', state => {
  for (const token of state.tokens) {
    if (token.type !== 'fence' || !/^(?:math|latex)$/i.test(token.info.trim())
      || !token.content.trim() || token.content.length > maxMathLength) continue;
    const expression = token.content.trim();
    const matched = matchMath(expression, 0);
    token.type = 'math_display';
    token.tag = 'math';
    token.content = matched?.end === expression.length ? matched.expression : expression;
  }
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
