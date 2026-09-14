import { createElement, Fragment, memo, type ReactNode } from 'react';
import katex from 'katex';
import type Token from 'markdown-it/lib/token.mjs';
import { parseRichText, safeRichUrl } from '../lib/rich-text';
import 'katex/dist/katex.min.css';
import './rich-text.css';

export interface RichTextProps { text: string; inline?: boolean; className?: string }

const mathCache = new Map<string, string>();
function renderMath(expression: string, display: boolean): string {
  const key = `${display}:${expression}`;
  const cached = mathCache.get(key);
  if (cached) return cached;
  // Only KaTeX-generated HTML reaches this sink. Source HTML is always React
  // text; trusted URL/HTML commands and persistent global macros are disabled.
  const html = katex.renderToString(expression, {
    displayMode: display, output: 'htmlAndMathml', throwOnError: false,
    trust: false, strict: 'ignore', maxExpand: 300, maxSize: 10,
    errorColor: '#c5dbe5', macros: {},
  });
  if (mathCache.size >= 160) mathCache.delete(mathCache.keys().next().value!);
  mathCache.set(key, html);
  return html;
}

const inlineTags = new Set(['strong', 'em', 's', 'code']);
const blockTags = new Set(['p', 'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td']);

function renderTokens(tokens: Token[], compact: boolean, prefix = ''): ReactNode[] {
  let cursor = 0;
  function consume(): ReactNode[] {
    const nodes: ReactNode[] = [];
    while (cursor < tokens.length) {
      const token = tokens[cursor++], key = `${prefix}${cursor}`;
      if (token.nesting === -1) break;
      if (token.nesting === 1) {
        const children = consume();
        if (token.hidden) { nodes.push(<Fragment key={key}>{children}</Fragment>); continue; }
        if (token.tag === 'a') {
          const href = safeRichUrl(token.attrGet('href') ?? '');
          nodes.push(compact || !href
            ? <span className="rich-link-text" key={key}>{children}</span>
            : <a key={key} href={href} target="_blank" rel="noopener noreferrer" onClick={event => event.stopPropagation()}>{children}</a>);
        } else if (inlineTags.has(token.tag) || blockTags.has(token.tag)) {
          const tag = compact && blockTags.has(token.tag) ? 'span' : token.tag;
          nodes.push(createElement(tag, {
            key, className: `rich-${token.tag}`,
            ...(tag === 'ol' && token.attrGet('start') ? { start: Number(token.attrGet('start')) } : {}),
          }, children));
        } else nodes.push(<Fragment key={key}>{children}</Fragment>);
        continue;
      }
      if (token.type === 'inline') nodes.push(<Fragment key={key}>{renderTokens(token.children ?? [], compact, `${key}-`)}</Fragment>);
      else if (token.type === 'text') nodes.push(token.content);
      else if (token.type === 'code_inline') nodes.push(<code key={key}>{token.content}</code>);
      else if (token.type === 'code_block' || token.type === 'fence') nodes.push(compact
        ? <span className="rich-pre" key={key}><code>{token.content.trimEnd()}</code></span>
        : <pre key={key}><code>{token.content.trimEnd()}</code></pre>);
      else if (token.type === 'math_inline' || token.type === 'math_display') nodes.push(
        // Compact labels change CSS layout, never TeX's display semantics:
        // align/equation environments require displayMode even in a label.
        <span key={key} className={`rich-math ${token.type === 'math_display' && !compact ? 'rich-math-display' : ''}`}
          dangerouslySetInnerHTML={{ __html: renderMath(token.content, token.type === 'math_display') }} />,
      );
      else if (token.type === 'softbreak' || token.type === 'hardbreak') nodes.push(<br key={key} />);
      else if (token.type === 'hr') nodes.push(compact ? <span key={key} className="rich-rule"> · </span> : <hr key={key} />);
      // External image fetching is deliberately absent from this text renderer.
      else if (token.type === 'image') nodes.push(<span key={key}>{token.content}</span>);
      else if (token.content) nodes.push(token.content);
    }
    return nodes;
  }
  return consume();
}

export default memo(function RichText({ text, inline = false, className = '' }: RichTextProps) {
  const parsed = parseRichText(text);
  const content = parsed.rich ? renderTokens(parsed.tokens, inline) : text;
  const classes = `rich-text ${inline ? 'rich-text-inline' : 'rich-text-block'} ${parsed.rich ? 'rich-formatted' : 'rich-plain'} ${className}`;
  return inline ? <span className={classes}>{content}</span> : <div className={classes}>{content}</div>;
});
