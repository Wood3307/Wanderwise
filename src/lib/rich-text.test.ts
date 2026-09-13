import assert from 'node:assert/strict';
import test from 'node:test';
import { hasRichSyntax, parseRichText, safeRichUrl } from './rich-text';

function kinds(text: string): string[] {
  return parseRichText(text).tokens.flatMap(token => [token.type, ...(token.children?.map(child => child.type) ?? [])]);
}

test('plain prose, prices, unclosed markers and raw HTML remain literal', () => {
  for (const text of ['知识在星际之间流动。', '报价 $20 和 $30，总计 $50。', '$12.50$', '$20 and $30', String.raw`价格 \$20`, '这是一个*未闭合标记', '<img src=x onerror=alert(1)>']) {
    assert.equal(hasRichSyntax(text), false, text);
  }
});
test('basic Markdown is parsed structurally and code shields TeX', () => {
  const types = kinds('## 标题\n\n**加粗**、*强调*、`$x^2$`\n\n> 引用\n\n1. 第一项\n2. 第二项\n\n- 内容');
  for (const kind of ['heading_open', 'strong_open', 'em_open', 'code_inline', 'blockquote_open', 'ordered_list_open', 'bullet_list_open']) assert.ok(types.includes(kind), kind);
  assert.ok(!types.includes('math_inline'));
});
test('four math delimiters preserve exact expressions with fractions and comparisons', () => {
  const text = String.raw`质量 $E=mc^2$，公式 \(a < b < c > d\)，$$\frac{a}{b}$$ 和 \[\sqrt{x}\]。`;
  const tokens = parseRichText(text).tokens.flatMap(token => token.children ?? []);
  assert.deepEqual(tokens.filter(token => token.type.startsWith('math_')).map(token => [token.type, token.content]), [
    ['math_inline', 'E=mc^2'], ['math_inline', 'a < b < c > d'], ['math_display', String.raw`\frac{a}{b}`], ['math_display', String.raw`\sqrt{x}`],
  ]);
  assert.equal(kinds('$$\nx^2 + y^2 = z^2\n$$').filter(kind => kind === 'math_display').length, 1);
});
test('unsafe links and credentials cannot become interactive destinations', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', '//evil.example', '/relative', 'https://name:pass@example.com', 'https://example.com/\nx']) assert.equal(safeRichUrl(url), undefined);
  assert.equal(safeRichUrl('https://www.zhihu.com/question/1'), 'https://www.zhihu.com/question/1');
  assert.ok(!kinds('[错误](javascript:alert(1))').includes('link_open'));
  assert.ok(kinds('[来源](https://www.zhihu.com/question/1)').includes('link_open'));
});
