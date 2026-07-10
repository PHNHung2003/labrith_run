// =============================================================
// player.js — Placeholder character, movement, collision, light
// =============================================================

import * as THREE from 'three';
import { CELL_SIZE } from './maze.js';

// ---- Tunables ----
export const VISION_RADIUS = 18.0;    // clear-sight radius (world units ≈ meters)
const PLAYER_RADIUS = 0.55;           // collision radius
const MOVE_SPEED    = 6.0;            // units / sec
const SPRINT_SPEED  = 9.5;
const ACCEL         = 14.0;           // velocity smoothing
const TURN_RATE     = 2.8;            // steering speed (radians / sec)
const REVERSE_FACTOR = 0.55;          // reverse is slower than forward

export class Player {
  constructor(maze) {
    this.maze = maze;
    this.position = maze.cellCenter(maze.entrance.x, maze.entrance.y);
    this.position.y = 0;
    this.velocity = new THREE.Vector3();
    this.facing = 0;                  // yaw radians
    this.radius = PLAYER_RADIUS;

    this.group = new THREE.Group();
    this._buildMesh();
    this.group.position.copy(this.position);

    // Dynamic "lantern" that follows the player — the heart of the visibility
    // system. Bright core for clear nearby sight, gentle decay for falloff.
    this.light = new THREE.PointLight(0xffe6b8, 3.0, VISION_RADIUS * 2.6, 1.3);
    this.light.position.set(0, 2.4, 0);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(1024, 1024);
    this.light.shadow.camera.near = 0.2;
    this.light.shadow.camera.far = VISION_RADIUS * 2.8;
    this.light.shadow.bias = -0.0015;
    this.group.add(this.light);

    // Wide, soft fill light (no shadow) so the lantern pool reads as a smooth
    // bright→dim gradient instead of a harsh spot.
    this.fillLight = new THREE.PointLight(0xbcd0ff, 1.2, VISION_RADIUS * 1.5, 1.1);
    this.fillLight.position.set(0, 2.6, 0);
    this.group.add(this.fillLight);

    // a soft glow orb so the player is always visible in the dark
    const glowGeo = new THREE.SphereGeometry(0.25, 12, 12);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffe9b0, transparent: true, opacity: 0.9 });
    this.lantern = new THREE.Mesh(glowGeo, glowMat);
    this.lantern.position.set(0, 1.9, 0.1);
    this.group.add(this.lantern);
  }

  _buildMesh() {
    const body = new THREE.Group();

    const skin = new THREE.MeshStandardMaterial({ color: 0x4dd2ff, roughness: 0.4, metalness: 0.1, emissive: 0x0a2a33, emissiveIntensity: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.7 });

    // torso (capsule)
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.7, 6, 12), skin);
    torso.position.y = 1.05;
    torso.castShadow = true;
    body.add(torso);

    // head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.33, 16, 16), skin);
    head.position.y = 1.78;
    head.castShadow = true;
    body.add(head);

    // visor (shows facing direction)
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.16), dark);
    visor.position.set(0, 1.8, 0.28);
    body.add(visor);

    // legs
    const legGeo = new THREE.CapsuleGeometry(0.16, 0.5, 4, 8);
    this.legL = new THREE.Mesh(legGeo, dark);
    this.legR = new THREE.Mesh(legGeo, dark);
    this.legL.position.set(-0.2, 0.4, 0);
    this.legR.position.set(0.2, 0.4, 0);
    this.legL.castShadow = this.legR.castShadow = true;
    body.add(this.legL, this.legR);

    this.mesh = body;
    this.group.add(body);
  }

  /**
   * @param {number} dt
   * @param {object} input  { forward, back, left, right, sprint }
   * @param {number} cameraYaw  yaw of the camera (movement is camera-relative)
   */
  /**
   * Steering controls (Temple-Run / Crash style):
   *   W = drive forward · S = reverse · A = turn left · D = turn right
   * The camera always sits behind `facing`, so controls stay consistent.
   * @param {number} dt
   * @param {object} input { forward, back, left, right, sprint }
   */
  update(dt, input) {
    // ---- turning (A/D) ----
    // Increasing `facing` rotates the forward vector toward the player's LEFT,
    // so A (left) adds and D (right) subtracts.
    let turn = 0;
    if (input.left)  turn += 1;
    if (input.right) turn -= 1;
    if (turn !== 0) this.facing += turn * TURN_RATE * dt;

    // ---- drive (W/S) along facing ----
    let drive = 0;
    if (input.forward) drive += 1;
    if (input.back)    drive -= REVERSE_FACTOR;
    const speed = (input.sprint ? SPRINT_SPEED : MOVE_SPEED) * drive;

    const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    const desX = fx * speed, desZ = fz * speed;

    // accelerate velocity toward desired (smooth start/stop)
    const a = 1 - Math.exp(-ACCEL * dt);
    this.velocity.x += (desX - this.velocity.x) * a;
    this.velocity.z += (desZ - this.velocity.z) * a;

    // integrate with axis-separated collision resolution (wall sliding)
    this._moveAxis('x', this.velocity.x * dt);
    this._moveAxis('z', this.velocity.z * dt);

    // apply transform
    this.group.position.copy(this.position);
    this.mesh.rotation.y = this.facing;

    // leg bob animation (scaled by forward speed)
    const speedMag = Math.hypot(this.velocity.x, this.velocity.z);
    this._walkPhase = (this._walkPhase || 0) + dt * speedMag * 2.2;
    const swing = Math.sin(this._walkPhase) * Math.min(speedMag / MOVE_SPEED, 1) * 0.5;
    if (this.legL) this.legL.rotation.x = swing;
    if (this.legR) this.legR.rotation.x = -swing;

    // gentle lantern flicker around its base intensity
    this.light.intensity = 3.0 + Math.sin(performance.now() * 0.006) * 0.18;
  }

  // Move along one axis, then resolve against wall AABBs.
  _moveAxis(axis, delta) {
    if (delta === 0) return;
    if (axis === 'x') this.position.x += delta;
    else this.position.z += delta;

    const r = this.radius;
    const cell = this.maze.worldToCell(this.position);
    // check colliders in a small neighbourhood for performance
    for (const col of this.maze.activeColliders) {
      if (!col.active) continue;
      // broad-phase: skip far walls
      const cx = (col.minX + col.maxX) * 0.5;
      const cz = (col.minZ + col.maxZ) * 0.5;
      if (Math.abs(cx - this.position.x) > CELL_SIZE * 1.5) continue;
      if (Math.abs(cz - this.position.z) > CELL_SIZE * 1.5) continue;

      // closest point on AABB to circle center
      const nx = Math.max(col.minX, Math.min(this.position.x, col.maxX));
      const nz = Math.max(col.minZ, Math.min(this.position.z, col.maxZ));
      let dx = this.position.x - nx;
      let dz = this.position.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        const d = Math.sqrt(d2) || 0.0001;
        const push = (r - d) / d;
        if (axis === 'x') {
          // only push back on the moved axis to keep wall-sliding smooth
          this.position.x += dx * push;
          this.velocity.x = 0;
        } else {
          this.position.z += dz * push;
          this.velocity.z = 0;
        }
      }
    }
  }

  _lerpAngle(a, b, t) {
    let diff = b - a;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
  }

  // direction the player is facing on the XZ plane (unit vector)
  get forwardVector() {
    return new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
  }

  addToScene(scene) { scene.add(this.group); }
  removeFromScene(scene) { scene.remove(this.group); }
}
