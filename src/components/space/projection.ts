import * as THREE from 'three';

/** Unmodified screen projection of a world-space object, in CSS pixels. */
export interface ScreenAnchor {
  x: number;
  y: number;
  /** Normalized device depth: -1 is the near plane, +1 is the far plane. */
  depth: number;
  visible: boolean;
}

export interface LabelInput {
  id: string;
  anchor: ScreenAnchor;
  width: number;
  height: number;
  /** Higher priorities place first; >= 10 may use a longer, bounded leader. */
  priority?: number;
  preferredSide?: 'left' | 'right';
}

export interface LabelViewport {
  width: number;
  height: number;
  /** Absolute safe screen edges, not padding/insets. */
  top: number;
  bottom: number;
  left?: number;
  right?: number;
}

/** A reserved screen-space rectangle, such as the central question/title. */
export interface LabelObstacle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LabelPlacement {
  x: number;
  y: number;
  visible: boolean;
  anchorX: number;
  anchorY: number;
  opacity: number;
  /** Distance from the true projected anchor to the nearest label edge. */
  distance?: number;
}

const GAP = 10;
const ANCHOR_RADIUS = 7;
const NORMAL_LEADER = 96;
const PRIORITY_LEADER = 220;

/** Camera matrices must already be current, just as with Vector3.project(). */
export function projectAnchor(
  position: THREE.Vector3,
  camera: THREE.Camera,
  width: number,
  height: number,
): ScreenAnchor {
  const view = new THREE.Vector4(position.x, position.y, position.z, 1).applyMatrix4(camera.matrixWorldInverse);
  const clip = view.clone().applyMatrix4(camera.projectionMatrix);
  // The camera plane is singular. Keep unusable projections finite without
  // moving offscreen objects to the screen boundary or making them visible.
  const denominator = Math.abs(clip.w) < 1e-8 ? (clip.w < 0 ? -1e-8 : 1e-8) : clip.w;
  const nx = clip.x / denominator;
  const ny = clip.y / denominator;
  const depth = clip.z / denominator;
  return {
    x: (nx + 1) * width / 2,
    y: (1 - ny) * height / 2,
    depth,
    visible: width > 0 && height > 0 && view.z < 0 && clip.w > 0
      && Number.isFinite(nx) && Number.isFinite(ny) && Number.isFinite(depth)
      && nx >= -1 && nx <= 1 && ny >= -1 && ny <= 1 && depth >= -1 && depth <= 1,
  };
}

function overlaps(a: LabelObstacle, b: LabelObstacle, gap = GAP): boolean {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x
    && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}

function leaderDistance(anchor: ScreenAnchor, rectangle: LabelObstacle): number {
  const dx = Math.max(rectangle.x - anchor.x, 0, anchor.x - rectangle.x - rectangle.width);
  const dy = Math.max(rectangle.y - anchor.y, 0, anchor.y - rectangle.y - rectangle.height);
  return Math.hypot(dx, dy);
}

/**
 * Place horizontal, readable DOM text next to real projected celestial bodies.
 * x/y are label top-left coordinates; anchorX/Y always remain the true world
 * projection. The caller may ease DOM positions and draw a leader between the
 * rectangle and anchor. Hidden text must not hide or relocate the world object.
 *
 * Previous positions translate with their anchors, retaining the chosen side
 * while it remains safe. This avoids left/right flicker during camera dragging.
 */
export function placeLabels(
  input: LabelInput[],
  viewport: LabelViewport,
  previous: Map<string, LabelPlacement> = new Map(),
  obstacles: LabelObstacle[] = [],
): Map<string, LabelPlacement> {
  const result = new Map<string, LabelPlacement>();
  const left = Math.max(0, viewport.left ?? 16);
  const right = Math.min(viewport.width, viewport.right ?? viewport.width - 16);
  const top = Math.max(0, viewport.top);
  const bottom = Math.min(viewport.height, viewport.bottom);
  const occupied = obstacles.filter(rect => rect.width > 0 && rect.height > 0).slice();
  // Labels must also leave the actual stars/planets visible. No invisible
  // screen-edge substitute is created for an offscreen body.
  const markers = input.filter(item => item.anchor.visible).map(item => ({
    x: item.anchor.x - ANCHOR_RADIUS,
    y: item.anchor.y - ANCHOR_RADIUS,
    width: ANCHOR_RADIUS * 2,
    height: ANCHOR_RADIUS * 2,
  }));
  const ordered = input.map((item, order) => ({ item, order }))
    .sort((a, b) => (b.item.priority ?? 0) - (a.item.priority ?? 0) || a.order - b.order);

  for (const { item } of ordered) {
    const { anchor, width, height } = item;
    const hidden: LabelPlacement = {
      x: anchor.x, y: anchor.y, anchorX: anchor.x, anchorY: anchor.y, visible: false, opacity: 0,
    };
    if (!anchor.visible || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)
      || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0
      || width > right - left || height > bottom - top) {
      result.set(item.id, hidden);
      continue;
    }

    const maxLeader = (item.priority ?? 0) >= 10 ? PRIORITY_LEADER : NORMAL_LEADER;
    const acceptable = (rect: LabelObstacle, limit = maxLeader) => rect.x >= left && rect.y >= top
      && rect.x + width <= right && rect.y + height <= bottom
      && leaderDistance(anchor, rect) <= limit
      && !occupied.some(other => overlaps(rect, other))
      && !markers.some(marker => overlaps(rect, marker, 4));
    const old = previous.get(item.id);
    let chosen: LabelObstacle | undefined;
    if (old?.visible) {
      const translated = {
        x: old.x + anchor.x - old.anchorX,
        y: old.y + anchor.y - old.anchorY,
        width, height,
      };
      if (acceptable(translated)) chosen = translated;
    }

    if (!chosen) {
      const first = item.preferredSide === 'left' ? anchor.x - width - 18 : anchor.x + 18;
      const second = item.preferredSide === 'left' ? anchor.x + 18 : anchor.x - width - 18;
      const offsets = [
        [first, anchor.y - height / 2], [first, anchor.y + 18], [first, anchor.y - height - 18],
        [second, anchor.y - height / 2], [second, anchor.y + 18], [second, anchor.y - height - 18],
        [anchor.x - width / 2, anchor.y + 18], [anchor.x - width / 2, anchor.y - height - 18],
      ];
      // Clamp the TEXT rectangle into its reading area. The anchor is never
      // clamped, and the bounded leader prevents HUD-like corner placement.
      const bounded = (x: number, y: number): LabelObstacle => ({
        x: Math.min(right - width, Math.max(left, x)),
        y: Math.min(bottom - height, Math.max(top, y)), width, height,
      });
      const candidates = offsets.map(([x, y], order) => ({
        rect: bounded(x, y), order,
      }));
      candidates.sort((a, b) => leaderDistance(anchor, a.rect) + a.order * 2
        - leaderDistance(anchor, b.rect) - b.order * 2);
      chosen = candidates.find(candidate => acceptable(candidate.rect, NORMAL_LEADER))?.rect;

      if (!chosen && (item.priority ?? 0) >= 10) {
        // Only a selected/important label may travel farther to get around a
        // central title or another text block. Search locally, never globally.
        const fallback: { rect: LabelObstacle; score: number }[] = [];
        for (let shift = 36; shift <= PRIORITY_LEADER; shift += 36) {
          for (const [x, y] of offsets) {
            for (const [dx, dy] of [[0, shift], [0, -shift], [shift, 0], [-shift, 0]]) {
              const rect = bounded(x + dx, y + dy);
              fallback.push({ rect, score: leaderDistance(anchor, rect) + shift * 0.05 });
            }
          }
        }
        fallback.sort((a, b) => a.score - b.score);
        chosen = fallback.find(candidate => acceptable(candidate.rect))?.rect;
      }
    }

    if (chosen) {
      occupied.push(chosen);
      const distance = leaderDistance(anchor, chosen);
      result.set(item.id, {
        x: chosen.x, y: chosen.y, anchorX: anchor.x, anchorY: anchor.y,
        visible: true, opacity: 1, distance,
      });
    } else {
      result.set(item.id, hidden);
    }
  }
  return result;
}
