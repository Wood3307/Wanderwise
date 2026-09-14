import assert from 'node:assert/strict';
import test from 'node:test';
import katex from 'katex';
import type Token from 'markdown-it/lib/token.mjs';
import { hasRichSyntax, parseRichText, safeRichUrl } from './rich-text';

function kinds(text: string): string[] {
  return parseRichText(text).tokens.flatMap(token => [token.type, ...(token.children?.map(child => child.type) ?? [])]);
}

function equations(text: string): Token[] {
  const walk = (tokens: Token[]): Token[] => tokens.flatMap(token => [token, ...walk(token.children ?? [])]);
  return walk(parseRichText(text).tokens).filter(token => token.type.startsWith('math_'));
}

function assertValidMath(text: string, expected: string[]): void {
  const math = equations(text);
  assert.deepEqual(math.map(token => token.content), expected);
  for (const token of math) {
    const html = katex.renderToString(token.content, { displayMode: token.type === 'math_display', throwOnError: true });
    assert.ok(html.includes('encoding="application/x-tex"'), 'a real expression reaches KaTeX');
    assert.ok(!html.includes('katex-error'), 'the equation renders rather than falling back to error text');
  }
}

test('plain prose, prices, unclosed markers and raw HTML remain literal', () => {
  for (const text of ['知识在星际之间流动。', '报价 $20 和 $30，总计 $50。', '$12.50', '$20 and $30', String.raw`价格 \$20`, '这是一个*未闭合标记', '<img src=x onerror=alert(1)>']) {
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

test('display equations survive blank lines and Markdown-looking aligned rows intact', () => {
  const expression = String.raw`
f(x) = \begin{cases}
x_1^2 & x > 0 \\

0 & x \le 0
\end{cases}
`;
  assertValidMath(`推导如下：\n$$${expression}$$\n下一段 **结论**。`, [expression]);
  assertValidMath(`\\[${expression}\\]`, [expression]);
  assert.ok(kinds(`$$${expression}$$`).every(type => type === 'math_display'));
  assert.ok(kinds(`$$${expression}$$\n\n**结论**`).includes('strong_open'));
});

test('explicit numeric and padded inline math renders without claiming currency or escaped dollars', () => {
  assertValidMath(String.raw`令 $2$ 个样本满足 $ x_i $，求 $10+20$ 与 $\frac{1}{2}$。`, ['2', ' x_i ', '10+20', String.raw`\frac{1}{2}`]);
  assertValidMath('近似值 $3.14$，误差 $0.01$，边界 $12.50$。', ['3.14', '0.01', '12.50']);
  for (const text of ['$20 and $30', '报价 $20 和 $30。', '$12.50', String.raw`\$12.50`, String.raw`\$x_i\$`, '$x_i', '`$ x_i $`']) {
    assert.deepEqual(equations(text), [], text);
  }
});

test('bare math environments and explicitly named math fences render complete TeX', () => {
  const aligned = String.raw`\begin{align*}
a_i &= b_i + c_i \\
x &= \frac{1}{2}
\end{align*}`;
  const matrix = String.raw`\begin{pmatrix}a & b \\ c & d\end{pmatrix}`;
  assertValidMath(aligned, [aligned]);
  assertValidMath(`计算 ${matrix} 的行列式。`, [matrix]);
  for (const language of ['math', 'latex']) {
    assertValidMath('```' + language + '\n' + aligned + '\n```', [aligned]);
  }
  assertValidMath('```math\n$$\\frac{a_i}{b_i}$$\n```', [String.raw`\frac{a_i}{b_i}`]);
  for (const language of ['', 'js', 'text']) {
    assert.deepEqual(equations('```' + language + '\n' + aligned + '\n```'), [], language);
  }
  assert.deepEqual(equations('    ' + matrix), [], 'indented code remains code');
});

test('math blocks respect Markdown containers and preserve following content', () => {
  const expression = String.raw`
\begin{aligned}
a_1 &= 2 \\

a_2 &= 3
\end{aligned}
`;
  const quoted = (`$$${expression}$$`).split('\n').map(line => `> ${line}`).join('\n');
  assertValidMath(`${quoted}\n\n后续内容`, [expression]);
  assert.ok(kinds(`${quoted}\n\n后续内容`).includes('blockquote_open'));
  assertValidMath('- 项目\n\n  $$\n  x_i = 2\n  $$\n\n- 下一项', ['\nx_i = 2\n']);
  const unclosed = String.raw`$$\begin{cases} x & y`;
  assert.deepEqual(equations(unclosed), []);
  assert.deepEqual(equations(`$$${'x'.repeat(4001)}$$`), [], 'oversized equations remain source text');
});
