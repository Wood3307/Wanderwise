import { useEffect, useRef } from "react";
import "./cosmic-backdrop.css";

/** Decorative atmosphere stays behind the interactive stars and the reading plane. */
export default function CosmicBackdrop({
  depth,
  reducedMotion,
}: {
  depth: number;
  reducedMotion: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    element.style.setProperty("--cosmic-x", "0px");
    element.style.setProperty("--cosmic-y", "0px");
    if (reducedMotion || !matchMedia("(pointer: fine)").matches) return;
    let frame = 0;
    let x = 0,
      y = 0;
    const move = (event: PointerEvent) => {
      x = (event.clientX / Math.max(innerWidth, 1) - 0.5) * -10;
      y = (event.clientY / Math.max(innerHeight, 1) - 0.5) * -7;
      if (!frame)
        frame = requestAnimationFrame(() => {
          element.style.setProperty("--cosmic-x", `${x.toFixed(2)}px`);
          element.style.setProperty("--cosmic-y", `${y.toFixed(2)}px`);
          frame = 0;
        });
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      window.removeEventListener("pointermove", move);
      cancelAnimationFrame(frame);
    };
  }, [reducedMotion]);

  const amount = Math.min(2, Math.max(0, depth));
  return (
    <div
      ref={root}
      className={`cosmic-backdrop ${reducedMotion ? "cosmic-still" : ""}`}
      aria-hidden="true"
      style={
        {
          "--cosmic-opacity": 0.83 - amount * 0.13,
          "--cosmic-reading-veil": 0.13 + amount * 0.16,
        } as React.CSSProperties
      }
    >
      <div className="cosmic-parallax">
        <div className="cosmic-picture" />
      </div>
      <div className="cosmic-ambient" />
      <div className="cosmic-reading-veil" />
    </div>
  );
}
