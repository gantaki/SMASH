import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { RAGDOLL, Ragdoll, blowOf, collapse, impulseFor, launchFor, type RagdollWorld } from "./Ragdoll.ts";

/** A model like the real ones: parts at different heights, one prop, one marker to hide. */
function model() {
  const scene = new THREE.Scene();
  const body = new THREE.Group();
  scene.add(body);
  const part = (y: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3));
    m.position.y = y;
    body.add(m);
    return m;
  };
  const parts = [part(0.4), part(1.1), part(1.8)];
  const weapon = part(1.2);
  const arrow = part(0.03);
  return { scene, body, parts, weapon, arrow };
}

const WALL_X = 6;
const world = (slams: string[] = []): RagdollWorld => ({
  collide: (x, _y, _z, r) => (x > WALL_X - r ? { nx: -1, nz: 0, depth: x - (WALL_X - r) } : null),
  impact: (_x, _y, _z, _speed, kind) => slams.push(kind),
});

const settle = (r: Ragdoll, seconds = 6) => {
  for (let i = 0; i < seconds * 60; i++) r.update(1 / 60);
};

describe("ragdoll", () => {
  it("is thrown by the blow, lands on the floor and comes to rest", () => {
    const m = model();
    const r = new Ragdoll(m.scene, m.body, [m.weapon], [m.arrow], launchFor(14, 1, 0), world());
    r.update(0.3);
    settle(r);
    expect(r.center.x).toBeGreaterThan(1.5);
    for (const p of m.parts) {
      const y = p.getWorldPosition(new THREE.Vector3()).y;
      expect(y).toBeGreaterThan(-0.3);
      expect(y).toBeLessThan(1);
    }
    const before = r.center.x;
    settle(r, 1);
    expect(r.center.x).toBe(before);
  });

  it("slams into a wall instead of flying through it", () => {
    const m = model();
    const slams: string[] = [];
    const r = new Ragdoll(m.scene, m.body, [m.weapon], [m.arrow], launchFor(45, 1, 0), world(slams));
    settle(r);
    expect(slams).toContain("wall");
    expect(r.center.x).toBeLessThan(WALL_X);
    expect(m.weapon.position.x).toBeLessThan(WALL_X);
  });

  it("flies further for a harder blow, and only crumples without one", () => {
    expect(launchFor(45, 1, 0).x).toBeGreaterThan(launchFor(11, 1, 0).x);
    expect(launchFor(1000, 1, 0).x).toBe(RAGDOLL.launch.max);
    const c = collapse();
    expect(Math.hypot(c.x, c.z)).toBeCloseTo(RAGDOLL.collapse.speed);
  });

  it("is thrown only by a blow that just landed: a burn finishing the job later makes the body crumple", () => {
    const blow = { dx: 1, dz: 0, amount: 20, at: 10 };
    const thrown = launchFor(20, 1, 0);
    // The hit itself kills, or a wall slam right after its knockback does.
    expect(impulseFor(blow, 10)).toEqual(thrown);
    expect(impulseFor(blow, 10 + RAGDOLL.blowWindow)).toEqual(thrown);
    // The Fireball landed three seconds ago; its burn (or the zone, or a rift) deals the last damage.
    const late = impulseFor(blow, 13);
    expect(Math.hypot(late.x, late.z)).toBeCloseTo(RAGDOLL.collapse.speed);
    expect(late.up).toBe(RAGDOLL.collapse.lift);
    // Never hit directly at all, or a hit without a direction (the attacker stood on the same spot).
    expect(impulseFor(undefined, 5).up).toBe(RAGDOLL.collapse.lift);
    expect(impulseFor({ dx: 0, dz: 0, amount: 50, at: 5 }, 5).up).toBe(RAGDOLL.collapse.lift);
    // A remembered hit from "the future" (the kill cam rewound time) is not used.
    expect(impulseFor(blow, 9).up).toBe(RAGDOLL.collapse.lift);
  });

  it("flies away from where the hit came from, and has no direction without one", () => {
    // A companion bites from the right of the victim; its owner (who gets the credit) stands far to the left.
    const bite = { x: 0, z: 0, amount: 5, absorbed: 0, fromX: 1, fromZ: 0 };
    expect(blowOf(bite, 2)).toEqual({ dx: -1, dz: 0, amount: 5, at: 2 });
    // Shield damage counts toward the strength of the blow.
    expect(blowOf({ ...bite, amount: 3, absorbed: 9 }, 2)!.amount).toBe(12);
    // Burn, zone and rift damage come from nowhere.
    expect(blowOf({ x: 0, z: 0, amount: 4, absorbed: 0 }, 2)).toBeNull();
    // Attacker on the very same spot: a blow, but with no direction, so the body crumples.
    const onTop = blowOf({ ...bite, fromX: 0 }, 2)!;
    expect(impulseFor(onTop, 2).up).toBe(RAGDOLL.collapse.lift);
  });

  it("puts the model back together exactly", () => {
    const m = model();
    const snapshot = () => m.body.children.map((c) => [c.position.toArray(), c.quaternion.toArray(), c.visible]);
    const before = snapshot();
    const r = new Ragdoll(m.scene, m.body, [m.weapon], [m.arrow], launchFor(20, 0, 1), world());
    expect(m.body.children).toHaveLength(1); // only the hidden marker stays
    expect(m.arrow.visible).toBe(false);
    settle(r, 1);
    r.restore();
    expect(m.body.children).toHaveLength(5);
    expect(new Set(m.body.children)).toEqual(new Set([...m.parts, m.weapon, m.arrow]));
    expect(snapshot().sort()).toEqual(before.sort());
    expect(m.scene.children).toEqual([m.body]);
  });
});
