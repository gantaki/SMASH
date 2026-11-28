// In-match HUD: score, clock, vitals, ability slots, centre message. Plain DOM, updated every frame.

import { ABILITY_SLOTS, getChampion, rules, type AbilitySlot } from "@smash/content";
import type { ChampionUnit, MatchState } from "@smash/sim";
import { ABILITY_ART } from "../ui/art.ts";
import { ABILITY_ICONS, KEY_LABELS } from "../ui/icons.ts";

interface SlotView {
  el: HTMLElement;
  text: HTMLElement;
  last: string;
}

export class Hud {
  private readonly slots = new Map<AbilitySlot, SlotView>();
  private readonly q: <T extends HTMLElement = HTMLElement>(s: string) => T;
  private messageTime = 0;
  private lastClock = "";
  private lastScore = "";
  private wasFull = false;
  /** Fired once each time the energy bar fills up. */
  onEnergyFull: (() => void) | null = null;

  constructor(
    private readonly root: HTMLElement,
    me: ChampionUnit,
    enemy: ChampionUnit,
    private readonly training: boolean,
    private readonly online = false,
  ) {
    const champ = getChampion(me.champion);
    const foe = getChampion(enemy.champion);
    const slotHtml = ABILITY_SLOTS.filter((s) => champ.abilities[s])
      .map((s) => {
        const a = champ.abilities[s]!;
        const art = ABILITY_ART[a.icon];
        const icon = art ? `<img src="${art}" alt="" draggable="false">` : `<svg viewBox="0 0 24 24">${ABILITY_ICONS[a.icon] ?? ""}</svg>`;
        return `<div class="slot${a.energyCost ? " ult" : ""}" data-slot="${s}" style="--c:${a.color}" title="${a.nameRu}: ${a.descriptionRu}">
          ${icon}<i class="cdv"></i><span class="cdt"></span><kbd>${KEY_LABELS[s]}</kbd></div>`;
      })
      .join("");
    const hint = online
      ? `C — отменить замах · Esc или P — меню · M — звук · <span class="net-ping">P2P</span>`
      : "C — отменить замах · Esc или P — пауза · M — звук";
    root.innerHTML = `
      <div class="top">
        <div class="side me"><b>${champ.nameRu}</b><span class="pips" data-team="${me.team}"></span></div>
        <div class="mid"><div class="rnd"></div><div class="clock">0:00</div></div>
        <div class="side foe"><span class="pips" data-team="${enemy.team}"></span><b>${foe.nameRu}${enemy.controller === "bot" ? " · бот" : ""}</b></div>
      </div>
      <div class="msg"></div>
      <div class="dock">
        <div class="vitals">
          <div class="vbar hp"><i></i><span></span></div>
          <div class="vbar en"><i></i></div>
        </div>
        <div class="slots">${slotHtml}</div>
        <div class="hint">${hint}</div>
      </div>`;
    this.q = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
    for (const el of root.querySelectorAll<HTMLElement>(".slot")) {
      this.slots.set(el.dataset.slot as AbilitySlot, { el, text: el.querySelector<HTMLElement>(".cdt")!, last: "" });
    }
  }

  setPing(ms: number | null): void {
    if (!this.online) return;
    const el = this.root.querySelector<HTMLElement>(".net-ping");
    if (el) el.textContent = ms === null ? "P2P" : `P2P · ${ms} мс`;
  }

  message(text: string, seconds: number, big = false): void {
    const m = this.q(".msg");
    m.textContent = text;
    m.classList.toggle("small", !big);
    m.classList.add("show");
    this.messageTime = seconds;
  }

  update(state: MatchState, me: ChampionUnit, dt: number): void {
    const champ = getChampion(me.champion);
    this.q(".vbar.hp i").style.width = `${(me.hp / me.maxHp) * 100}%`;
    this.q(".vbar.hp span").textContent = `${Math.ceil(me.hp)} / ${me.maxHp}${me.shield > 0 ? `  +${Math.ceil(me.shield)} щит` : ""}`;
    const full = me.energy >= rules.energy.max;
    this.q(".vbar.en i").style.width = `${(me.energy / rules.energy.max) * 100}%`;
    this.q(".vbar.en").classList.toggle("full", full);
    if (full && !this.wasFull) this.onEnergyFull?.();
    this.wasFull = full;

    const pet = state.units.find((u) => u.id === me.companion);
    for (const [slot, view] of this.slots) {
      const a = champ.abilities[slot]!;
      let p: number;
      let text = "";
      if (a.energyCost) p = 1 - me.energy / a.energyCost;
      else if (a.kind === "companionCommand" && pet?.kind === "companion" && pet.dead) {
        p = pet.respawn / rules.companion.respawn;
        text = String(Math.ceil(pet.respawn));
      } else {
        const cd = me.cooldowns[slot];
        p = a.cooldown > 0 ? cd / (a.cooldown * state.tuning.cooldown || 1) : 0;
        if (cd > 0 && a.cooldown >= 1) text = cd < 1 ? cd.toFixed(1) : String(Math.ceil(cd));
      }
      view.el.style.setProperty("--p", Math.max(0, Math.min(1, p)).toFixed(3));
      view.el.classList.toggle("ready", !!a.energyCost && full);
      view.el.classList.toggle("casting", me.cast?.slot === slot);
      if (view.last !== text) {
        view.text.textContent = text;
        view.last = text;
      }
    }

    const t = Math.floor(state.roundTime);
    const clock = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
    if (clock !== this.lastClock) {
      this.q(".clock").textContent = clock;
      this.q(".clock").classList.toggle("danger", state.suddenDeath.active);
      this.lastClock = clock;
    }
    const score = `${state.score[0]}:${state.score[1]}:${state.round}`;
    if (score !== this.lastScore) {
      this.lastScore = score;
      this.q(".rnd").textContent = this.training ? "Тренировка" : `Раунд ${state.round}`;
      for (const el of this.root.querySelectorAll<HTMLElement>(".pips")) {
        const won = state.score[Number(el.dataset.team) as 0 | 1];
        el.innerHTML = this.training
          ? ""
          : Array.from({ length: rules.roundsToWin }, (_, i) => `<i class="pip${i < won ? " on" : ""}"></i>`).join("");
      }
    }
    if (this.messageTime > 0) {
      this.messageTime -= dt;
      if (this.messageTime <= 0) this.q(".msg").classList.remove("show");
    }
  }

  dispose(): void {
    this.root.replaceChildren();
  }
}
