import { useEffect, useRef } from "react";
import { wormholeWheelCharge } from "./space/wormhole";
import "./wormhole.css";

export interface WormholePortalProps {
  onEnter: () => void;
  disabled?: boolean;
  reducedMotion: boolean;
}

const noise = (seed: number) => {
  const n = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return n - Math.floor(n);
};

/** Accretion clouds and 48,000 grains are cached once, keeping the live vortex inexpensive. */
function createAccretionDust() {
  const texture = document.createElement("canvas");
  texture.width = texture.height = 768;
  const ctx = texture.getContext("2d");
  if (!ctx) return texture;
  ctx.scale(2, 2);
  ctx.translate(192, 192);
  ctx.globalCompositeOperation = "lighter";
  for (let cloud = 0; cloud < 220; cloud++) {
    const u = noise(cloud * 7 + 17);
    const radius = 21 + Math.pow(u, 0.8) * 149;
    const arm = cloud % 4;
    const angle = arm * Math.PI / 2 - Math.log(radius / 170) * 2.7 + noise(cloud + 123) * 0.55;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const size = 6 + noise(cloud + 31) * 15;
    const fog = ctx.createRadialGradient(x, y, 0, x, y, size);
    fog.addColorStop(0, cloud % 5 === 0 ? "rgba(121,217,255,.27)" : "rgba(19,139,227,.23)");
    fog.addColorStop(0.4, "rgba(28,155,230,.105)");
    fog.addColorStop(1, "rgba(25,104,194,0)");
    ctx.fillStyle = fog;
    ctx.fillRect(x - size, y - size, size * 2, size * 2);
  }
  for (let grain = 0; grain < 48000; grain++) {
    const u = noise(grain * 3 + 17);
    const radius = 19 + Math.pow(u, 0.85) * 153;
    const angle = noise(grain * 3 + 29) * Math.PI * 2;
    const spiral = 0.5 + 0.5 * Math.sin(angle * 4 + Math.log(radius / 170) * 10.8);
    const filament = Math.pow(spiral, 3) * 0.83 + 0.17;
    const alpha = filament * (0.12 + noise(grain * 3 + 43) * 0.62) * Math.sin(Math.PI * u) ** 0.35;
    const grainSize = 0.2 + noise(grain + 12001) ** 5 * 1.05;
    ctx.fillStyle = grain % 13 === 0 ? `rgba(229,239,255,${alpha})` : `rgba(83,196,255,${alpha})`;
    ctx.fillRect(Math.cos(angle) * radius, Math.sin(angle) * radius, grainSize, grainSize);
  }
  return texture;
}

/** The portal is an independent, bounded canvas; it never touches the galaxy camera. */
export default function WormholePortal({ onEnter, disabled = false, reducedMotion }: WormholePortalProps) {
  const button = useRef<HTMLButtonElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ onEnter, disabled });
  const charge = useRef(0);
  const hovered = useRef(false);
  const entered = useRef(false);

  useEffect(() => { latest.current = { onEnter, disabled }; }, [onEnter, disabled]);

  useEffect(() => {
    const element = button.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (latest.current.disabled || entered.current) return;
      charge.current = Math.max(0, Math.min(1, charge.current + wormholeWheelCharge(event.deltaY, event.deltaMode, innerHeight)));
      if (charge.current >= 0.96) {
        entered.current = true;
        latest.current.onEnter();
      }
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);

  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext("2d", { alpha: true });
    if (!element || !ctx) return;
    const size = 384;
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    element.width = size * ratio;
    element.height = size * ratio;
    ctx.scale(ratio, ratio);
    const dust = createAccretionDust();
    let frame = 0;
    let previous = 0;
    let time = 0;
    let previousCharge = -1;
    const draw = () => {
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.translate(192, 185);
      ctx.rotate(-0.32);
      const c = charge.current;
      ctx.scale(1 + c * 0.1, 1 + c * 0.1);
      const halo = ctx.createRadialGradient(0, 0, 2, 0, 0, 180);
      halo.addColorStop(0, "rgba(115,224,255,.35)");
      halo.addColorStop(0.25, "rgba(30,167,239,.16)");
      halo.addColorStop(0.64, "rgba(17,73,142,.09)");
      halo.addColorStop(1, "rgba(18,58,105,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(-192, -192, 384, 384);
      ctx.globalCompositeOperation = "lighter";
      ctx.save();
      ctx.scale(1, 0.73);
      ctx.rotate(time * 0.07);
      ctx.drawImage(dust, -192, -192, 384, 384);
      ctx.globalAlpha = 0.3;
      ctx.rotate(0.09 - time * 0.11);
      ctx.scale(0.93, 0.93);
      ctx.drawImage(dust, -192, -192, 384, 384);
      ctx.restore();
      // Nested logarithmic filaments steepen toward the bright, recessed throat.
      for (let band = 0; band < 48; band++) {
        const offset = band * 2.399963;
        ctx.beginPath();
        for (let step = 0; step <= 80; step++) {
          const u = step / 80;
          const radius = 12 + Math.pow(u, 1.6) * (146 + Math.sin(band * 3.1) * 14);
          const angle = offset + time * (0.18 + c * 0.25) - Math.log(0.035 + u) * 2.4;
          const ripple = Math.sin(u * 41 + band * 7 + time * 0.3) * 1.8 * u;
          const x = Math.cos(angle) * (radius + ripple);
          const y = Math.sin(angle) * (radius + ripple) * (0.58 + u * 0.15) - (1 - u) * 8;
          if (step === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.lineWidth = band % 7 === 0 ? 1.55 : 0.5;
        ctx.strokeStyle = band % 7 === 0 ? `rgba(178,240,255,${0.17 + c * 0.12})` : `rgba(69,181,255,${0.09 + c * 0.1})`;
        ctx.stroke();
      }
      for (let index = 0; index < 760; index++) {
        const seed = noise(index * 13 + 7);
        const u = reducedMotion ? seed : (seed + time * (0.045 + c * 0.06)) % 1;
        const r = 12 + (1 - u) ** 1.6 * (153 + Math.sin(index * 3.81) * 10);
        const angle = index * 2.39996 - Math.log(1.035 - u) * 2.4 + time * 0.18;
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r * (0.58 + (1 - u) * 0.15) - u * 8;
        const alpha = Math.sin(Math.PI * u) * (0.35 + (index % 7) * 0.07 + c * 0.17);
        ctx.fillStyle = index % 11 === 0 ? `rgba(232,250,255,${alpha})` : `rgba(116,224,255,${alpha})`;
        const dot = index % 29 === 0 ? 1.6 : 0.5 + (index % 3) * 0.18;
        ctx.fillRect(x, y, dot, dot);
      }
      ctx.save();
      ctx.translate(0, -8);
      ctx.scale(1, 0.64);
      const throat = ctx.createRadialGradient(0, 0, 0, 0, 0, 54);
      throat.addColorStop(0, "rgba(247,254,255,.98)");
      throat.addColorStop(0.16, "rgba(223,251,255,.98)");
      throat.addColorStop(0.32, "rgba(133,235,255,.84)");
      throat.addColorStop(0.45, "rgba(62,180,255,.46)");
      throat.addColorStop(0.7, "rgba(54,128,233,.14)");
      throat.addColorStop(1, "rgba(56,99,190,0)");
      ctx.fillStyle = throat;
      ctx.fillRect(-54, -54, 108, 108);
      // The rim is uneven and layered, avoiding the appearance of a flat HUD ring.
      for (let rim = 0; rim < 5; rim++) {
        ctx.beginPath();
        for (let step = 0; step <= 72; step++) {
          const angle = step / 72 * Math.PI * 2;
          const radius = 21 + rim * 4 + Math.sin(angle * 4 + time * 0.8 + rim) * 1.9;
          const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
          if (!step) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(174,236,255,${0.33 - rim * 0.04})`;
        ctx.lineWidth = 1.4 - rim * 0.18;
        ctx.stroke();
      }
      ctx.restore();
      ctx.restore();
    };
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (document.hidden || now - previous < 32) return;
      const dt = Math.min((now - (previous || now)) / 1000, 0.06);
      previous = now;
      if (!reducedMotion) time += dt;
      if (!hovered.current) charge.current = Math.max(0, charge.current - dt * 0.75);
      if (reducedMotion && Math.abs(previousCharge - charge.current) < 0.005) return;
      previousCharge = charge.current;
      draw();
    };
    draw();
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reducedMotion]);

  return (
    <button
      ref={button}
      type="button"
      className="wormhole-portal"
      disabled={disabled}
      aria-label="进入虫洞，探索相关问题"
      onPointerEnter={() => { hovered.current = true; }}
      onPointerLeave={() => { hovered.current = false; }}
      onFocus={() => { hovered.current = true; }}
      onBlur={() => { hovered.current = false; }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => {
        if (entered.current || disabled) return;
        entered.current = true;
        onEnter();
      }}
    >
      <canvas ref={canvas} aria-hidden="true" />
    </button>
  );
}
