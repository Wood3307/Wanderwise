import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { placeLabels, projectAnchor, type LabelInput, type LabelObstacle, type ScreenAnchor } from './projection';

const anchor = (x: number, y: number): ScreenAnchor => ({ x, y, depth: 0, visible: true });
const viewport = { width: 1280, height: 800, top: 100, bottom: 710, left: 24, right: 1256 };

function camera() {
  const result = new THREE.PerspectiveCamera(55, viewport.width / viewport.height, 0.1, 500);
  result.position.set(0, 0, 10);
  result.lookAt(0, 0, 0);
  result.updateMatrixWorld();
  return result;
}

function intersects(a: LabelObstacle, b: LabelObstacle) {
  return a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;
}

test('a persistent world anchor moves naturally under camera yaw and pitch', () => {
  const sceneCamera = camera();
  const position = new THREE.Vector3(2, 1, 0);
  const initial = projectAnchor(position, sceneCamera, viewport.width, viewport.height);
  sceneCamera.lookAt(0.8, 0.5, 0);
  sceneCamera.updateMatrixWorld();
  const rotated = projectAnchor(position, sceneCamera, viewport.width, viewport.height);
  assert.ok(initial.visible && rotated.visible);
  assert.ok(Math.abs(initial.x - rotated.x) > 20);
  assert.ok(Math.abs(initial.y - rotated.y) > 20);
  assert.deepEqual(position.toArray(), [2, 1, 0]);
});

test('projection clips behind, near/far and offscreen objects without pinning anchors to edges', () => {
  const sceneCamera = camera();
  const project = (position: THREE.Vector3) => projectAnchor(position, sceneCamera, viewport.width, viewport.height);
  assert.equal(project(new THREE.Vector3(0, 0, 11)).visible, false);
  assert.equal(project(new THREE.Vector3(0, 0, 9.99)).visible, false);
  assert.equal(project(new THREE.Vector3(0, 0, -600)).visible, false);
  const outside = project(new THREE.Vector3(100, 0, 0));
  assert.equal(outside.visible, false);
  assert.ok(outside.x > viewport.width);
  const onCameraPlane = project(new THREE.Vector3(2, 0, 10));
  assert.equal(onCameraPlane.visible, false);
  assert.ok(Number.isFinite(onCameraPlane.x));
  assert.equal(project(new THREE.Vector3(0, 0, 0)).visible, true);
});

test('nearby labels respect the reading bounds, each other and the reserved central title', () => {
  const core = { x: 490, y: 315, width: 300, height: 100 };
  const input: LabelInput[] = [
    { id: 'a', anchor: anchor(310, 260), width: 240, height: 96, preferredSide: 'left' },
    { id: 'b', anchor: anchor(950, 285), width: 240, height: 96 },
    { id: 'c', anchor: anchor(345, 565), width: 240, height: 96, preferredSide: 'left' },
    { id: 'd', anchor: anchor(965, 550), width: 240, height: 96 },
  ];
  const placed = placeLabels(input, viewport, undefined, [core]);
  const boxes: LabelObstacle[] = [];
  for (const item of input) {
    const label = placed.get(item.id)!;
    assert.equal(label.visible, true, item.id);
    assert.equal(label.anchorX, item.anchor.x);
    assert.equal(label.anchorY, item.anchor.y);
    const box = { x: label.x, y: label.y, width: item.width, height: item.height };
    assert.ok(box.x >= viewport.left && box.y >= viewport.top);
    assert.ok(box.x + box.width <= viewport.right && box.y + box.height <= viewport.bottom);
    assert.equal(intersects(box, core), false);
    assert.ok(boxes.every(other => !intersects(box, other)));
    assert.ok(label.distance! <= 96);
    boxes.push(box);
  }
});

test('readable labels move by the same small drag delta and retain their chosen side', () => {
  const input: LabelInput[] = [
    { id: 'left', anchor: anchor(260, 290), width: 235, height: 120, preferredSide: 'left' },
    { id: 'right', anchor: anchor(900, 500), width: 260, height: 150 },
  ];
  const before = placeLabels(input, viewport);
  const dragged = input.map(item => ({ ...item, anchor: anchor(item.anchor.x + 8, item.anchor.y - 6) }));
  const after = placeLabels(dragged, viewport, before);
  for (const item of input) {
    assert.equal(before.get(item.id)!.visible, true);
    assert.equal(after.get(item.id)!.visible, true);
    assert.equal(after.get(item.id)!.x - before.get(item.id)!.x, 8);
    assert.equal(after.get(item.id)!.y - before.get(item.id)!.y, -6);
  }
});

test('selected text can avoid a large central obstruction with a bounded local leader', () => {
  const core = { x: 450, y: 255, width: 400, height: 290 };
  const selected: LabelInput = { id: 'selected', anchor: anchor(640, 400), width: 250, height: 100, priority: 10 };
  const ordinary = placeLabels([{ ...selected, priority: 0 }], viewport, undefined, [core]).get(selected.id)!;
  const important = placeLabels([selected], viewport, undefined, [core]).get(selected.id)!;
  assert.equal(ordinary.visible, false);
  assert.equal(important.visible, true);
  assert.ok(important.distance! > 96 && important.distance! <= 220);
  assert.equal(intersects({ ...important, width: 250, height: 100 }, core), false);
  assert.equal(important.anchorX, 640);
  assert.equal(important.anchorY, 400);
});

test('crowded mobile placement gives selected text precedence and never overlaps or relocates hidden anchors', () => {
  const mobile = { width: 390, height: 760, top: 120, bottom: 660, left: 16, right: 374 };
  const input: LabelInput[] = Array.from({ length: 6 }, (_, index) => ({
    id: String(index), anchor: anchor(190 + index * 3, 360 + index * 5), width: 190, height: 155,
    priority: index === 5 ? 10 : 0,
  }));
  const result = placeLabels(input, mobile);
  assert.equal(result.get('5')!.visible, true);
  assert.ok([...result.values()].some(label => !label.visible));
  const visible: LabelObstacle[] = [];
  for (const item of input) {
    const label = result.get(item.id)!;
    assert.equal(label.anchorX, item.anchor.x);
    assert.equal(label.anchorY, item.anchor.y);
    if (!label.visible) continue;
    const rect = { ...label, width: item.width, height: item.height };
    assert.ok(rect.x >= mobile.left && rect.x + rect.width <= mobile.right);
    assert.ok(rect.y >= mobile.top && rect.y + rect.height <= mobile.bottom);
    assert.ok(visible.every(other => !intersects(rect, other)));
    visible.push(rect);
  }
});

test('offscreen anchors and text that cannot fit are hidden instead of becoming detached HUD labels', () => {
  const result = placeLabels([
    { id: 'offscreen', anchor: { ...anchor(1500, 300), visible: false }, width: 235, height: 100 },
    { id: 'oversized', anchor: anchor(640, 400), width: 1600, height: 100, priority: 100 },
  ], viewport);
  assert.equal(result.get('offscreen')!.visible, false);
  assert.equal(result.get('offscreen')!.anchorX, 1500);
  assert.equal(result.get('oversized')!.visible, false);
});
