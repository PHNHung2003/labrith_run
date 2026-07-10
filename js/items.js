// =============================================================
// items.js — Item spawning, pickups, and player-placed flags
// Item types: COMPASS, VISION_ORB, HAMMER, FLAG(placed by player)
// =============================================================

import * as THREE from 'three';

export const ITEM = {
  COMPASS: 'COMPASS',
  VISION: 'VISION',
  HAMMER: 'HAMMER',
};

const PICKUP_RADIUS = 1.1;

// shared geometries (reuse for performance)
const G = {
  compass: new THREE.TorusGeometry(0.34, 0.1, 12, 24),
  compassNeedle: new THREE.ConeGeometry(0.12, 0.5, 8),
  orb: new THREE.IcosahedronGeometry(0.38, 1),
  hammerHead: new THREE.BoxGeometry(0.5, 0.32, 0.32),
  hammerHandle: new THREE.CylinderGeometry(0.07, 0.07, 0.7, 8),
  flagPole: new THREE.CylinderGeometry(0.04, 0.04, 1.4, 6),
  flagCloth: new THREE.PlaneGeometry(0.5, 0.32),
  base: new THREE.CircleGeometry(0.5, 20),
};

export class ItemManager {
  constructor(maze, scene) {
    this.maze = maze;
    this.scene = scene;
    this.items = [];      // active pickups
    this.flags = [];      // placed flags
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  // ---------------------------------------------------------
  // Spawn a set of items in random valid cells.
  // ---------------------------------------------------------
  spawnItems({ compass = 3, vision = 2, hammer = 3 } = {}) {
    const used = new Set();
    const block = (c) => used.add(`${c.x},${c.y}`);
    block(this.maze.entrance);
    block(this.maze.exit);

    const plan = [];
    for (let i = 0; i < compass; i++) plan.push(ITEM.COMPASS);
    for (let i = 0; i < vision; i++) plan.push(ITEM.VISION);
    for (let i = 0; i < hammer; i++) plan.push(ITEM.HAMMER);

    for (const type of plan) {
      const cell = this._randomFreeCell(used);
      if (!cell) break;
      block(cell);
      this._createItem(type, cell);
    }
  }

  _randomFreeCell(used, tries = 60) {
    for (let i = 0; i < tries; i++) {
      const x = (Math.random() * this.maze.width) | 0;
      const y = (Math.random() * this.maze.height) | 0;
      if (!used.has(`${x},${y}`)) return { x, y };
    }
    return null;
  }

  _createItem(type, cell) {
    const pos = this.maze.cellCenter(cell.x, cell.y);
    const g = new THREE.Group();
    g.position.copy(pos);

    let glowColor;
    if (type === ITEM.COMPASS) {
      glowColor = 0xffd34d;
      const ringMat = new THREE.MeshStandardMaterial({ color: 0xffd34d, emissive: 0xffb000, emissiveIntensity: 0.9, metalness: 0.3, roughness: 0.4 });
      const ring = new THREE.Mesh(G.compass, ringMat);
      ring.rotation.x = Math.PI / 2;
      const needle = new THREE.Mesh(G.compassNeedle, new THREE.MeshStandardMaterial({ color: 0xff5555, emissive: 0x551111 }));
      needle.rotation.x = Math.PI / 2;
      g.add(ring, needle);
    } else if (type === ITEM.VISION) {
      glowColor = 0x4dd2ff;
      const orb = new THREE.Mesh(G.orb, new THREE.MeshStandardMaterial({
        color: 0x4dd2ff, emissive: 0x1188cc, emissiveIntensity: 1.2, transparent: true, opacity: 0.85,
      }));
      g.add(orb);
    } else if (type === ITEM.HAMMER) {
      glowColor = 0xff8a4d;
      const headMat = new THREE.MeshStandardMaterial({ color: 0xff8a4d, emissive: 0x552200, emissiveIntensity: 0.7, metalness: 0.5, roughness: 0.5 });
      const head = new THREE.Mesh(G.hammerHead, headMat);
      head.position.y = 0.35;
      const handle = new THREE.Mesh(G.hammerHandle, new THREE.MeshStandardMaterial({ color: 0x8a5a30 }));
      handle.position.y = 0.0;
      g.add(head, handle);
      g.rotation.z = 0.3;
    }

    // floor glow disc
    const disc = new THREE.Mesh(G.base, new THREE.MeshBasicMaterial({ color: glowColor, transparent: true, opacity: 0.28 }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.03;
    g.add(disc);

    // a small light so items glint in the dark
    const light = new THREE.PointLight(glowColor, 0.8, 4.0, 2.0);
    light.position.y = 0.8;
    g.add(light);

    g.position.y = 0; // base on floor; inner meshes lifted
    g.children.forEach(ch => { if (ch !== disc) ch.position.y += 0.9; });

    this.group.add(g);
    this.items.push({ type, mesh: g, cell, baseY: 0.9, phase: Math.random() * Math.PI * 2, picked: false });
  }

  // ---------------------------------------------------------
  // Per-frame: animate + detect pickups near the player.
  // onPickup(type) is called when the player walks over an item.
  // ---------------------------------------------------------
  update(dt, time, playerPos, onPickup) {
    for (const it of this.items) {
      if (it.picked) continue;
      it.mesh.rotation.y += dt * 1.4;
      const bob = Math.sin(time * 2 + it.phase) * 0.12;
      it.mesh.children.forEach(ch => {
        if (ch.geometry === G.base) return;
      });
      it.mesh.position.y = bob;

      const dx = it.mesh.position.x - playerPos.x;
      const dz = it.mesh.position.z - playerPos.z;
      if (dx * dx + dz * dz < PICKUP_RADIUS * PICKUP_RADIUS) {
        // onPickup returns false to refuse (e.g. already carrying a hammer)
        const consumed = onPickup(it.type);
        if (consumed !== false) {
          it.picked = true;
          this.group.remove(it.mesh);
          this._disposeGroup(it.mesh);
        }
      }
    }
    // animate placed flags (gentle wave)
    for (const f of this.flags) {
      f.cloth.rotation.y = Math.sin(time * 3 + f.phase) * 0.25;
    }
  }

  // ---------------------------------------------------------
  // Flags — placed by the player to mark explored paths.
  // ---------------------------------------------------------
  placeFlag(position) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(G.flagPole, new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.4, roughness: 0.5 }));
    pole.position.y = 0.7;
    const cloth = new THREE.Mesh(G.flagCloth, new THREE.MeshStandardMaterial({ color: 0xff6b6b, emissive: 0x551515, emissiveIntensity: 0.5, side: THREE.DoubleSide }));
    cloth.position.set(0.27, 1.2, 0);
    g.add(pole, cloth);
    g.position.set(position.x, 0, position.z);
    this.group.add(g);
    this.flags.push({ mesh: g, cloth, phase: Math.random() * Math.PI * 2 });
    return this.flags.length;
  }

  _disposeGroup(g) {
    g.traverse(o => {
      // shared geometries are reused; only dispose materials/lights
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
        else o.material.dispose();
      }
    });
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(o => {
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
        else o.material.dispose();
      }
    });
  }
}
