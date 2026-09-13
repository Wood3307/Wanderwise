import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { createStar, getStarStyle } from './stars';

test('stable answer identities provide varied cool, pale, violet and warm stellar palettes', () => {
  const kinds = new Set<string>();
  const discVariants = new Set<boolean>();
  for (let index = 0; index < 32; index++) {
    const seed = `article-${index}`;
    const style = getStarStyle(seed);
    assert.deepEqual(style, getStarStyle(seed));
    kinds.add(style.kind);
    discVariants.add(style.hasDisk);
    const core = new THREE.Color(style.core);
    const plasma = new THREE.Color(style.plasma);
    assert.ok(core.r + core.g + core.b > plasma.r + plasma.g + plasma.b);
  }
  assert.deepEqual([...kinds].sort(), ['amber', 'azure', 'ivory', 'violet']);
  assert.equal(discVariants.size, 2);
});

test('stars are physical spheres with magnetic loops and bounded coronas on desktop and mobile', () => {
  for (const mobile of [false, true]) {
    const star = createStar({ seed: 'cold-plasma', radius: 0.62, mobile });
    try {
      assert.equal(star.kind, getStarStyle('cold-plasma').kind);
      assert.equal(star.group.userData.starKind, star.kind);
      const body = star.group.getObjectByName('stellar-photosphere') as THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
      assert.ok(body.geometry instanceof THREE.SphereGeometry);
      assert.equal(body.geometry.parameters.radius, 0.62);
      assert.equal(body.geometry.parameters.widthSegments, mobile ? 24 : 40);
      assert.equal(body.material.uniforms.uCore.value.getHexString(), new THREE.Color(getStarStyle('cold-plasma').core).getHexString());
      const loops = star.group.getObjectByName('stellar-prominences')!;
      assert.equal(loops.children.length, mobile ? 3 : 5);
      assert.ok(loops.children.every(child => child instanceof THREE.Mesh && child.geometry instanceof THREE.TubeGeometry));
      const corona = star.group.getObjectByName('stellar-corona') as THREE.Sprite;
      assert.ok(corona.scale.x < 0.62 * 5);
      assert.ok(corona.material.opacity < 0.5);
      assert.equal(Boolean(star.group.getObjectByName('stellar-debris-disc')), getStarStyle('cold-plasma').hasDisk);
    } finally { star.dispose(); }
  }
});

test('stellar activity freezes for reading and reduced motion, and resumes without jumps', () => {
  const star = createStar({ seed: 'freeze', radius: 1, mobile: true });
  try {
    const body = star.group.getObjectByName('stellar-photosphere') as THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
    star.update(0, false);
    star.update(0.08, false);
    const time = body.material.uniforms.uTime.value;
    const rotation = body.rotation.y;
    assert.equal(time, 0.08);
    star.update(200, false, true);
    star.update(230, true);
    assert.equal(body.material.uniforms.uTime.value, time);
    assert.equal(body.rotation.y, rotation);
    star.update(230.02, false);
    assert.ok(body.material.uniforms.uTime.value > time);
    assert.ok(body.material.uniforms.uTime.value - time < 0.021);
    assert.ok(body.rotation.y - rotation < 0.001);
  } finally { star.dispose(); }
});

test('star fades reach every material and disposal releases each owned resource once', () => {
  const star = createStar({ seed: 'resources', radius: 1.22, mobile: true });
  const scene = new THREE.Scene();
  scene.add(star.group);
  const resources = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>();
  star.setOpacity(0.4);
  star.group.traverse(object => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Sprite)) return;
    if (!(object instanceof THREE.Sprite)) resources.add(object.geometry);
    const material = object.material as THREE.Material;
    resources.add(material);
    if (material instanceof THREE.ShaderMaterial) assert.equal(material.uniforms.uOpacity.value, 0.4);
    else assert.ok(material.opacity > 0 && material.opacity <= 0.4);
    if (material instanceof THREE.SpriteMaterial && material.map) resources.add(material.map);
  });
  star.setOpacity(NaN);
  assert.equal(star.group.visible, false);
  star.setOpacity(2);
  assert.equal(star.group.visible, true);
  let releases = 0;
  resources.forEach(resource => resource.addEventListener('dispose', () => { releases++; }));
  star.dispose();
  star.dispose();
  star.update(99, false);
  star.setOpacity(1);
  assert.equal(releases, resources.size);
  assert.equal(star.group.parent, null);
  assert.equal(star.group.children.length, 0);
});
