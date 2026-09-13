/** Sample the laid-out DOM, including each Markdown/KaTeX font and position.
 * This is deliberately independent of the source string: delimiters never
 * become dust, and superscripts/fractions do not flatten into a text line. */
export function paintGlyphMask(content: HTMLElement, context: CanvasRenderingContext2D) {
  const bounds = content.getBoundingClientRect();
  const scaleX = bounds.width / (content.offsetWidth || bounds.width) || 1;
  const scaleY = bounds.height / (content.offsetHeight || bounds.height) || 1;
  let glyphs = 0, mathGlyphs = 0;
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  context.fillStyle = '#fff';
  context.textBaseline = 'alphabetic';

  function clipToAncestors(element: Element) {
    let current: Element | null = element;
    while (current && current !== content.parentElement) {
      const style = getComputedStyle(current);
      if (/(hidden|clip|auto|scroll)/.test(`${style.overflowX} ${style.overflowY}`)) {
        const rect = current.getBoundingClientRect();
        context.beginPath();
        context.rect((rect.left - bounds.left) / scaleX, (rect.top - bounds.top) / scaleY, rect.width / scaleX, rect.height / scaleY);
        context.clip();
      }
      current = current.parentElement;
    }
  }

  let node: Node | null;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent || parent.closest('.katex-mathml, math, script, style, [hidden]')) continue;
    const style = getComputedStyle(parent);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    context.save();
    clipToAncestors(parent);
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const metrics = context.measureText('Hg');
    const size = parseFloat(style.fontSize) || 15;
    const ascent = metrics.fontBoundingBoxAscent || size * .8;
    const descent = metrics.fontBoundingBoxDescent || size * .2;
    let offset = 0;
    for (const character of Array.from(node.textContent ?? '')) {
      range.setStart(node, offset); offset += character.length; range.setEnd(node, offset);
      if (/\s/u.test(character)) continue;
      const rect = range.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.bottom < bounds.top || rect.top >= bounds.bottom) continue;
      const x = (rect.left - bounds.left) / scaleX;
      const y = (rect.top - bounds.top) / scaleY + (rect.height / scaleY - ascent - descent) / 2 + ascent;
      context.fillText(character, x, y);
      glyphs++;
      if (parent.closest('.katex-html')) mathGlyphs++;
    }
    context.restore();
  }

  // Fraction bars are CSS borders; radical/overbrace shapes are KaTeX SVG.
  // Sample these visible strokes too, using their actual viewport transform.
  for (const element of content.querySelectorAll<HTMLElement>('.katex-html span')) {
    const style = getComputedStyle(element), rect = element.getBoundingClientRect();
    for (const [side, thickness] of [['top', parseFloat(style.borderTopWidth)], ['bottom', parseFloat(style.borderBottomWidth)]] as const) {
      if (!thickness || !rect.width) continue;
      context.fillRect((rect.left - bounds.left) / scaleX, (rect.top - bounds.top + (side === 'bottom' ? rect.height - thickness : 0)) / scaleY, rect.width / scaleX, thickness / scaleY);
    }
  }
  for (const path of content.querySelectorAll<SVGPathElement>('.katex-html svg path')) {
    const matrix = path.getScreenCTM(), data = path.getAttribute('d');
    if (!matrix || !data) continue;
    context.save();
    clipToAncestors(path);
    context.setTransform(matrix.a / scaleX, matrix.b / scaleY, matrix.c / scaleX, matrix.d / scaleY, (matrix.e - bounds.left) / scaleX, (matrix.f - bounds.top) / scaleY);
    context.fill(new Path2D(data));
    context.restore();
  }
  return { glyphs, mathGlyphs };
}
