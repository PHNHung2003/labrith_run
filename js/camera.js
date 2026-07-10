// =============================================================
// camera.js — Fixed third-person follow camera
//
// Behaves like Temple Run / Subway Surfers / Crash Bandicoot:
//   • ALWAYS a fixed horizontal distance behind the player.
//   • ALWAYS a fixed height above the player.
//   • Looks down at a fixed ~39° angle.
//   • NEVER zooms, NEVER changes distance, NEVER changes FOV.
//   • NEVER rotates from mouse input (there is no mouse handling at all).
//   • Only the camera POSITION is smoothed (lerp) as it trails the player.
//
// There is intentionally NO distance-based wall collision — that dynamic
// pull-in was the source of the constant zoom-in/out. The only positional
// safeguard is a gentle clamp that keeps the camera above the maze floor so
// it never slides into the void; the boom length is otherwise constant.
// =============================================================

import * as THREE from 'three';
import { CELL_SIZE } from './maze.js';

const DIST      = 10.0;   // fixed horizontal distance behind the player
const HEIGHT    = 8.0;    // fixed height above the player  (atan(8/10) ≈ 39°)
const LOOK_AT_Y = 1.2;    // aim a bit above the player's feet
const POS_LERP  = 7.0;    // position smoothing (the ONLY interpolation)
const LOOK_LERP = 10.0;   // look-target smoothing

export class FollowCamera {
  constructor(camera, maze) {
    this.camera = camera;
    this.maze = maze;
    this.yaw = 0;                       // exposed = current facing
    this._initialized = false;
    this.currentPos = new THREE.Vector3();
    this.currentLook = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._look = new THREE.Vector3();

    // maze world bounds (for the gentle keep-over-floor clamp)
    this._minX = -CELL_SIZE * 0.5;
    this._minZ = -CELL_SIZE * 0.5;
    this._maxX = maze.width * CELL_SIZE + CELL_SIZE * 0.5;
    this._maxZ = maze.height * CELL_SIZE + CELL_SIZE * 0.5;
  }

  /**
   * @param {number} dt
   * @param {THREE.Vector3} target  player position
   * @param {number} facing         player yaw; camera sits directly behind it
   */
  update(dt, target, facing) {
    this.yaw = facing;

    // forward unit vector; camera sits the OPPOSITE way (behind), fixed length
    const fx = Math.sin(facing), fz = Math.cos(facing);

    this._desired.set(
      target.x - fx * DIST,
      target.y + HEIGHT,        // fixed height — never recomputed
      target.z - fz * DIST
    );

    // Gentle, non-zooming safeguard: keep the camera horizontally inside the
    // maze footprint so it never drifts over the edge into empty space. This
    // never shortens the boom toward the player, so it cannot cause zoom.
    this._desired.x = Math.min(this._maxX, Math.max(this._minX, this._desired.x));
    this._desired.z = Math.min(this._maxZ, Math.max(this._minZ, this._desired.z));

    if (!this._initialized) {
      this.currentPos.copy(this._desired);
      this.currentLook.set(target.x, target.y + LOOK_AT_Y, target.z);
      this._initialized = true;
    }

    // position smoothing ONLY
    const fp = 1 - Math.exp(-POS_LERP * dt);
    this.currentPos.lerp(this._desired, fp);

    const fl = 1 - Math.exp(-LOOK_LERP * dt);
    this._look.set(target.x, target.y + LOOK_AT_Y, target.z);
    this.currentLook.lerp(this._look, fl);

    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLook);
    // NOTE: FOV is never touched here — it stays whatever main.js set once.
  }
}
