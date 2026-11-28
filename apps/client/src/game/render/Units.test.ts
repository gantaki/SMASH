import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { championOfTeam, createMatch } from "@smash/sim";
import { Particles } from "./Particles.ts";
import { launchFor, type RagdollWorld } from "./Ragdoll.ts";
import { ChampionView } from "./Units.ts";

const world: RagdollWorld = { collide: () => null, impact: () => undefined };

function setup() {
  const state = createMatch({ seed: 1, mode: "duel", players: [{ champion: "fang", controller: "bot" }, { champion: "ember", controller: "bot" }] });
  const unit = championOfTeam(state, 1);
  const scene = new THREE.Scene();
  const view = new ChampionView(unit, false, new Particles());
  scene.add(view.root);
  return { unit, scene, view };
}

describe("champion view", () => {
  it("starts the ragdoll where the champion died, not where it was last drawn", () => {
    const { unit, scene, view } = setup();
    // Last drawn here…
    view.update(unit, { x: -6, z: 2, face: 0 }, 0, 1 / 60);
    // …but it died somewhere else (a skipped kill cam replay handles the death without drawing the ticks before it).
    unit.dead = true;
    view.startRagdoll(scene, launchFor(10, 0, 1), world, { x: 4, z: -3, face: 1 });
    const c = view.ragdollCenter!;
    expect(Math.hypot(c.x - 4, c.z + 3)).toBeLessThan(0.1);
    // The ragdoll owns the model from here on: a later pose does not drag the body back.
    view.update(unit, { x: -6, z: 2, face: 0 }, 0.1, 1 / 60);
    expect(view.ragdollCenter!.x).toBeGreaterThan(3);
  });

  it("puts the model back on its feet when the champion is alive again", () => {
    const { unit, scene, view } = setup();
    view.update(unit, { x: 0, z: 0, face: 0 }, 0, 1 / 60);
    unit.dead = true;
    view.startRagdoll(scene, launchFor(30, 1, 0), world, { x: 0, z: 0, face: 0 });
    for (let i = 0; i < 30; i++) view.update(unit, { x: 0, z: 0, face: 0 }, i / 60, 1 / 60);
    unit.dead = false;
    view.update(unit, { x: 2, z: 5, face: 0 }, 1, 1 / 60);
    expect(view.ragdollCenter).toBeNull();
    expect(view.root.position.x).toBe(2);
    expect(view.root.position.z).toBe(5);
  });
});
