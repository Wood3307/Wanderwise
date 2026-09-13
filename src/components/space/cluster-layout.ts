import * as THREE from "three";

export interface ClusterLayoutOptions {
  /** Minimum separation between galaxy nuclei, in world units. */
  spacing?: number;
}

type Point = [number, number, number];

function seededRandom(seed: string) {
  let state = 2166136261;
  for (const character of seed)
    state = Math.imul(state ^ character.charCodeAt(0), 16777619) >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(values: number[], random: () => number) {
  for (let index = values.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [values[index], values[other]] = [values[other], values[index]];
  }
  return values;
}

const diagonal = Math.SQRT1_2;
// Opposite viewing directions share an orthographic projection. Include the
// intermediate views so a good front view does not hide tightly stacked nuclei.
const obliqueViews: Point[] = [
  [diagonal, diagonal, 0],
  [diagonal, -diagonal, 0],
  [diagonal, 0, diagonal],
  [diagonal, 0, -diagonal],
  [0, diagonal, diagonal],
  [0, diagonal, -diagonal],
];

function centered(points: Point[]): Point[] {
  const center: Point = [0, 0, 0];
  for (const point of points)
    for (let axis = 0; axis < 3; axis++)
      center[axis] += point[axis] / points.length;
  return points.map((point) => [
    point[0] - center[0],
    point[1] - center[1],
    point[2] - center[2],
  ]);
}

/** A camera-independent score: coverage in each principal plane, then diagonals. */
function quality(points: Point[]) {
  let nearest = Infinity,
    principal = Infinity,
    oblique = Infinity,
    radiusSquared = 0;
  let xx = 0,
    yy = 0,
    zz = 0,
    xy = 0,
    xz = 0,
    yz = 0;
  for (let index = 0; index < points.length; index++) {
    const [x, y, z] = points[index];
    radiusSquared = Math.max(radiusSquared, x * x + y * y + z * z);
    xx += x * x;
    yy += y * y;
    zz += z * z;
    xy += x * y;
    xz += x * z;
    yz += y * z;
    for (let previous = 0; previous < index; previous++) {
      const dx = x - points[previous][0],
        dy = y - points[previous][1],
        dz = z - points[previous][2];
      const distance = dx * dx + dy * dy + dz * dz;
      nearest = Math.min(nearest, distance);
      principal = Math.min(
        principal,
        dx * dx + dy * dy,
        dx * dx + dz * dz,
        dy * dy + dz * dz,
      );
      for (const view of obliqueViews) {
        const alongView = dx * view[0] + dy * view[1] + dz * view[2];
        oblique = Math.min(
          oblique,
          Math.max(0, distance - alongView * alongView),
        );
      }
    }
  }
  const determinant =
    xx * yy * zz +
    2 * xy * xz * yz -
    xx * yz * yz -
    yy * xz * xz -
    zz * xy * xy;
  const volume = Math.max(0, determinant / Math.max(1e-9, xx * yy * zz));
  const balance = Math.min(xx, yy, zz) / Math.max(xx, yy, zz);
  // A nearly planar random candidate cannot win by spreading nicely in XY.
  // Taking square roots also gives diagonal close pairs a useful gradient.
  return (
    ((0.36 * Math.sqrt(nearest) +
      0.49 * Math.sqrt(principal) +
      0.15 * Math.sqrt(oblique)) /
      Math.sqrt(radiusSquared)) *
    (0.25 + 0.75 * Math.sqrt(volume)) *
    Math.sqrt(balance)
  );
}

function rotateTetrahedron(random: () => number): Point[] {
  const axis = new THREE.Vector3(
    random() * 2 - 1,
    random() * 2 - 1,
    random() * 2 - 1,
  ).normalize();
  const rotation = new THREE.Quaternion().setFromAxisAngle(
    axis,
    random() * Math.PI * 2,
  );
  return [
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
  ].map(
    (point) =>
      new THREE.Vector3(...point).applyQuaternion(rotation).toArray() as Point,
  );
}

function volumetricPoints(count: number, random: () => number): Point[] {
  let best: Point[] = [],
    bestScore = -Infinity;
  // Latin hypercube candidates populate the complete X/Y/Z extent, including
  // the interior. Their independent permutations avoid rows, disks and shells.
  // The bounded search only runs when the question collection changes.
  for (let candidate = 0; candidate < 384; candidate++) {
    let points: Point[];
    if (count === 4) {
      points = rotateTetrahedron(random);
    } else {
      const coordinates = Array.from({ length: 3 }, () =>
        shuffle(
          Array.from(
            { length: count },
            (_, index) => ((index + 0.25 + random() * 0.5) / count) * 2 - 1,
          ),
          random,
        ),
      );
      points = centered(
        Array.from({ length: count }, (_, index) => [
          coordinates[0][index],
          coordinates[1][index],
          coordinates[2][index],
        ]),
      );
    }
    const score = quality(points);
    if (score > bestScore) {
      best = points;
      bestScore = score;
    }
  }
  return best;
}

function trianglePoints(random: () => number): Point[] {
  const views: THREE.Vector3[] = [];
  // Include intermediate pitch as well as the axis endpoints. A triangle whose
  // normal is (1,1,1) looks broad on the axes, but one of its edges points almost
  // straight at the camera halfway through an ordinary upward drag.
  for (const yaw of [-1.55, -0.8, -0.06, 0, 0.8, 1.55]) {
    for (const pitch of yaw === 0 || yaw === -0.06
      ? [-1.25, -1, -0.87, -0.6, 0, 0.16, 0.6, 1, 1.25]
      : [0, 0.16]) {
      views.push(
        new THREE.Vector3(
          Math.sin(yaw) * Math.cos(pitch),
          Math.sin(pitch),
          Math.cos(yaw) * Math.cos(pitch),
        ),
      );
    }
  }
  views.push(
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 1),
  );
  let best: THREE.Vector3[] = [],
    bestScore = -Infinity;
  for (let candidate = 0; candidate < 4096; candidate++) {
    const axis = new THREE.Vector3(
      random() * 2 - 1,
      random() * 2 - 1,
      random() * 2 - 1,
    ).normalize();
    const rotation = new THREE.Quaternion().setFromAxisAngle(
      axis,
      random() * Math.PI * 2,
    );
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation);
    if (
      Math.min(Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)) <
        0.3 ||
      Math.abs(normal.z) < 0.55
    )
      continue;
    const points = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-0.5, Math.sqrt(3) / 2, 0),
      new THREE.Vector3(-0.5, -Math.sqrt(3) / 2, 0),
    ].map((point) => point.applyQuaternion(rotation));
    let score = Infinity;
    for (const view of views) {
      // Include perspective: the overview camera is approximately four triangle
      // radii from its center. Orthographic spacing alone can hide a near/far
      // alignment that becomes obvious in the actual rendered scene.
      const projected = points.map((point) =>
        point
          .clone()
          .addScaledVector(view, -point.dot(view))
          .divideScalar(1 - point.dot(view) / 4),
      );
      for (let index = 0; index < 3; index++) {
        for (let previous = 0; previous < index; previous++)
          score = Math.min(
            score,
            projected[index].distanceToSquared(projected[previous]),
          );
      }
      if (score <= bestScore) break;
    }
    if (score > bestScore) {
      best = points;
      bestScore = score;
    }
  }
  return best.map((point) => point.toArray() as Point);
}

/**
 * Stable world anchors for the question sky. ID sorting keeps the same galaxy
 * in place when relevance sorting changes; dragging never changes this layout.
 * Three nuclei necessarily form a plane, so its orientation balances principal
 * views and the intermediate angles along the usual horizontal/vertical drags.
 */
export function createClusterLayout(
  ids: readonly string[],
  options: ClusterLayoutOptions = {},
): THREE.Vector3[] {
  if (ids.length === 0) return [];
  if (ids.length === 1) return [new THREE.Vector3()];
  const spacing =
    Number.isFinite(options.spacing) && (options.spacing ?? 0) > 0
      ? options.spacing!
      : ids.length === 3
        ? 195
        : 168;
  const ordered = ids
    .map((id, index) => ({ id, index }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.index - b.index));
  const random = seededRandom(JSON.stringify(ordered.map((entry) => entry.id)));
  let points: Point[];
  if (ids.length === 2) {
    points = [
      [-1, -1, -1],
      [1, 1, 1],
    ];
  } else if (ids.length === 3) {
    points = trianglePoints(random);
  } else {
    points = volumetricPoints(ids.length, random);
  }
  const vectors = points.map((point) => new THREE.Vector3(...point));
  let minimum = Infinity;
  for (let index = 0; index < vectors.length; index++) {
    for (let previous = 0; previous < index; previous++)
      minimum = Math.min(minimum, vectors[index].distanceTo(vectors[previous]));
  }
  const result: THREE.Vector3[] = [];
  for (let index = 0; index < ordered.length; index++)
    result[ordered[index].index] = vectors[index].multiplyScalar(
      spacing / minimum,
    );
  return result;
}
