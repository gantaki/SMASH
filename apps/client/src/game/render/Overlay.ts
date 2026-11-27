// DOM layer over the canvas: health bars, cast bars, status tags, floating numbers, off-screen arrow.
// Updated every frame through direct DOM writes (no React state in the hot path).

import * as THREE from "three";
import { rules } from "@smash/content";
import type { ChampionUnit, CompanionUnit, MatchState } from "@smash/sim";

interface Bar {
  el: HTMLElement;
  fill: HTMLElement;
  shield?: HTMLElement;
  energy?: HTMLElement;
  cast?: HTMLElement;
  castFill?: HTMLElement;
  status?: HTMLElement;
  lastStatus: string;
}

interface Float {
  el: HTMLElement;
  x: number;
  y: number;
  z: number;
  t: number;
}

const FLOAT_LIFE = 0.9;

export interface ScreenPoint {
  x: number;
  y: number;
  visible: boolean;
}

export class Overlay {
  private readonly bars = new Map<number, Bar>();
  private readonly orbBar: Bar;
  private readonly floats: Float[] = [];
  private readonly edge: HTMLElement;
  private readonly v = new THREE.Vector3();

  constructor(
    private readonly root: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: THREE.Camera,
  ) {
    root.replaceChildren();
    this.orbBar = this.makeBar("hb orb", "Сфера", false);
    this.edge = document.createElement("div");
    this.edge.className = "edge";
    root.appendChild(this.edge);
  }

  private makeBar(cls: string, name: string | null, full: boolean): Bar {
    const el = document.createElement("div");
    el.className = cls;
    el.innerHTML =
      (name ? `<b></b>` : "") +
      `<div class="tr"><i class="f"></i>${full ? '<i class="s"></i>' : ""}</div>` +
      (full ? `<div class="en"><i></i></div><div class="cast"><i></i></div><div class="st"></div>` : "");
    if (name) el.querySelector("b")!.textContent = name;
    this.root.appendChild(el);
    const q = (s: string) => el.querySelector<HTMLElement>(s) ?? undefined;
    return { el, fill: q(".f")!, shield: q(".s"), energy: q(".en i"), cast: q(".cast"), castFill: q(".cast i"), status: q(".st"), lastStatus: "" };
  }

  addChampion(u: ChampionUnit, name: string, ally: boolean): void {
    this.bars.set(u.id, this.makeBar(`hb ${ally ? "me" : "foe"}`, name, true));
  }

  addCompanion(c: CompanionUnit, ally: boolean): void {
    this.bars.set(c.id, this.makeBar(`hb pet ${ally ? "me" : "foe"}`, null, false));
  }

  toScreen(x: number, y: number, z: number): ScreenPoint {
    const r = this.canvas.getBoundingClientRect();
    this.v.set(x, y, z).project(this.camera);
    return { x: ((this.v.x + 1) / 2) * r.width, y: ((1 - this.v.y) / 2) * r.height, visible: this.v.z < 1 && this.v.z > -1 };
  }

  floatText(x: number, y: number, z: number, text: string, color: string, big = false): void {
    const el = document.createElement("div");
    el.className = `ft${big ? " big" : ""}`;
    el.textContent = text;
    el.style.color = color;
    this.root.appendChild(el);
    this.floats.push({ el, x, y, z, t: 0 });
  }

  private place(bar: Bar, show: boolean, x: number, y: number, z: number): boolean {
    const s = this.toScreen(x, y, z);
    const visible = show && s.visible;
    bar.el.style.display = visible ? "" : "none";
    if (visible) bar.el.style.transform = `translate(${s.x}px,${s.y}px) translate(-50%,-100%)`;
    return visible;
  }

  update(
    state: MatchState,
    dt: number,
    show: boolean,
    pose: (u: { id: number; x: number; z: number }) => { x: number; z: number },
    height: (id: number) => number,
    arrowTarget: ChampionUnit | undefined,
  ): void {
    for (const u of state.units) {
      const bar = this.bars.get(u.id);
      if (!bar) continue;
      const p = pose(u);
      if (!this.place(bar, show && !u.dead, p.x, height(u.id), p.z)) continue;
      const hp = (u.hp / u.maxHp) * 100;
      bar.fill.style.width = `${hp}%`;
      if (u.kind !== "champion") continue;
      if (bar.shield) {
        bar.shield.style.left = `${hp}%`;
        bar.shield.style.width = `${Math.min(100 - hp, (u.shield / u.maxHp) * 100)}%`;
      }
      if (bar.energy) bar.energy.style.width = `${(u.energy / rules.energy.max) * 100}%`;
      if (bar.cast && bar.castFill) {
        bar.cast.style.visibility = u.cast ? "visible" : "hidden";
        if (u.cast) bar.castFill.style.width = `${(1 - u.cast.time / u.cast.total) * 100}%`;
      }
      const tags: string[] = [];
      if (u.stun > 0) tags.push("оглушён");
      if (u.root > 0) tags.push("прижат");
      if (u.forced) tags.push("отброшен");
      if (u.slow > 0) tags.push("замедлен");
      if (u.burn > 0) tags.push("горит");
      if (u.counter > 0) tags.push("контрстойка");
      if (u.empowered > 0) tags.push("усилен");
      if (u.channel) tags.push("вихрь");
      const st = tags.join(" · ");
      if (bar.status && st !== bar.lastStatus) {
        bar.status.textContent = st;
        bar.lastStatus = st;
      }
    }
    const orb = state.orb;
    if (this.place(this.orbBar, show && orb.alive, orb.x, 2.5, orb.z)) this.orbBar.fill.style.width = `${(orb.hp / orb.maxHp) * 100}%`;

    // Arrow at the screen edge pointing to an off-screen enemy.
    let arrow = false;
    if (show && arrowTarget && !arrowTarget.dead) {
      const r = this.canvas.getBoundingClientRect();
      const s = this.toScreen(arrowTarget.x, 1, arrowTarget.z);
      const W = r.width;
      const H = r.height;
      if (!s.visible || s.x < 24 || s.x > W - 24 || s.y < 24 || s.y > H - 24) {
        arrow = true;
        const dx = s.x - W / 2;
        const dy = s.y - H / 2;
        const k = Math.min((W / 2 - 30) / Math.max(1e-3, Math.abs(dx)), (H / 2 - 30) / Math.max(1e-3, Math.abs(dy)));
        this.edge.style.transform = `translate(${W / 2 + dx * k}px,${H / 2 + dy * k}px) translate(-50%,-50%) rotate(${Math.atan2(dy, dx)}rad)`;
      }
    }
    this.edge.style.display = arrow ? "" : "none";

    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i]!;
      f.t += dt;
      const s = this.toScreen(f.x, f.y + f.t * 1.6, f.z);
      f.el.style.transform = `translate(${s.x}px,${s.y}px) translate(-50%,-50%) scale(${f.t < 0.08 ? 1.3 : 1})`;
      f.el.style.opacity = String(Math.max(0, 1 - (f.t / FLOAT_LIFE) ** 2));
      if (f.t > FLOAT_LIFE) {
        f.el.remove();
        this.floats.splice(i, 1);
      }
    }
  }

  clearFloats(): void {
    for (const f of this.floats) f.el.remove();
    this.floats.length = 0;
  }

  dispose(): void {
    this.root.replaceChildren();
  }
}
