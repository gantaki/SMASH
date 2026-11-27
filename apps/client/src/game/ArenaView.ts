// Three.js view of the arena. Reads content/sim data, never owns gameplay state.
// M0: static arena + champion placeholders. M1 drives it from the sim.

import * as THREE from "three";
import { arena, championList } from "@smash/content";

export class ArenaView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  private readonly resizeObserver: ResizeObserver;
  private frame = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.scene.background = new THREE.Color(0x160e0a);
    this.scene.fog = new THREE.Fog(0x160e0a, 45, 85);
    this.buildLights();
    this.buildArena();
    this.buildChampionPlaceholders();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.loop();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      }
    });
    this.renderer.dispose();
  }

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xffe2bb, 0x2b1a10, 1.2));
    const sun = new THREE.DirectionalLight(0xffd29a, 2.4);
    sun.position.set(-14, 30, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -27, right: 27, top: 27, bottom: -27 });
    this.scene.add(sun);
  }

  private buildArena(): void {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(arena.radius, 96),
      new THREE.MeshStandardMaterial({ color: 0xb5834f, roughness: 0.95 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(arena.radius + 0.4, 0.5, 8, 96),
      new THREE.MeshStandardMaterial({ color: 0x9a6a42, roughness: 0.9 }),
    );
    rim.rotation.x = -Math.PI / 2;
    rim.castShadow = true;
    this.scene.add(rim);

    const stone = new THREE.MeshStandardMaterial({ color: 0xb27c4b, roughness: 0.85 });
    for (const p of arena.pillars) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(p.radius, p.radius + 0.1, 2.6, 20), stone);
      pillar.position.set(p.x, 1.3, p.z);
      pillar.castShadow = pillar.receiveShadow = true;
      this.scene.add(pillar);
    }
  }

  private buildChampionPlaceholders(): void {
    championList.slice(0, arena.spawns.length).forEach((champ, i) => {
      const spawn = arena.spawns[i]!;
      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(champ.radius * 0.8, 1.2, 6, 16),
        new THREE.MeshStandardMaterial({ color: champ.color, roughness: 0.6 }),
      );
      body.position.set(spawn.x, 1.2, spawn.z);
      body.castShadow = true;
      this.scene.add(body);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(champ.radius * 1.1, champ.radius * 1.35, 48),
        new THREE.MeshBasicMaterial({ color: i === 0 ? 0x39d0ff : 0xff4d3d }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(spawn.x, 0.03, spawn.z);
      this.scene.add(ring);
    });
  }

  private resize(): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = (): void => {
    this.frame = requestAnimationFrame(this.loop);
    const t = performance.now() / 1000;
    this.camera.position.set(Math.sin(t * 0.1) * 30, 22, Math.cos(t * 0.1) * 30);
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
  };
}
