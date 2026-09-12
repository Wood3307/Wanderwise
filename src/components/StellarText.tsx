import { useEffect, useRef, useState } from 'react';

type StellarTextProps = {
  text: string;
  phase: 'enter' | 'exit';
  reducedMotion: boolean;
  className?: string;
};

/** DOM text remains selectable and accessible; sampled glyph dust supplies the transition. */
export default function StellarText({ text, phase, reducedMotion, className = '' }: StellarTextProps) {
  const [fontRevision, setFontRevision] = useState(0);
  useEffect(() => {
    let active = true;
    const refresh = () => { if (active) setFontRevision(value => value + 1); };
    void document.fonts.ready.then(refresh);
    document.fonts.addEventListener('loadingdone', refresh);
    return () => { active = false; document.fonts.removeEventListener('loadingdone', refresh); };
  }, []);
  const contentRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const content = contentRef.current, canvas = canvasRef.current;
    if (!content || !canvas || reducedMotion || document.fonts.status === 'loading') return;
    const bounds = content.getBoundingClientRect();
    const width = Math.ceil(bounds.width), height = Math.ceil(bounds.height);
    if (!width || !height) return;
    const computed = getComputedStyle(content);
    const padding = 74;
    const mask = document.createElement('canvas');
    mask.width = width; mask.height = height;
    const maskContext = mask.getContext('2d', { willReadFrequently: true });
    const context = canvas.getContext('2d');
    if (!maskContext || !context) return;
    maskContext.font = `${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`;
    maskContext.textBaseline = 'top';
    maskContext.fillStyle = '#fff';
    const fontSize = parseFloat(computed.fontSize) || 15;
    const lineHeight = parseFloat(computed.lineHeight) || fontSize * 1.7;
    const letterSpacing = parseFloat(computed.letterSpacing) || 0;
    const measure = (line: string) => maskContext.measureText(line).width + Math.max(0, Array.from(line).length - 1) * letterSpacing;
    const drawLine = (line: string, top: number) => {
      const lineWidth = measure(line);
      let left = computed.textAlign === 'center' ? (width - lineWidth) / 2 : computed.textAlign === 'right' ? width - lineWidth : 0;
      for (const character of Array.from(line)) { maskContext.fillText(character, left, top); left += maskContext.measureText(character).width + letterSpacing; }
    };
    let line = '', top = Math.max(0, (lineHeight - fontSize) / 2);
    for (const character of Array.from(text)) {
      if (character === '\n' || (line && measure(line + character) > width - 1)) {
        drawLine(line, top); top += lineHeight; line = character === '\n' ? '' : character;
      } else line += character;
    }
    drawLine(line, top);
    const pixels = maskContext.getImageData(0, 0, width, height).data;
    const particles: { x: number; y: number; dx: number; dy: number; size: number; delay: number }[] = [];
    const step = width * height > 30000 ? 4 : 3;
    for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) {
      if (pixels[(y * width + x) * 4 + 3] < 60) continue;
      const seed = Math.sin(x * 12.9898 + y * 78.233 + text.length) * 43758.5453;
      const random = seed - Math.floor(seed);
      const angle = random * Math.PI * 2;
      particles.push({ x: x + padding, y: y + padding, dx: Math.cos(angle) * (18 + random * 100), dy: Math.sin(angle) * (18 + random * 65), size: random > .84 ? 1.6 : .8, delay: random * .13 });
    }
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = (width + padding * 2) * ratio;
    canvas.height = (height + padding * 2) * ratio;
    canvas.style.width = `${width + padding * 2}px`;
    canvas.style.height = `${height + padding * 2}px`;
    context.scale(ratio, ratio);
    let frame = 0, started = 0;
    const duration = phase === 'exit' ? 680 : 1040;
    const animate = (time: number) => {
      if (!started) started = time;
      const progress = Math.min(1, (time - started) / duration);
      context.clearRect(0, 0, width + padding * 2, height + padding * 2);
      for (const particle of particles) {
        const p = Math.max(0, Math.min(1, (progress - particle.delay) / (1 - particle.delay)));
        const scatter = phase === 'enter' ? Math.pow(1 - p, 2.6) : p * p;
        const opacity = phase === 'enter' ? Math.sin(Math.PI * p) * .9 : Math.pow(1 - p, 1.5) * .85;
        context.globalAlpha = opacity;
        context.fillStyle = particle.size > 1 ? '#eaf6ff' : '#9dbfcf';
        context.fillRect(particle.x + particle.dx * scatter, particle.y + particle.dy * scatter, particle.size, particle.size);
      }
      if (progress < 1) frame = requestAnimationFrame(animate);
      else context.clearRect(0, 0, width + padding * 2, height + padding * 2);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [text, phase, reducedMotion, fontRevision]);
  return <span className={`stellar-text stellar-text-${phase} ${className}`}>
    <span ref={contentRef} className="stellar-text-content">{text}</span>
    {!reducedMotion && <canvas ref={canvasRef} className="stellar-text-dust" aria-hidden="true" />}
  </span>;
}
