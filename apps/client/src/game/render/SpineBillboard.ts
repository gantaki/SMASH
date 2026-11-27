// Minimal Spine 4.2 JSON player for hit effects: region attachments, translate/rotate/scale timelines with bezier
// curves, attachment sequences, rgba timelines and additive slots, drawn as camera-facing billboards.
// Enough for BoneGyre VFX exports; M3 replaces it with the official spine-threejs runtime.

import * as THREE from "three";

interface Key {
  t: number;
  v: number[];
  c: number[] | "stepped" | null;
}
interface Bone {
  parent: number;
  x: number;
  y: number;
  r: number;
  sx: number;
  sy: number;
  tr: Key[];
  ro: Key[];
  sc: Key[];
}
interface Attachment {
  corners: [number, number][];
  uv: number[];
}
interface Slot {
  bone: number;
  additive: boolean;
  setup: string | null;
  atts: Record<string, Attachment>;
  attKeys: { t: number; n: string | null }[];
  colorKeys: Key[];
}
interface Instance {
  t: number;
  x: number;
  y: number;
  z: number;
  ex: [number, number];
  ey: [number, number];
  k: number;
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const MAX_QUADS = 720;
const MAX_INSTANCES = 8;

const keys = (arr: Json[] | undefined, fields: string[], def: number[]): Key[] =>
  (arr ?? []).map((k) => ({ t: k.time ?? 0, v: fields.map((f, i) => (k[f] !== undefined ? k[f] : def[i])), c: k.curve ?? null }));

const hexRGBA = (h: string): number[] => [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

const cubic = (a: number, b: number, c: number, d: number, u: number): number => {
  const m = 1 - u;
  return m * m * m * a + 3 * m * m * u * b + 3 * m * u * u * c + u * u * u * d;
};

/** Samples a timeline at time t into `out`. Returns false before the first key. */
function sample(ks: Key[], t: number, out: number[]): boolean {
  if (!ks.length || t < ks[0]!.t) return false;
  let i = ks.length - 1;
  for (let k = 0; k < ks.length - 1; k++) {
    if (t < ks[k + 1]!.t) {
      i = k;
      break;
    }
  }
  const a = ks[i]!;
  const n = a.v.length;
  if (i === ks.length - 1 || a.c === "stepped") {
    for (let c = 0; c < n; c++) out[c] = a.v[c]!;
    return true;
  }
  const b = ks[i + 1]!;
  const f = (t - a.t) / (b.t - a.t);
  for (let c = 0; c < n; c++) {
    if (Array.isArray(a.c)) {
      const q = a.c;
      const j = c * 4;
      let lo = 0;
      let hi = 1;
      let u = f;
      for (let it = 0; it < 18; it++) {
        const x = cubic(a.t, q[j]!, q[j + 2]!, b.t, u);
        if (Math.abs(x - t) < 1e-5) break;
        if (x < t) lo = u;
        else hi = u;
        u = (lo + hi) / 2;
      }
      out[c] = cubic(a.v[c]!, q[j + 1]!, q[j + 3]!, b.v[c]!, u);
    } else out[c] = a.v[c]! + (b.v[c]! - a.v[c]!) * f;
  }
  return true;
}

/** Parses a libGDX/Spine .atlas (single page): region name → [x, y, w, h]. */
function parseAtlas(text: string): { regions: Map<string, [number, number, number, number]>; width: number; height: number } {
  const regions = new Map<string, [number, number, number, number]>();
  let width = 1;
  let height = 1;
  let name = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) {
      name = line;
      continue;
    }
    const key = line.slice(0, colon);
    const nums = line
      .slice(colon + 1)
      .split(",")
      .map((s) => Number(s.trim()));
    if (key === "size") [width, height] = nums as [number, number];
    else if (key === "bounds" && nums.length === 4) regions.set(name, nums as [number, number, number, number]);
  }
  return { regions, width, height };
}

export class SpineBillboard {
  private bones: Bone[] = [];
  private slots: Slot[] = [];
  private duration = 1;
  private readonly live: Instance[] = [];
  private normal: THREE.Mesh | null = null;
  private additive: THREE.Mesh | null = null;
  private readonly world: Float64Array[] = [];
  private readonly tmp = [0, 0];
  private readonly col = [1, 1, 1, 1];

  /**
   * @param baseUrl folder containing <name>.json, <name>.atlas and <name>.png
   * @param pxPerMeter Spine pixels per world meter
   * @param start seconds skipped at the beginning, so the effect is visible on its first frame
   */
  constructor(
    private readonly scene: THREE.Object3D,
    private readonly baseUrl: string,
    private readonly name: string,
    private readonly pxPerMeter: number,
    private readonly start = 0,
  ) {}

  get ready(): boolean {
    return !!this.normal;
  }

  async load(): Promise<void> {
    const url = (ext: string) => `${this.baseUrl}/${this.name}.${ext}`;
    const [json, atlasText, tex] = await Promise.all([
      fetch(url("json")).then((r) => {
        if (!r.ok) throw new Error(`${url("json")}: ${r.status}`);
        return r.json() as Promise<Json>;
      }),
      fetch(url("atlas")).then((r) => {
        if (!r.ok) throw new Error(`${url("atlas")}: ${r.status}`);
        return r.text();
      }),
      new THREE.TextureLoader().loadAsync(url("png")),
    ]);
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    const atlas = parseAtlas(atlasText);
    this.prepare(json, atlas);
    this.normal = this.mesh(false, 20, tex);
    this.additive = this.mesh(true, 21, tex);
  }

  private prepare(j: Json, atlas: ReturnType<typeof parseAtlas>): void {
    const anim = Object.values(j.animations)[0] as Json;
    const boneAnim: Json = anim.bones ?? {};
    const index = new Map<string, number>((j.bones as Json[]).map((b, i) => [b.name, i]));
    this.bones = (j.bones as Json[]).map((b) => {
      const tl = boneAnim[b.name];
      return {
        parent: b.parent ? (index.get(b.parent) ?? -1) : -1,
        x: b.x ?? 0,
        y: b.y ?? 0,
        r: b.rotation ?? 0,
        sx: b.scaleX ?? 1,
        sy: b.scaleY ?? 1,
        tr: keys(tl?.translate, ["x", "y"], [0, 0]),
        ro: keys(tl?.rotate, ["value"], [0]),
        sc: keys(tl?.scale, ["x", "y"], [1, 1]),
      };
    });
    const skin: Json = j.skins[0].attachments;
    const { width: W, height: H } = atlas;
    let end = 0;
    this.slots = (j.slots as Json[]).map((s) => {
      const atts: Record<string, Attachment> = {};
      for (const [an, a] of Object.entries((skin[s.name] ?? {}) as Record<string, Json>)) {
        const reg = atlas.regions.get(a.path ?? a.name ?? an);
        if (!reg) continue;
        const sx = a.scaleX ?? 1;
        const sy = a.scaleY ?? 1;
        const ro = ((a.rotation ?? 0) * Math.PI) / 180;
        const co = Math.cos(ro);
        const si = Math.sin(ro);
        const w = a.width / 2;
        const h = a.height / 2;
        const corners = (
          [
            [-w, -h],
            [w, -h],
            [w, h],
            [-w, h],
          ] as [number, number][]
        ).map(([px, py]): [number, number] => [px * sx * co - py * sy * si + (a.x ?? 0), px * sx * si + py * sy * co + (a.y ?? 0)]);
        const [rx, ry, rw, rh] = reg;
        atts[an] = { corners, uv: [rx / W, (ry + rh) / H, (rx + rw) / W, (ry + rh) / H, (rx + rw) / W, ry / H, rx / W, ry / H] };
      }
      const st: Json = anim.slots?.[s.name] ?? {};
      const attKeys = ((st.attachment ?? []) as Json[]).map((k) => ({ t: k.time ?? 0, n: (k.name ?? null) as string | null }));
      const colorKeys: Key[] = ((st.rgba ?? []) as Json[]).map((k) => ({ t: k.time ?? 0, v: hexRGBA(k.color), c: k.curve ?? null }));
      for (const k of [...attKeys, ...colorKeys]) end = Math.max(end, k.t);
      return { bone: index.get(s.bone) ?? 0, additive: s.blend === "additive", setup: s.attachment ?? null, atts, attKeys, colorKeys };
    });
    for (const b of this.bones) for (const k of [...b.tr, ...b.ro, ...b.sc]) end = Math.max(end, k.t);
    this.duration = end + 0.02;
  }

  private mesh(additive: boolean, order: number, tex: THREE.Texture): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(new Float32Array(MAX_QUADS * 12), 3);
    const uv = new THREE.BufferAttribute(new Float32Array(MAX_QUADS * 8), 2);
    const col = new THREE.BufferAttribute(new Float32Array(MAX_QUADS * 16), 4);
    for (const a of [pos, uv, col]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", pos);
    g.setAttribute("uv", uv);
    g.setAttribute("rgba", col);
    const idx = new Uint16Array(MAX_QUADS * 6);
    for (let q = 0; q < MAX_QUADS; q++) idx.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    const m = new THREE.Mesh(
      g,
      new THREE.ShaderMaterial({
        uniforms: { map: { value: tex } },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        vertexShader: `attribute vec4 rgba; varying vec4 vC; varying vec2 vU;
          void main(){ vC = rgba; vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform sampler2D map; varying vec4 vC; varying vec2 vU;
          void main(){ vec4 c = texture2D(map, vU) * vC; if (c.a < 0.003) discard; gl_FragColor = c;
            #include <colorspace_fragment>
          }`,
      }),
    );
    m.frustumCulled = false;
    m.renderOrder = order;
    m.visible = false;
    this.scene.add(m);
    return m;
  }

  /**
   * Plays the effect at a world position, mirrored and tilted so that it follows the strike direction (dx, dz)
   * as seen by the camera.
   */
  play(camera: THREE.Camera, x: number, y: number, z: number, dx: number, dz: number, scale = 1): boolean {
    if (!this.ready) return false;
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    const sx = dx * e[0]! + dz * e[2]!;
    const sy = dx * e[4]! + dz * e[6]!;
    const f = sx < 0 ? -1 : 1;
    const th = Math.max(-0.55, Math.min(0.55, Math.atan2(sy, Math.abs(sx))));
    if (this.live.length >= MAX_INSTANCES) this.live.shift();
    this.live.push({ t: this.start, x, y, z, ex: [f * Math.cos(th), Math.sin(th)], ey: [-f * Math.sin(th), Math.cos(th)], k: scale / this.pxPerMeter });
    return true;
  }

  update(camera: THREE.Camera, dt: number): void {
    if (!this.normal || !this.additive) return;
    for (let n = this.live.length - 1; n >= 0; n--) {
      this.live[n]!.t += dt;
      if (this.live[n]!.t > this.duration) this.live.splice(n, 1);
    }
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    const N = this.normal.geometry.attributes;
    const A = this.additive.geometry.attributes;
    let qn = 0;
    let qa = 0;
    const { tmp, col, world } = this;
    for (const it of this.live) {
      const t = it.t;
      this.bones.forEach((b, i) => {
        let { x, y, r, sx, sy } = b;
        if (sample(b.tr, t, tmp)) {
          x += tmp[0]!;
          y += tmp[1]!;
        }
        if (sample(b.ro, t, tmp)) r += tmp[0]!;
        if (sample(b.sc, t, tmp)) {
          sx *= tmp[0]!;
          sy *= tmp[1]!;
        }
        const rad = (r * Math.PI) / 180;
        const co = Math.cos(rad);
        const si = Math.sin(rad);
        const la = co * sx;
        const lb = -si * sy;
        const lc = si * sx;
        const ld = co * sy;
        const w = world[i] ?? (world[i] = new Float64Array(6));
        const p = b.parent >= 0 ? world[b.parent] : undefined;
        if (!p) {
          w[0] = la;
          w[1] = lb;
          w[2] = lc;
          w[3] = ld;
          w[4] = x;
          w[5] = y;
        } else {
          w[0] = p[0]! * la + p[1]! * lc;
          w[1] = p[0]! * lb + p[1]! * ld;
          w[2] = p[2]! * la + p[3]! * lc;
          w[3] = p[2]! * lb + p[3]! * ld;
          w[4] = p[0]! * x + p[1]! * y + p[4]!;
          w[5] = p[2]! * x + p[3]! * y + p[5]!;
        }
      });
      const k = it.k;
      const [ex0, ex1] = it.ex;
      const [ey0, ey1] = it.ey;
      const rx = [0, 1, 2].map((c) => (e[c]! * ex0 + e[4 + c]! * ex1) * k);
      const ry = [0, 1, 2].map((c) => (e[c]! * ey0 + e[4 + c]! * ey1) * k);
      for (const s of this.slots) {
        let an = s.setup;
        for (const a of s.attKeys) {
          if (a.t <= t) an = a.n;
          else break;
        }
        const att = an ? s.atts[an] : undefined;
        if (!att) continue;
        if (!sample(s.colorKeys, t, col)) col[0] = col[1] = col[2] = col[3] = 1;
        if (col[3]! < 0.004) continue;
        const q = s.additive ? qa : qn;
        if (q >= MAX_QUADS) continue;
        const at = s.additive ? A : N;
        const w = world[s.bone]!;
        const pa = at.position!.array as Float32Array;
        const ua = at.uv!.array as Float32Array;
        const ca = at.rgba!.array as Float32Array;
        for (let v = 0; v < 4; v++) {
          const [lx, ly] = att.corners[v]!;
          const px = w[0]! * lx + w[1]! * ly + w[4]!;
          const py = w[2]! * lx + w[3]! * ly + w[5]!;
          const o = q * 4 + v;
          pa[o * 3] = it.x + rx[0]! * px + ry[0]! * py;
          pa[o * 3 + 1] = it.y + rx[1]! * px + ry[1]! * py;
          pa[o * 3 + 2] = it.z + rx[2]! * px + ry[2]! * py;
          ua[o * 2] = att.uv[v * 2]!;
          ua[o * 2 + 1] = att.uv[v * 2 + 1]!;
          ca.set(col, o * 4);
        }
        if (s.additive) qa++;
        else qn++;
      }
    }
    for (const [m, q] of [
      [this.normal, qn],
      [this.additive, qa],
    ] as const) {
      m.visible = q > 0;
      m.geometry.setDrawRange(0, q * 6);
      const at = m.geometry.attributes;
      at.position!.needsUpdate = at.uv!.needsUpdate = at.rgba!.needsUpdate = true;
    }
  }

  clear(): void {
    this.live.length = 0;
  }
}
