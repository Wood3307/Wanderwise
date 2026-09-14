import assert from "node:assert/strict";
import { test } from "node:test";
import { advanceWormholeTravel, WORMHOLE_HOLD, WORMHOLE_TRAVEL_MS, wormholeRevealOpacity, wormholeWheelCharge } from "./wormhole";

test("an unready destination holds inside the tunnel then reveals only after ready", () => {
  let progress = 0;
  for (let frame = 0; frame < 600; frame++) progress = advanceWormholeTravel(progress, 16, WORMHOLE_TRAVEL_MS.out, false);
  assert.equal(progress, WORMHOLE_HOLD);
  assert.ok(advanceWormholeTravel(progress, 16, WORMHOLE_TRAVEL_MS.out, true) > WORMHOLE_HOLD);
  assert.equal(advanceWormholeTravel(progress, 4000, WORMHOLE_TRAVEL_MS.out, true), 1);
});

test("readiness changes and stale frame times never reverse a crossing", () => {
  assert.equal(advanceWormholeTravel(0.82, 16, 2600, false), 0.82);
  assert.equal(advanceWormholeTravel(0.4, -16, 2600, true), 0.4);
  assert.equal(advanceWormholeTravel(1, 16, 2600, true), 1);
});

test("wheel units produce equivalent charge and outward wheels reverse the charge", () => {
  assert.equal(wormholeWheelCharge(-48, 0, 900), wormholeWheelCharge(-3, 1, 900));
  assert.equal(wormholeWheelCharge(-550, 0, 900), 1);
  assert.equal(wormholeWheelCharge(550, 0, 900), -1);
  assert.equal(wormholeWheelCharge(-1, 2, 900), 1);
});


test("the transit is opaque from frame zero until the rendered destination can be revealed", () => {
  assert.equal(wormholeRevealOpacity(0, false), 1);
  assert.equal(wormholeRevealOpacity(0, true), 1);
  assert.equal(wormholeRevealOpacity(WORMHOLE_HOLD, false), 1);
  assert.equal(wormholeRevealOpacity(.88, true), 1);
  assert.ok(wormholeRevealOpacity(.95, true) < 1);
  assert.equal(wormholeRevealOpacity(.95, false), 1);
  assert.equal(wormholeRevealOpacity(1, false), 1);
  assert.equal(wormholeRevealOpacity(1, true), 0);
});
