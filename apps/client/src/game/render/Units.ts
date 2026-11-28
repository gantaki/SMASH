// Champion and companion models: primitive placeholders until glTF characters arrive (M3).
// Views read sim state and animate; they never write to it.

import * as THREE from "three";
import { abilityById, getChampion, type Champion } from "@smash/content";
import type { ChampionUnit, CompanionUnit } from "@smash/sim";
import { ALLY, FOE, G, TAU, basic, rand, rgb, std, type RGB } from "./gfx.ts";
import type { Particles } from "./Particles.ts";
import { Ragdoll, type Impulse, type RagdollWorld } from "./Ragdoll.ts";

export interface Pose {
  x: number;
  z: number;
  face: number;
}

const FLASH_TIME = 0.12;
/** How high a floating champion hangs above the ground. */
const HOVER_HEIGHT = 0.9;
const COMPANION_FALL_TIME = 1.4;
const COMPANION_FALL_GRAVITY = 24;
const SWING_TIME = 0.22;
const SLOW_A = rgb("#80ccff");
const SLOW_B = rgb("#1a3380");

type Mats = THREE.MeshStandardMaterial[];

function builder(body: THREE.Object3D, mats: Mats) {
  const M = (color: number, o?: THREE.MeshStandardMaterialParameters) => {
    const m = std(color, o);
    mats.push(m);
    return m;
  };
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, s?: [number, number, number], parent?: THREE.Object3D) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (s) m.scale.set(...s);
    m.castShadow = true;
    (parent ?? body).add(m);
    return m;
  };
  return { M, add };
}

interface Rig {
  /** Weapon arm: swings on attacks. */
  arm: THREE.Object3D;
  /** Where cast charge-up glows. Local to `arm`. */
  focus: THREE.Vector3;
  shield?: THREE.Object3D;
  gem?: THREE.Object3D;
  swingAxis: "x" | "y";
}

function buildEmber(body: THREE.Object3D, mats: Mats): Rig {
  const { M, add } = builder(body, mats);
  // Copper, not gold: gold belongs to Fang's palette (docs/ART_STYLE.md §3).
  const copper = M(0xc8733a, { metalness: 0.55, roughness: 0.35 });
  add(new THREE.CylinderGeometry(0.3, 0.7, 1.3, 16), M(0x9b2f1f), 0, 0.65, 0);
  add(new THREE.CylinderGeometry(0.33, 0.36, 0.14, 16), copper, 0, 1.02, 0);
  add(G.sphere, M(0xa8382a), 0, 1.36, 0, [0.38, 0.32, 0.32]);
  add(new THREE.TorusGeometry(0.3, 0.08, 8, 18), copper, 0, 1.55, 0).rotation.x = Math.PI / 2;
  add(G.sphere, M(0xf0c29a), 0, 1.78, 0.04, [0.23, 0.25, 0.23]);
  add(new THREE.ConeGeometry(0.36, 0.85, 16), M(0x6d1c13), 0, 1.98, -0.04).rotation.x = -0.18;
  const arm = new THREE.Group();
  arm.position.set(0.48, 1.2, 0.12);
  body.add(arm);
  add(new THREE.CylinderGeometry(0.04, 0.05, 2.1, 6), M(0x4b2b17), 0, 0, 0, undefined, arm);
  const gem = new THREE.Mesh(G.sphere, basic(0xffc061));
  gem.scale.setScalar(0.15);
  gem.position.y = 1.1;
  arm.add(gem);
  const halo = new THREE.Mesh(G.sphere, basic(0xff7a2b, 0.35, true));
  halo.scale.setScalar(0.34);
  halo.position.y = 1.1;
  arm.add(halo);
  const hand = new THREE.Mesh(G.sphere, basic(0xff9a3c, 0.9));
  hand.scale.setScalar(0.1);
  hand.position.set(-0.42, 1.2, 0.3);
  body.add(hand);
  return { arm, gem, focus: new THREE.Vector3(0, 1.1, 0), swingAxis: "x" };
}

function buildFang(body: THREE.Object3D, mats: Mats): Rig {
  const { M, add } = builder(body, mats);
  const steel = M(0x8f9aa5, { metalness: 0.65, roughness: 0.35 });
  const gold = M(0xc9a04a, { metalness: 0.7, roughness: 0.3 });
  const leather = M(0x3a2a20);
  // Navy cloth and shield: Fang's palette is steel, navy and gold (docs/ART_STYLE.md §3).
  const navy = M(0x24407a);
  add(G.box, leather, -0.19, 0.38, 0, [0.24, 0.76, 0.28]);
  add(G.box, leather, 0.19, 0.38, 0, [0.24, 0.76, 0.28]);
  add(G.box, steel, 0, 1.08, 0, [0.86, 0.78, 0.52]);
  add(G.box, M(0x6b3d22), 0, 0.74, 0, [0.9, 0.14, 0.56]);
  add(G.box, navy, 0, 0.5, 0.22, [0.46, 0.5, 0.06]);
  add(G.sphere, gold, -0.52, 1.42, 0, [0.27, 0.2, 0.27]);
  add(G.sphere, gold, 0.52, 1.42, 0, [0.27, 0.2, 0.27]);
  add(G.sphere, M(0xd9a982), 0, 1.68, 0.02, [0.22, 0.24, 0.22]);
  add(new THREE.CylinderGeometry(0.25, 0.27, 0.32, 14), steel, 0, 1.82, 0);
  add(G.box, gold, 0, 2.02, 0, [0.07, 0.16, 0.44]);
  const shield = new THREE.Group();
  shield.position.set(-0.5, 1.05, 0.36);
  body.add(shield);
  add(G.box, navy, 0, 0, 0, [0.62, 0.86, 0.1], shield);
  add(G.sphere, gold, 0, 0, 0.07, [0.12, 0.12, 0.06], shield);
  const arm = new THREE.Group();
  arm.position.set(0.55, 1.25, 0.05);
  body.add(arm);
  add(new THREE.CylinderGeometry(0.045, 0.05, 1.25, 6), M(0x4b2b17), 0, -0.12, 0.5, undefined, arm).rotation.x = Math.PI / 2;
  add(G.box, M(0xd8dde2, { metalness: 0.8, roughness: 0.25 }), 0, -0.06, 1, [0.06, 0.46, 0.34], arm);
  return { arm, shield, focus: new THREE.Vector3(0, -0.06, 1), swingAxis: "y" };
}

function buildRook(body: THREE.Object3D, mats: Mats): Rig {
  const { M, add } = builder(body, mats);
  // Moss green, weathered stone and bronze: Rook's palette (docs/ART_STYLE.md §3). Broad and square, like a tower.
  const stone = M(0x8d9482, { roughness: 0.95 });
  const moss = M(0x5f8a45);
  const bronze = M(0x9a6b3a, { metalness: 0.6, roughness: 0.4 });
  const leather = M(0x3b3327);
  add(G.box, leather, -0.24, 0.36, 0, [0.3, 0.72, 0.34]);
  add(G.box, leather, 0.24, 0.36, 0, [0.3, 0.72, 0.34]);
  add(G.box, moss, 0, 1.06, 0, [1.02, 0.8, 0.62]);
  add(G.box, bronze, 0, 0.72, 0, [1.06, 0.14, 0.66]);
  add(G.box, stone, -0.66, 1.44, 0, [0.4, 0.34, 0.5]);
  add(G.box, stone, 0.66, 1.44, 0, [0.4, 0.34, 0.5]);
  add(G.sphere, M(0xc99a72), 0, 1.7, 0.02, [0.22, 0.23, 0.22]);
  // A crenellated crown: the rook of the chess set.
  add(new THREE.CylinderGeometry(0.3, 0.27, 0.26, 8), stone, 0, 1.92, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + TAU / 8;
    add(G.box, stone, Math.cos(a) * 0.24, 2.1, Math.sin(a) * 0.24, [0.15, 0.14, 0.15]);
  }
  const arm = new THREE.Group();
  arm.position.set(0.66, 1.2, 0.08);
  body.add(arm);
  // A mason's maul.
  add(new THREE.CylinderGeometry(0.05, 0.055, 1.3, 6), M(0x4b3a26), 0, -0.1, 0.45, undefined, arm).rotation.x = Math.PI / 2;
  add(G.box, stone, 0, -0.1, 1.05, [0.34, 0.34, 0.5], arm);
  return { arm, focus: new THREE.Vector3(0, -0.1, 1.05), swingAxis: "y" };
}

function buildTide(body: THREE.Object3D, mats: Mats): Rig {
  const { M, add } = builder(body, mats);
  // Lilac, deep indigo and silver: Tide's palette (docs/ART_STYLE.md §3). Slim, with a crescent over her head.
  const robe = M(0x3a2f7a);
  const lilac = M(0xb9a4ff);
  const silver = M(0xd7dbe8, { metalness: 0.75, roughness: 0.25 });
  add(new THREE.CylinderGeometry(0.24, 0.62, 1.25, 16), robe, 0, 0.62, 0);
  add(new THREE.CylinderGeometry(0.27, 0.3, 0.12, 16), silver, 0, 1.0, 0);
  add(G.sphere, M(0x4a3d99), 0, 1.32, 0, [0.34, 0.3, 0.28]);
  add(G.sphere, M(0xe9c7b0), 0, 1.74, 0.03, [0.21, 0.23, 0.21]);
  add(G.sphere, M(0xe8e4f7), 0, 1.8, -0.06, [0.25, 0.24, 0.25]);
  // The crescent: a ring seen edge-on from above would vanish, so it lies tilted back.
  const crescent = add(new THREE.TorusGeometry(0.3, 0.05, 8, 20, Math.PI * 1.25), silver, 0, 2.12, -0.05);
  crescent.rotation.set(-0.5, 0, Math.PI * 0.87);
  const arm = new THREE.Group();
  arm.position.set(0.44, 1.25, 0.14);
  body.add(arm);
  const gem = new THREE.Mesh(G.sphere, basic(0xe6dcff));
  gem.scale.setScalar(0.15);
  gem.position.set(0, 0.25, 0.3);
  arm.add(gem);
  const halo = new THREE.Mesh(G.sphere, basic(0x8f73ff, 0.35, true));
  halo.scale.setScalar(0.32);
  halo.position.copy(gem.position);
  arm.add(halo);
  add(G.sphere, lilac, -0.4, 1.2, 0.26, [0.09, 0.09, 0.09]);
  return { arm, gem, focus: new THREE.Vector3(0, 0.25, 0.3), swingAxis: "x" };
}

function buildDummy(body: THREE.Object3D, mats: Mats): Rig {
  const { M, add } = builder(body, mats);
  const wood = M(0x7a5232);
  const straw = M(0xd8b56a, { roughness: 1 });
  add(new THREE.CylinderGeometry(0.5, 0.6, 0.16, 14), wood, 0, 0.08, 0);
  add(new THREE.CylinderGeometry(0.09, 0.11, 1.9, 8), wood, 0, 0.95, 0);
  add(new THREE.CylinderGeometry(0.36, 0.3, 0.9, 12), straw, 0, 1.05, 0);
  add(G.sphere, straw, 0, 1.78, 0, [0.26, 0.28, 0.26]);
  add(new THREE.CylinderGeometry(0.06, 0.06, 1.5, 6), wood, 0, 1.38, 0).rotation.z = Math.PI / 2;
  const target = new THREE.Group();
  target.position.set(0, 1.08, 0.36);
  body.add(target);
  [
    [0.28, 0xf2ead8],
    [0.19, 0xc0392b],
    [0.09, 0xf2ead8],
  ].forEach(([r, col], i) => {
    const ring = new THREE.Mesh(new THREE.CircleGeometry(r, 24), M(col as number));
    ring.position.z = i * 0.004;
    target.add(ring);
  });
  const arm = new THREE.Group();
  body.add(arm);
  return { arm, focus: new THREE.Vector3(0, 1.2, 0.4), swingAxis: "x" };
}

const RIGS: Record<string, (body: THREE.Object3D, mats: Mats) => Rig> = { ember: buildEmber, fang: buildFang, rook: buildRook, tide: buildTide, dummy: buildDummy };

export class ChampionView {
  readonly root = new THREE.Group();
  readonly champion: Champion;
  private readonly body = new THREE.Group();
  private readonly mats: Mats = [];
  private readonly rig: Rig;
  private readonly bubble: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly stars = new THREE.Group();
  private readonly charge: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly empower: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly pcol: readonly [RGB, RGB];
  private flashT = 0;
  private flashOn = false;
  private swing = 0;
  private bash = 0;
  private spin = 0;
  private readonly tmp = new THREE.Vector3();
  /** Smoothed height of a floating champion. */
  private lift = 0;
  private ragdoll: Ragdoll | null = null;
  private readonly ring: THREE.Object3D;
  private readonly arrow: THREE.Object3D;
  /** Height of the body above the ground this frame (leaps); the overlay uses it for the health bar. */
  height = 0;

  constructor(u: ChampionUnit, ally: boolean, private readonly particles: Particles) {
    this.champion = getChampion(u.champion);
    this.pcol = [rgb(this.champion.particles[0]), rgb(this.champion.particles[1])];
    const team = ally ? ALLY : FOE;
    this.body.rotation.order = "YXZ";
    this.body.scale.setScalar(1.22);
    this.root.add(this.body);
    this.rig = (RIGS[u.champion] ?? buildDummy)(this.body, this.mats);

    const ring = new THREE.Mesh(G.ring, basic(team, 0.95));
    ring.position.y = 0.03;
    ring.scale.setScalar(1.08);
    this.root.add(ring);
    this.ring = ring;
    const arrow = new THREE.Mesh(G.arrow, basic(team, 0.95));
    arrow.position.y = 0.03;
    arrow.scale.setScalar(0.9);
    this.body.add(arrow);
    this.arrow = arrow;

    this.bubble = new THREE.Mesh(G.sphere, basic(this.champion.color, 0.2, true));
    this.bubble.position.y = 1.2;
    this.bubble.visible = false;
    this.root.add(this.bubble);

    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(G.oct, basic(0xffe066));
      s.position.set(Math.cos((i / 3) * TAU) * 0.45, 0, Math.sin((i / 3) * TAU) * 0.45);
      s.scale.setScalar(0.12);
      this.stars.add(s);
    }
    this.stars.position.y = 2.9;
    this.stars.visible = false;
    this.root.add(this.stars);

    this.charge = new THREE.Mesh(G.sphere, basic(this.champion.color, 0.7, true));
    this.charge.position.copy(this.rig.focus);
    this.charge.visible = false;
    this.rig.arm.add(this.charge);
    this.empower = new THREE.Mesh(G.sphere, basic(0xfff0a0, 0.45, true));
    this.empower.position.copy(this.rig.focus);
    this.empower.scale.setScalar(0.5);
    this.empower.visible = false;
    this.rig.arm.add(this.empower);
  }

  flash(): void {
    this.flashT = FLASH_TIME;
  }

  /** An ability fired: play the attack motion. */
  attack(heavy: boolean): void {
    this.swing = SWING_TIME;
    if (heavy) this.bash = 0.2;
  }

  /**
   * The champion died: hand the model over to the ragdoll, launched by the killing blow.
   * `at` is where it died. The model is moved there first: it may not have been drawn for a while
   * (several ticks in one frame, or a skipped kill cam replay), and the body must fall where the death happened.
   * `dropping`: it went into the abyss, so nothing catches the body on its way down.
   */
  startRagdoll(scene: THREE.Object3D, impulse: Impulse, world: RagdollWorld, at: Pose, dropping = false): void {
    if (this.ragdoll) return;
    this.root.position.set(at.x, Math.max(0, this.root.position.y), at.z);
    this.body.rotation.set(0, at.face, 0);
    this.body.position.y = 0;
    const props = [this.rig.arm, ...(this.rig.shield ? [this.rig.shield] : [])];
    this.ragdoll = new Ragdoll(scene, this.body, props, [this.arrow], impulse, world, dropping);
    this.ring.visible = false;
  }

  /** Where the ragdoll's body is, or null while the champion is on its feet. */
  get ragdollCenter(): { x: number; z: number } | null {
    return this.ragdoll?.center ?? null;
  }

  private endRagdoll(): void {
    this.ragdoll?.restore();
    this.ragdoll = null;
    this.ring.visible = true;
  }

  update(u: ChampionUnit, pose: Pose, time: number, dt: number): void {
    const { root, body, rig, particles } = this;
    // Alive again (next round, training respawn, kill cam rewind): put the model back together.
    if (this.ragdoll && !u.dead) this.endRagdoll();
    if (this.ragdoll) {
      this.ragdoll.update(dt);
      this.bubble.visible = this.stars.visible = this.charge.visible = this.empower.visible = false;
      if (this.flashT > 0 || this.flashOn) {
        this.flashT = Math.max(0, this.flashT - dt);
        const f = (this.flashT / FLASH_TIME) * 0.9;
        for (const m of this.mats) m.emissive.setRGB(f, f * 0.85, f * 0.7);
        this.flashOn = this.flashT > 0;
      }
      return;
    }
    this.flashT = Math.max(0, this.flashT - dt);
    this.swing = Math.max(0, this.swing - dt);
    this.bash = Math.max(0, this.bash - dt);

    // Off the ground: the arc of a leap, or floating.
    const floating = u.hover > 0 ? HOVER_HEIGHT * Math.min(1, u.hover / 0.2) + Math.sin(time * 5) * 0.08 : 0;
    this.lift += (floating - this.lift) * Math.min(1, dt * 14);
    this.height = u.leap ? Math.sin(Math.min(1, u.leap.t / u.leap.duration) * Math.PI) * 2 : this.lift;
    root.position.set(pose.x, this.height, pose.z);
    // The ring stays on the ground under a floating champion: it marks where she really is.
    this.ring.position.y = 0.03 - (u.leap ? 0 : this.lift);

    if (u.dead) {
      const k = Math.min(1, u.deadTime / 0.5);
      body.rotation.x = -k * 1.45;
      root.position.y = -k * 0.2;
    } else {
      // Leaning into a charge.
      body.rotation.x = u.dash ? 0.45 : 0;
      const spinning = !!u.channel;
      this.spin = spinning ? this.spin + dt * 16 : 0;
      body.rotation.y = pose.face + this.spin;
      const moving = Math.hypot(u.vx, u.vz) > 0.6 && !u.leap;
      body.position.y = moving ? Math.abs(Math.sin(time * 10)) * 0.06 : 0;
    }

    const guarded = (u.shield > 0 || u.counter > 0 || !!u.brace) && !u.dead;
    this.bubble.visible = guarded;
    if (guarded) {
      this.bubble.material.opacity = (u.brace ? 0.42 : u.counter > 0 ? 0.26 : 0.15) + 0.08 * Math.sin(time * 11);
      this.bubble.scale.setScalar(1.35 + 0.05 * Math.sin(time * 6));
    }
    this.stars.visible = u.stun > 0 && !u.dead;
    if (u.stun > 0) this.stars.rotation.y += dt * 6;

    if (this.flashT > 0 || this.flashOn) {
      const f = (this.flashT / FLASH_TIME) * 0.9;
      for (const m of this.mats) m.emissive.setRGB(f, f * 0.85, f * 0.7);
      this.flashOn = this.flashT > 0;
    }

    // Arm: raised while winding up, swings through on release.
    const sw = this.swing / SWING_TIME;
    if (rig.swingAxis === "x") rig.arm.rotation.x = u.cast ? 0.75 : this.swing > 0 ? 0.9 * sw : 0;
    else rig.arm.rotation.y = u.channel ? 1.57 : u.cast ? 1.5 : this.swing > 0 ? 1.3 - 2.5 * (1 - sw) : 0.35;
    if (rig.shield) rig.shield.position.z = 0.36 + (this.bash > 0 ? 0.35 : 0) + (u.counter > 0 ? 0.1 : 0);
    if (rig.gem) rig.gem.scale.setScalar(0.15 * (1 + Math.sin(time * 13) * 0.1));

    // Wind-up glow: grows with cast progress in the ability's colour, so every cast is visible on the caster.
    const cast = u.cast && !u.dead ? u.cast : null;
    this.charge.visible = !!cast;
    if (cast) {
      const a = this.champion.abilities[cast.slot];
      const k = 1 - cast.time / cast.total;
      this.charge.material.color.set(a?.color ?? this.champion.color);
      this.charge.scale.setScalar(0.12 + 0.34 * k + Math.sin(time * 40) * 0.02);
      this.charge.getWorldPosition(this.tmp);
      if (Math.random() < dt * 60) {
        // Sparks streaming into the focus point.
        const ang = Math.random() * TAU;
        const r = 0.9;
        particles.emit(this.tmp.x + Math.cos(ang) * r, this.tmp.y + rand(-0.3, 0.5), this.tmp.z + Math.sin(ang) * r, {
          spd: 3.2,
          dx: -Math.cos(ang),
          dz: -Math.sin(ang),
          cone: 0,
          col: this.pcol[0],
          col2: this.pcol[1],
          life: 0.22,
          size: 0.3,
        });
      }
    }
    this.empower.visible = u.empowered > 0 && !u.dead;
    if (this.empower.visible) this.empower.scale.setScalar(0.5 + Math.sin(time * 14) * 0.08);

    if (u.dead) return;
    if (rig.gem && Math.random() < dt * 7) {
      rig.gem.getWorldPosition(this.tmp);
      particles.emit(this.tmp.x, this.tmp.y, this.tmp.z, { spd: 0.4, vy: 1.2, col: this.pcol[0], col2: this.pcol[1], life: 0.5, size: 0.18 });
    }
    if (u.burn > 0 && Math.random() < dt * 30) {
      particles.emit(pose.x, rand(0.4, 1.6), pose.z, { spd: 0.5, vy: 1.6, col: rgb("#ff9933"), col2: rgb("#991400"), life: 0.45, size: 0.38, jit: 0.6 });
    }
    if (u.slow > 0 && Math.random() < dt * 14) {
      particles.emit(pose.x, 0.15, pose.z, { spd: 0.6, col: SLOW_A, col2: SLOW_B, life: 0.5, size: 0.3, jit: 1 });
    }
    if (u.channel) {
      const a = abilityById(this.champion.abilities[u.channel.slot]?.id ?? "");
      const r = a?.kind === "channel" ? a.radius * 0.82 : 2.6;
      for (let i = 0; i < 3; i++) {
        const ang = Math.random() * TAU;
        particles.emit(pose.x + Math.cos(ang) * r, 1, pose.z + Math.sin(ang) * r, { spd: 1.5, col: this.pcol[0], col2: this.pcol[1], life: 0.3, size: 0.34 });
      }
    }
  }
}

export class CompanionView {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly mats: Mats = [];
  private readonly halo?: THREE.Mesh;
  private readonly head?: THREE.Object3D;
  private readonly legs: THREE.Object3D[] = [];
  private readonly flying: boolean;
  private flashT = 0;
  private flashOn = false;
  private bite = 0;
  /** Seconds since it went into the abyss, or -1: the model is shown dropping for a moment after it dies. */
  private fallT = -1;
  /** How far a rolling companion has turned over. */
  private spin = 0;
  private readonly seed: number;

  /** `kind` is the companion's id in content: it picks the model. */
  constructor(c: CompanionUnit, ally: boolean, flying: boolean, private readonly particles: Particles, private readonly kind = "") {
    this.flying = flying;
    this.seed = c.team * 1.7;
    const { body, root } = this;
    root.add(body);
    const ring = new THREE.Mesh(G.ring, basic(ally ? ALLY : FOE, 0.9));
    ring.scale.setScalar(c.radius + 0.18);
    ring.position.y = 0.03;
    root.add(ring);
    if (kind === "moon") {
      // A small pale moon with a dark side, and a halo that swells while it pulls.
      const core = new THREE.Mesh(G.sphere, basic(0xf1ecff));
      core.scale.setScalar(0.3);
      const shade = new THREE.Mesh(G.sphere, basic(0x4a3d99, 0.85));
      shade.scale.setScalar(0.27);
      shade.position.set(0.12, 0.03, 0.08);
      this.halo = new THREE.Mesh(G.sphere, basic(0x8f73ff, 0.36, true));
      this.halo.scale.setScalar(0.55);
      body.add(core, shade, this.halo);
      body.position.y = 1.8;
    } else if (kind === "boulder") {
      // A rock that walks: plates on a round back, curled up when it rolls.
      const { M, add } = builder(body, this.mats);
      const rock = M(0x8d9482, { roughness: 1 });
      const moss = M(0x5f8a45, { roughness: 1 });
      add(G.sphere, rock, 0, 0.7, 0, [0.72, 0.66, 0.78]);
      add(G.sphere, moss, 0, 0.98, -0.12, [0.5, 0.36, 0.5]);
      add(G.box, rock, 0, 0.62, 0.62, [0.34, 0.3, 0.3]);
      for (const sx of [-1, 1]) add(G.box, M(0x5c6152), sx * 0.42, 0.22, 0.2, [0.24, 0.4, 0.3]);
    } else if (flying) {
      const core = new THREE.Mesh(G.sphere, basic(0xffe6a8));
      core.scale.setScalar(0.2);
      this.halo = new THREE.Mesh(G.sphere, basic(0xff7a2b, 0.42, true));
      this.halo.scale.setScalar(0.48);
      const shell = new THREE.Mesh(G.sphere, basic(0xff8a3a, 0.18, true));
      shell.scale.setScalar(0.78);
      body.add(core, this.halo, shell);
      body.position.y = 1.8;
    } else {
      const { M, add } = builder(body, this.mats);
      const fur = M(0x9a7650);
      const dark = M(0x4a3626);
      const gold = M(0xc9a04a, { metalness: 0.7, roughness: 0.3 });
      add(G.box, fur, 0, 0.62, 0, [0.42, 0.36, 0.95]);
      const head = new THREE.Group();
      head.position.set(0, 0.86, 0.55);
      body.add(head);
      add(G.box, fur, 0, 0, 0.05, [0.3, 0.3, 0.34], head);
      add(G.box, dark, 0, -0.05, 0.28, [0.18, 0.14, 0.22], head);
      add(G.box, dark, -0.1, 0.2, -0.02, [0.07, 0.16, 0.07], head);
      add(G.box, dark, 0.1, 0.2, -0.02, [0.07, 0.16, 0.07], head);
      add(G.box, gold, 0, 0.72, 0.4, [0.36, 0.08, 0.1]);
      for (const [x, z] of [
        [-0.14, 0.36],
        [0.14, 0.36],
        [-0.14, -0.36],
        [0.14, -0.36],
      ] as const) {
        const leg = new THREE.Group();
        leg.position.set(x, 0.48, z);
        body.add(leg);
        add(G.box, dark, 0, -0.22, 0, [0.11, 0.46, 0.11], leg);
        this.legs.push(leg);
      }
      add(G.box, fur, 0, 0.78, -0.56, [0.08, 0.08, 0.36]).rotation.x = -0.6;
      body.scale.setScalar(1.4);
      this.head = head;
    }
  }

  /** Height of the health bar anchor. */
  get barHeight(): number {
    return this.flying ? 2.45 : 1.55;
  }

  get centerHeight(): number {
    return this.flying ? 1.8 : 0.8;
  }

  flash(): void {
    this.flashT = FLASH_TIME;
  }

  attack(): void {
    this.bite = 0.18;
  }

  /** It went into the abyss at (x, z): show it going down instead of vanishing. */
  fall(x: number, z: number): void {
    this.fallT = 0;
    this.root.position.set(x, 0, z);
  }

  update(c: CompanionUnit, pose: Pose, time: number, dt: number): void {
    if (c.dead && this.fallT >= 0 && this.fallT < COMPANION_FALL_TIME) {
      this.fallT += dt;
      this.root.visible = true;
      this.root.position.y = -0.5 * COMPANION_FALL_GRAVITY * this.fallT * this.fallT;
      this.body.rotation.x += dt * 5;
      return;
    }
    this.root.visible = !c.dead;
    if (c.dead) return;
    if (this.fallT >= 0) {
      this.fallT = -1;
      this.body.rotation.x = 0;
    }
    this.flashT = Math.max(0, this.flashT - dt);
    this.bite = Math.max(0, this.bite - dt);
    this.root.position.set(pose.x, 0, pose.z);
    this.body.rotation.y = pose.face;
    if (this.kind === "moon") {
      const pulling = c.mode === "well";
      this.body.position.y = 1.8 + Math.sin(time * 3 + this.seed) * 0.12;
      this.halo?.scale.setScalar((pulling ? 1.1 : 0.55) * (1 + Math.sin(time * (pulling ? 16 : 8)) * 0.1) + (this.flashT > 0 ? 0.2 : 0));
      if (Math.random() < dt * (pulling ? 60 : 14)) {
        // Motes falling into it.
        const a = Math.random() * TAU;
        const r = pulling ? 2.4 : 0.6;
        this.particles.emit(pose.x + Math.cos(a) * r, this.body.position.y + rand(-0.4, 0.4), pose.z + Math.sin(a) * r, {
          spd: pulling ? 5 : 1,
          dx: -Math.cos(a),
          dz: -Math.sin(a),
          cone: 0,
          col: rgb("#e6dcff"),
          col2: rgb("#5b3fb3"),
          life: 0.4,
          size: 0.28,
        });
      }
      return;
    }
    if (this.kind === "boulder") {
      // Curled up and turning over while it rolls, flat on the ground as cover.
      const rolling = c.mode === "roll";
      this.spin = rolling ? this.spin + Math.hypot(c.vx, c.vz) * dt * 1.3 : 0;
      this.body.rotation.x = this.spin;
      this.body.position.y = rolling ? 0.2 : 0;
      if (this.flashT > 0 || this.flashOn) {
        const f = (this.flashT / FLASH_TIME) * 0.9;
        for (const m of this.mats) m.emissive.setRGB(f, f * 0.85, f * 0.7);
        this.flashOn = this.flashT > 0;
      }
      return;
    }
    if (this.flying) {
      this.body.position.y = 1.8 + Math.sin(time * 3 + this.seed) * 0.12;
      this.halo?.scale.setScalar(0.48 * (1 + Math.sin(time * 11) * 0.08) + (this.flashT > 0 ? 0.2 : 0));
      if (Math.random() < dt * 20) {
        this.particles.emit(pose.x, this.body.position.y, pose.z, { spd: 0.3, vy: 0.6, col: rgb("#ffb24d"), col2: rgb("#b31a00"), life: 0.45, size: 0.3, jit: 0.2 });
      }
      return;
    }
    const moving = Math.hypot(c.vx, c.vz) > 0.8;
    const sw = moving ? Math.sin(time * 16) * 0.7 : 0;
    this.legs.forEach((leg, i) => {
      leg.rotation.x = i === 0 || i === 3 ? sw : -sw;
    });
    if (this.head) this.head.position.z = 0.55 + (this.bite > 0 ? 0.2 : 0);
    if (this.flashT > 0 || this.flashOn) {
      const f = (this.flashT / FLASH_TIME) * 0.9;
      for (const m of this.mats) m.emissive.setRGB(f, f * 0.85, f * 0.7);
      this.flashOn = this.flashT > 0;
    }
  }
}
