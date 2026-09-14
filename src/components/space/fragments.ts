import * as THREE from 'three';

/** Capture the stars already on screen, once, before their parent dissolves. */
export function sampleStellarFragments(root: THREE.Object3D, limit: number) {
  const candidates: THREE.Points[] = [];
  root.updateWorldMatrix(true, true);
  root.traverseVisible(object => {
    if (!(object instanceof THREE.Points)) return;
    const material = Array.isArray(object.material) ? object.material[0] : object.material;
    // Exclude opaque dust/extinction and prefer resolved stellar populations.
    if (material.blending === THREE.AdditiveBlending && object.geometry.getAttribute('position')) candidates.push(object);
  });
  candidates.sort((a, b) => b.geometry.getAttribute('position').count - a.geometry.getAttribute('position').count);
  const stars = candidates[0];
  if (!stars) return {};
  const source = stars.geometry.getAttribute('position');
  const colors = stars.geometry.getAttribute('color');
  const count = Math.min(source.count, Math.max(0, Math.min(480, Math.floor(limit))));
  if (!Number.isFinite(count) || count < 1) return {};
  const fragmentPositions = new Float32Array(count * 3);
  const fragmentColors = colors ? new Float32Array(count * 3) : undefined;
  const point = new THREE.Vector3();
  for (let index = 0; index < count; index++) {
    const sample = Math.min(source.count - 1, Math.floor((index + 0.5) * source.count / count));
    point.fromBufferAttribute(source, sample).applyMatrix4(stars.matrixWorld);
    point.toArray(fragmentPositions, index * 3);
    if (fragmentColors) fragmentColors.set([colors.getX(sample), colors.getY(sample), colors.getZ(sample)], index * 3);
  }
  return { fragmentPositions, fragmentColors };
}
