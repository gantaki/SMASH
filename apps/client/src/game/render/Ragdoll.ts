// Death ragdoll: the body of a fallen champion becomes a floppy chain (feet – hips – neck – head) that is launched
// by the killing blow, folds, tumbles, bounces off the floor and slams into walls, while weapon and shield fly off.
// Position-based dynamics on a handful of points; purely cosmetic (Math.random is fine), never touches the sim.

import * as THREE from "three";

export const RAGDOLL = {
  gravity: 24,
  /** Launch speed = base + damage of the killing blow × perDamage, capped. A meteor sends you flying. */
  launch: { base: 4.5, perDamage: 0.17, max: 14 },
  lift: { base: 3.6, perDamage: 0.07, max: 7.5 },
  /** Deaths without a direction (burn, zone, rift): the body just crumples. */
  collapse: { speed: 1.2, lift: 2.2 },
  /** Joint heights in model units (feet, hips, neck, top of head) and how much of the launch each one gets. */
  joints: [0.08, 0.92, 1.6, 2.15],
  jointKick: [0.75, 1, 1.25, 1.45],
  pointRadius: 0.24,
  groundFriction: 7,
  bounce: 0.3,
  wallBounce: 0.45,
  airDrag: 0.35,
  /** Normal speed above which hitting something counts as a slam (dust, sound). */
  slamSpeed: 3.2,
  step: 1 / 120,
} as const;

export interface RagdollWorld {
  /** Push-out for a sphere at (x, y, z), or null if it touches nothing solid. */
  collide(x: number, y: number, z: number, radius: number): { nx: number; nz: number; depth: number } | null;
  /** The body (or a prop) hit something hard. */
  impact(x: number, y: number, z: number, speed: number, kind: "ground" | "wall"): void;
}

export interface Impulse {
  /** Horizontal launch velocity. */
  x: number;
  z: number;
  /** Upward launch velocity. */
  up: number;
}

interface Point {
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  vel: THREE.Vector3;
  grounded: boolean;
}

interface Segment {
  pivot: THREE.Group;
  a: number;
  b: number;
  length: number;
  twist: number;
  twistVel: number;
}

interface Loose {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  radius: number;
}

interface Saved {
  obj: THREE.Object3D;
  parent: THREE.Object3D;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  visible: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);
const rand = (a: number, b: number): number => a + Math.random() * (b - a);

export function launchFor(damage: number, dirX: number, dirZ: number): Impulse {
  const { launch, lift } = RAGDOLL;
  const speed = Math.min(launch.max, launch.base + damage * launch.perDamage);
  return { x: dirX * speed, z: dirZ * speed, up: Math.min(lift.max, lift.base + damage * lift.perDamage) };
}

export function collapse(): Impulse {
  const a = Math.random() * Math.PI * 2;
  return { x: Math.cos(a) * RAGDOLL.collapse.speed, z: Math.sin(a) * RAGDOLL.collapse.speed, up: RAGDOLL.collapse.lift };
}

export class Ragdoll {
  private readonly points: Point[] = [];
  private readonly segments: Segment[] = [];
  private readonly loose: Loose[] = [];
  private readonly saved: Saved[] = [];
  private acc = 0;
  private quiet = 0;
  private slamCooldown = 0;
  private asleep = false;
  private readonly dir = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly tw = new THREE.Quaternion();

  /**
   * @param body the model's body group: its direct children are distributed over the chain by their height
   * @param props children that break off and fly on their own (weapon arm, shield)
   * @param hide children that should simply disappear (facing arrow)
   */
  constructor(
    private readonly scene: THREE.Object3D,
    body: THREE.Object3D,
    props: readonly THREE.Object3D[],
    hide: readonly THREE.Object3D[],
    impulse: Impulse,
    private readonly world: RagdollWorld,
  ) {
    body.updateWorldMatrix(true, true);
    const origin = body.getWorldPosition(new THREE.Vector3());
    const scale = body.getWorldScale(new THREE.Vector3()).y;
    const dt = RAGDOLL.step;

    RAGDOLL.joints.forEach((h, i) => {
      const pos = new THREE.Vector3(origin.x + rand(-0.03, 0.03), Math.max(RAGDOLL.pointRadius, origin.y + h * scale), origin.z + rand(-0.03, 0.03));
      const k = RAGDOLL.jointKick[i]! * rand(0.9, 1.1);
      const vel = new THREE.Vector3(impulse.x * k + rand(-0.6, 0.6), impulse.up * rand(0.85, 1.15), impulse.z * k + rand(-0.6, 0.6));
      this.points.push({ pos, prev: pos.clone().addScaledVector(vel, -dt), vel, grounded: false });
    });
    for (let i = 0; i + 1 < this.points.length; i++) {
      const pivot = new THREE.Group();
      pivot.position.copy(this.points[i]!.pos);
      scene.add(pivot);
      this.segments.push({ pivot, a: i, b: i + 1, length: this.points[i]!.pos.distanceTo(this.points[i + 1]!.pos), twist: 0, twistVel: rand(-3, 3) });
    }

    const speed = Math.hypot(impulse.x, impulse.z);
    for (const obj of [...body.children]) {
      this.saved.push({ obj, parent: body, position: obj.position.clone(), quaternion: obj.quaternion.clone(), scale: obj.scale.clone(), visible: obj.visible });
      if (hide.includes(obj)) {
        obj.visible = false;
      } else if (props.includes(obj)) {
        scene.attach(obj);
        const k = rand(0.5, 1.3);
        this.loose.push({
          obj,
          vel: new THREE.Vector3(impulse.x * k + rand(-2.5, 2.5), impulse.up * rand(0.9, 1.6) + speed * 0.15, impulse.z * k + rand(-2.5, 2.5)),
          spin: new THREE.Vector3(rand(-9, 9), rand(-6, 6), rand(-9, 9)),
          radius: 0.22,
        });
      } else {
        // The part rides the chain segment that covers its height.
        const y = obj.position.y;
        const j = RAGDOLL.joints;
        const seg = y < (j[1] + 0.0) * 0.93 ? 0 : y < j[2] ? 1 : 2;
        this.segments[seg]!.pivot.attach(obj);
      }
    }
  }

  /** Where the body is now (its hips), for the camera. */
  get center(): { x: number; z: number } {
    const p = this.points[1]!.pos;
    return { x: p.x, z: p.z };
  }

  update(dt: number): void {
    if (this.asleep) return;
    this.acc = Math.min(this.acc + dt, 0.1);
    while (this.acc >= RAGDOLL.step) {
      this.acc -= RAGDOLL.step;
      this.step(RAGDOLL.step);
    }
    for (const s of this.segments) {
      const a = this.points[s.a]!.pos;
      this.dir.subVectors(this.points[s.b]!.pos, a).normalize();
      this.q.setFromUnitVectors(UP, this.dir);
      this.tw.setFromAxisAngle(UP, s.twist);
      s.pivot.position.copy(a);
      s.pivot.quaternion.copy(this.q).multiply(this.tw);
    }
  }

  private slam(p: THREE.Vector3, speed: number, kind: "ground" | "wall"): void {
    if (speed < RAGDOLL.slamSpeed || this.slamCooldown > 0) return;
    this.slamCooldown = 0.18;
    this.world.impact(p.x, p.y, p.z, speed, kind);
  }

  private step(h: number): void {
    const R = RAGDOLL.pointRadius;
    this.slamCooldown -= h;
    for (const p of this.points) {
      p.vel.y -= RAGDOLL.gravity * h;
      p.vel.multiplyScalar(1 - RAGDOLL.airDrag * h);
      p.prev.copy(p.pos);
      p.pos.addScaledVector(p.vel, h);
      p.grounded = false;
    }
    for (let it = 0; it < 4; it++) {
      for (const s of this.segments) {
        const a = this.points[s.a]!.pos;
        const b = this.points[s.b]!.pos;
        this.dir.subVectors(b, a);
        const d = this.dir.length() || 1e-6;
        const k = ((d - s.length) / d) * 0.5;
        a.addScaledVector(this.dir, k);
        b.addScaledVector(this.dir, -k);
      }
      for (const p of this.points) {
        if (p.pos.y < R) {
          p.pos.y = R;
          p.grounded = true;
        }
        const hit = this.world.collide(p.pos.x, p.pos.y, p.pos.z, R);
        if (hit) {
          p.pos.x += hit.nx * hit.depth;
          p.pos.z += hit.nz * hit.depth;
          // Reflect the incoming speed along the wall normal once per step.
          if (it === 0) {
            const vn = p.vel.x * hit.nx + p.vel.z * hit.nz;
            if (vn < 0) {
              this.slam(p.pos, -vn, "wall");
              p.prev.x += hit.nx * vn * RAGDOLL.wallBounce * h;
              p.prev.z += hit.nz * vn * RAGDOLL.wallBounce * h;
            }
          }
        }
      }
    }
    let energy = 0;
    for (const p of this.points) {
      const vy = p.vel.y;
      p.vel.subVectors(p.pos, p.prev).divideScalar(h);
      if (p.grounded) {
        if (vy < -1) {
          this.slam(p.pos, -vy, "ground");
          p.vel.y = -vy * RAGDOLL.bounce;
        } else if (p.vel.y < 0) p.vel.y = 0;
        const f = Math.max(0, 1 - RAGDOLL.groundFriction * h);
        p.vel.x *= f;
        p.vel.z *= f;
      }
      energy = Math.max(energy, p.vel.lengthSq());
    }
    for (const s of this.segments) {
      s.twist += s.twistVel * h;
      if (this.points[s.a]!.grounded || this.points[s.b]!.grounded) s.twistVel *= 1 - 6 * h;
    }
    for (const l of this.loose) {
      l.vel.y -= RAGDOLL.gravity * h;
      const o = l.obj.position;
      o.addScaledVector(l.vel, h);
      if (o.y < l.radius) {
        o.y = l.radius;
        if (l.vel.y < -1.5) this.slam(o, -l.vel.y * 0.5, "ground");
        l.vel.y = Math.abs(l.vel.y) * 0.35;
        l.vel.x *= 0.7;
        l.vel.z *= 0.7;
        l.spin.multiplyScalar(0.6);
        if (l.vel.lengthSq() < 0.6) {
          l.vel.set(0, 0, 0);
          l.spin.set(0, 0, 0);
        }
      }
      const hit = this.world.collide(o.x, o.y, o.z, l.radius);
      if (hit) {
        o.x += hit.nx * hit.depth;
        o.z += hit.nz * hit.depth;
        const vn = l.vel.x * hit.nx + l.vel.z * hit.nz;
        if (vn < 0) {
          l.vel.x -= (1 + RAGDOLL.wallBounce) * vn * hit.nx;
          l.vel.z -= (1 + RAGDOLL.wallBounce) * vn * hit.nz;
        }
      }
      l.obj.rotateX(l.spin.x * h);
      l.obj.rotateY(l.spin.y * h);
      l.obj.rotateZ(l.spin.z * h);
      energy = Math.max(energy, l.vel.lengthSq());
    }
    this.quiet = energy < 0.05 ? this.quiet + h : 0;
    if (this.quiet > 0.6) this.asleep = true;
  }

  /** Puts every part back on the model exactly as it was. */
  restore(): void {
    for (const s of this.saved) {
      s.parent.add(s.obj);
      s.obj.position.copy(s.position);
      s.obj.quaternion.copy(s.quaternion);
      s.obj.scale.copy(s.scale);
      s.obj.visible = s.visible;
    }
    for (const s of this.segments) this.scene.remove(s.pivot);
  }
}
