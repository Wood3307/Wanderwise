export const WORMHOLE_TRAVEL_MS = { in: 3100, out: 3100 } as const;
export const WORMHOLE_HOLD = 0.7;

/** A loading destination holds inside the tunnel, never reveals an empty world. */
export function advanceWormholeTravel(
  progress: number,
  elapsedMs: number,
  durationMs: number,
  ready: boolean,
): number {
  const next = progress + Math.max(0, elapsedMs) / Math.max(1, durationMs);
  return Math.max(progress, Math.min(ready ? 1 : WORMHOLE_HOLD, next));
}

/** The old world remains covered even if readiness is revoked during reveal. */
export function wormholeRevealOpacity(progress: number, ready: boolean): number {
  if (!ready) return 1;
  const t = Math.max(0, Math.min(1, (progress - 0.89) / 0.11));
  return 1 - t * t * (3 - 2 * t);
}

/** Normalize wheel devices so trackpads, line wheels and page wheels agree. */
export function wormholeWheelCharge(delta: number, mode: number, height: number): number {
  const pixels = delta * (mode === 1 ? 16 : mode === 2 ? height : 1);
  return Math.max(-1, Math.min(1, -pixels / 290));
}
