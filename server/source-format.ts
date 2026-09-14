/** Source ranges that must remain whole when forming excerpts or paragraphs. */
export interface SourceLiteral { start: number; end: number; kind: 'math' | 'code' }

function escapedAt(source: string, index: number): boolean {
  let slashes = 0;
  while (index > 0 && source[--index] === '\\') slashes++;
  return slashes % 2 === 1;
}

const environments = /^(?:align(?:ed|at)?|alignedat|gather(?:ed)?|equation|[pbBvV]?matrix|smallmatrix|cases|array|darray|split|subarray|CD)\*?$/;

/** Linear scan of the bounded source body; code takes precedence over TeX. */
export function sourceLiterals(source: string): SourceLiteral[] {
  const spans: SourceLiteral[] = [];
  const openings = /`+|~{3,}|\${1,2}|\\[\[(]|\\begin\{([A-Za-z*]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = openings.exec(source))) {
    const start = match.index, opening = match[0];
    if (escapedAt(source, start)) continue;
    let end = -1;
    let kind: SourceLiteral['kind'] = 'math';
    if (opening[0] === '`' || opening[0] === '~') {
      kind = 'code';
      const lineStart = source.lastIndexOf('\n', start - 1) + 1;
      const fence = opening.length >= 3 && /^[ \t]{0,3}$/.test(source.slice(lineStart, start));
      if (fence) {
        const newline = source.indexOf('\n', start + opening.length);
        if (newline < 0) end = source.length;
        else {
          const close = new RegExp(`^[ \\t]{0,3}${opening[0]}{${opening.length},}[ \\t]*(?=\\n|$)`, 'gm');
          close.lastIndex = newline + 1;
          const closing = close.exec(source);
          // An unfinished fence is still code through the end of the source.
          end = closing ? closing.index + closing[0].length : source.length;
        }
      } else if (opening[0] === '`') {
        let cursor = source.indexOf(opening, start + opening.length);
        while (cursor >= 0 && (source[cursor - 1] === '`' || source[cursor + opening.length] === '`')) cursor = source.indexOf(opening, cursor + opening.length);
        if (cursor >= 0) end = cursor + opening.length;
      }
    } else if (match[1]) {
      if (!environments.test(match[1])) continue;
      const closing = `\\end{${match[1]}}`;
      let cursor = start + opening.length, depth = 1;
      while (cursor < source.length) {
        const closeAt = source.indexOf(closing, cursor);
        if (closeAt < 0) break;
        const nestedAt = source.indexOf(opening, cursor);
        if (nestedAt >= 0 && nestedAt < closeAt && !escapedAt(source, nestedAt)) {
          depth++; cursor = nestedAt + opening.length; continue;
        }
        cursor = closeAt + closing.length;
        if (!escapedAt(source, closeAt) && --depth === 0) { end = cursor; break; }
      }
    } else {
      const closing = opening === '\\(' ? '\\)' : opening === '\\[' ? '\\]' : opening;
      let cursor = source.indexOf(closing, start + opening.length);
      while (cursor >= 0 && (escapedAt(source, cursor) || (opening === '$' && (source[cursor - 1] === '$' || source[cursor + 1] === '$')))) cursor = source.indexOf(closing, cursor + closing.length);
      if (cursor >= 0) {
        const expression = source.slice(start + opening.length, cursor);
        // Dollar-delimited inline math never crosses prose paragraphs or prices.
        if (opening === '$' && (expression.includes('\n') || /\d/.test(source[cursor + 1] ?? '')
          || /[\u3400-\u9fff]/u.test(expression.replace(/\\text\{[^}]*\}/g, '')))) continue;
        if (expression.trim()) end = cursor + closing.length;
      }
    }
    if (end < 0) continue;
    spans.push({ start, end, kind });
    openings.lastIndex = end;
  }
  return spans;
}

/** A contiguous prefix, expanding only within a hard bound to finish a literal. */
export function sourcePrefix(source: string, preferred: number, maximum = preferred): string {
  if (source.length <= preferred) return source;
  let end = preferred;
  const crossing = sourceLiterals(source).find(span => span.start < end && span.end > end);
  if (crossing) end = crossing.end <= maximum ? crossing.end : crossing.start;
  // Do not split a surrogate pair when shortening plain prose.
  if (end > 0 && /[\uD800-\uDBFF]/.test(source[end - 1])) end--;
  return source.slice(0, end).trimEnd();
}
