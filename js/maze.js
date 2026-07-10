// =============================================================
// maze.js — Procedural maze generation + 3D rendering + collision
// Algorithm: Recursive Backtracking (iterative stack version).
// Produces a "perfect maze" (every cell reachable, no loops),
// guaranteeing the exit is always solvable.
// =============================================================

import * as THREE from 'three';

// ---- Tunable geometry constants ----
export const CELL_SIZE      = 4.0;   // world units per maze cell
export const WALL_HEIGHT    = 3.2;   // wall height
export const WALL_THICKNESS = 0.45;  // wall thickness

// Directions: bit flags for walls on each cell
const N = 1, S = 2, E = 4, W = 8;
const DX = { [N]: 0, [S]: 0, [E]: 1, [W]: -1 };
const DY = { [N]: -1, [S]: 1, [E]: 0, [W]: 0 };
const OPP = { [N]: S, [S]: N, [E]: W, [W]: E };

export class Maze {
  /**
   * @param {number} width  number of cells in X
   * @param {number} height number of cells in Z
   */
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.cells = [];           // cells[y][x] = wall bitmask (1 = wall present)
    this.colliders = [];       // axis-aligned wall boxes for collision
    this.group = new THREE.Group();
    this.wallMesh = null;
    this._wallMatrix = new THREE.Matrix4();
    this._colliderByInstance = new Map(); // instanceId -> collider ref

    this._generate();
    this._pickEntranceAndExit();
    this.computeNavField();   // BFS distance-to-exit for the smart compass
  }

  // ---------------------------------------------------------
  // Navigation field: BFS flood from the EXIT across open passages.
  // navField[y][x] = number of steps to the exit (respecting walls).
  // O(1) "next step" queries derive from it; rebuilt only when the maze
  // topology changes (hammer). This is the brain of the smart compass.
  // ---------------------------------------------------------
  computeNavField() {
    const { width: w, height: h } = this;
    const dist = Array.from({ length: h }, () => new Array(w).fill(-1));
    const q = [[this.exit.x, this.exit.y]];
    dist[this.exit.y][this.exit.x] = 0;
    let head = 0;
    while (head < q.length) {
      const [x, y] = q[head++];
      const c = this.cells[y][x];
      for (const dir of [N, S, E, W]) {
        if (c & dir) continue;
        const nx = x + DX[dir], ny = y + DY[dir];
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        if (dist[ny][nx] !== -1) continue;
        dist[ny][nx] = dist[y][x] + 1;
        q.push([nx, ny]);
      }
    }
    this.navField = dist;
  }

  // Next correct cell to move toward from `cell` on the shortest path to the
  // exit. Returns { cellCenter, dir } or { atExit:true } or null.
  nextStepDir(cell) {
    const { x, y } = cell;
    if (!this.inBounds(x, y) || !this.navField) return null;
    if (x === this.exit.x && y === this.exit.y) return { atExit: true };
    const d = this.navField[y][x];
    if (d < 0) return null;                       // unreachable (shouldn't happen)
    const c = this.cells[y][x];
    let best = null, bestD = d;
    for (const dir of [N, S, E, W]) {
      if (c & dir) continue;                      // wall blocks
      const nx = x + DX[dir], ny = y + DY[dir];
      if (!this.inBounds(nx, ny)) continue;
      const nd = this.navField[ny][nx];
      if (nd !== -1 && nd < bestD) { bestD = nd; best = { nx, ny, dir }; }
    }
    if (!best) return null;
    return {
      cellCenter: this.cellCenter(best.nx, best.ny),
      dir: new THREE.Vector3(DX[best.dir], 0, DY[best.dir]),
    };
  }

  // ---------------------------------------------------------
  // Maze carving (recursive backtracking, iterative)
  // ---------------------------------------------------------
  _generate() {
    const { width: w, height: h } = this;
    // start: every cell fully walled
    this.cells = Array.from({ length: h }, () => new Array(w).fill(N | S | E | W));

    const visited = Array.from({ length: h }, () => new Array(w).fill(false));
    const stack = [];
    let cx = Math.floor(Math.random() * w);
    let cy = Math.floor(Math.random() * h);
    visited[cy][cx] = true;
    stack.push([cx, cy]);

    while (stack.length) {
      [cx, cy] = stack[stack.length - 1];
      // gather unvisited neighbours
      const dirs = [N, S, E, W].filter(d => {
        const nx = cx + DX[d], ny = cy + DY[d];
        return nx >= 0 && nx < w && ny >= 0 && ny < h && !visited[ny][nx];
      });

      if (dirs.length === 0) {
        stack.pop();
        continue;
      }
      const d = dirs[(Math.random() * dirs.length) | 0];
      const nx = cx + DX[d], ny = cy + DY[d];
      // knock down walls between current and neighbour
      this.cells[cy][cx] &= ~d;
      this.cells[ny][nx] &= ~OPP[d];
      visited[ny][nx] = true;
      stack.push([nx, ny]);
    }
  }

  // ---------------------------------------------------------
  // Choose entrance + exit. Exit = farthest cell from a random
  // entrance (BFS), so the journey is long and interesting.
  // ---------------------------------------------------------
  _pickEntranceAndExit() {
    const { width: w, height: h } = this;
    // entrance: random border cell
    this.entrance = this._randomBorderCell();
    // BFS to find farthest reachable cell
    const dist = Array.from({ length: h }, () => new Array(w).fill(-1));
    const q = [[this.entrance.x, this.entrance.y]];
    dist[this.entrance.y][this.entrance.x] = 0;
    let far = { x: this.entrance.x, y: this.entrance.y, d: 0 };
    while (q.length) {
      const [x, y] = q.shift();
      const cell = this.cells[y][x];
      for (const dir of [N, S, E, W]) {
        if (cell & dir) continue; // wall blocks
        const nx = x + DX[dir], ny = y + DY[dir];
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        if (dist[ny][nx] !== -1) continue;
        dist[ny][nx] = dist[y][x] + 1;
        if (dist[ny][nx] > far.d) far = { x: nx, y: ny, d: dist[ny][nx] };
        q.push([nx, ny]);
      }
    }
    this.exit = { x: far.x, y: far.y };
    this.distanceField = dist;
  }

  _randomBorderCell() {
    const { width: w, height: h } = this;
    const side = (Math.random() * 4) | 0;
    if (side === 0) return { x: (Math.random() * w) | 0, y: 0 };
    if (side === 1) return { x: (Math.random() * w) | 0, y: h - 1 };
    if (side === 2) return { x: 0, y: (Math.random() * h) | 0 };
    return { x: w - 1, y: (Math.random() * h) | 0 };
  }

  // ---------------------------------------------------------
  // Coordinate helpers
  // ---------------------------------------------------------
  cellCenter(cx, cy) {
    return new THREE.Vector3(
      cx * CELL_SIZE + CELL_SIZE / 2,
      0,
      cy * CELL_SIZE + CELL_SIZE / 2
    );
  }
  worldToCell(v) {
    return {
      x: Math.floor(v.x / CELL_SIZE),
      y: Math.floor(v.z / CELL_SIZE),
    };
  }
  inBounds(cx, cy) {
    return cx >= 0 && cx < this.width && cy >= 0 && cy < this.height;
  }

  // ---------------------------------------------------------
  // Build all renderable + collidable walls.
  // Uses a single InstancedMesh (cheap for 50x50).
  // Walls are deduped by edge key so shared walls render once.
  // ---------------------------------------------------------
  build(scene) {
    const segments = this._collectWallSegments();

    // Base unit box, scaled per-instance.
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x6b7488,
      roughness: 0.85,
      metalness: 0.05,
    });
    // subtle vertex-color-ish variation via emissive off; keep simple & fast
    const mesh = new THREE.InstancedMesh(geo, mat, segments.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();

    segments.forEach((seg, i) => {
      pos.set(seg.cx, WALL_HEIGHT / 2, seg.cz);
      if (seg.horizontal) {
        scl.set(seg.length, WALL_HEIGHT, WALL_THICKNESS);
      } else {
        scl.set(WALL_THICKNESS, WALL_HEIGHT, seg.length);
      }
      m.compose(pos, q, scl);
      mesh.setMatrixAt(i, m);

      // collider AABB (in XZ; Y ignored for movement)
      const halfX = (seg.horizontal ? seg.length : WALL_THICKNESS) / 2;
      const halfZ = (seg.horizontal ? WALL_THICKNESS : seg.length) / 2;
      const collider = {
        minX: seg.cx - halfX, maxX: seg.cx + halfX,
        minZ: seg.cz - halfZ, maxZ: seg.cz + halfZ,
        instanceId: i, active: true,
      };
      this.colliders.push(collider);
      this._colliderByInstance.set(i, collider);
    });

    mesh.instanceMatrix.needsUpdate = true;
    this.wallMesh = mesh;
    this.group.add(mesh);

    this._buildFloor();
    this._buildExitMarker();

    scene.add(this.group);
    return this;
  }

  _collectWallSegments() {
    const { width: w, height: h } = this;
    const seen = new Set();
    const segs = [];
    const halfPad = WALL_THICKNESS / 2;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = this.cells[y][x];
        // North edge (horizontal) at z = y*CELL
        if (c & N) this._addH(segs, seen, x, y, halfPad);
        // South edge at z = (y+1)*CELL
        if (c & S) this._addH(segs, seen, x, y + 1, halfPad);
        // West edge (vertical) at x = x*CELL
        if (c & W) this._addV(segs, seen, x, y, halfPad);
        // East edge at x = (x+1)*CELL
        if (c & E) this._addV(segs, seen, x + 1, y, halfPad);
      }
    }
    return segs;
  }

  _addH(segs, seen, col, rowLine, pad) {
    const key = `h_${col}_${rowLine}`;
    if (seen.has(key)) return;
    seen.add(key);
    segs.push({
      key, horizontal: true,
      cx: col * CELL_SIZE + CELL_SIZE / 2,
      cz: rowLine * CELL_SIZE,
      length: CELL_SIZE + pad * 2,
    });
  }
  _addV(segs, seen, colLine, row, pad) {
    const key = `v_${colLine}_${row}`;
    if (seen.has(key)) return;
    seen.add(key);
    segs.push({
      key, horizontal: false,
      cx: colLine * CELL_SIZE,
      cz: row * CELL_SIZE + CELL_SIZE / 2,
      length: CELL_SIZE + pad * 2,
    });
  }

  _buildFloor() {
    const W = this.width * CELL_SIZE;
    const H = this.height * CELL_SIZE;
    const geo = new THREE.PlaneGeometry(W, H);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x16181f, roughness: 1.0, metalness: 0.0,
    });
    const floor = new THREE.Mesh(geo, mat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(W / 2, 0, H / 2);
    floor.receiveShadow = true;
    this.group.add(floor);

    // faint grid for depth perception
    const grid = new THREE.GridHelper(Math.max(W, H), Math.max(this.width, this.height), 0x2a2f3a, 0x20242d);
    grid.position.set(W / 2, 0.02, H / 2);
    grid.material.opacity = 0.25;
    grid.material.transparent = true;
    this.group.add(grid);
  }

  _buildExitMarker() {
    const c = this.cellCenter(this.exit.x, this.exit.y);
    const group = new THREE.Group();

    // glowing pillar
    const pillarGeo = new THREE.CylinderGeometry(0.55, 0.7, WALL_HEIGHT * 1.4, 24, 1, true);
    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0xffd34d, emissive: 0xffb000, emissiveIntensity: 1.6,
      transparent: true, opacity: 0.55, side: THREE.DoubleSide,
    });
    const pillar = new THREE.Mesh(pillarGeo, pillarMat);
    pillar.position.y = WALL_HEIGHT * 0.7;
    group.add(pillar);

    // bright point light (the beacon)
    const light = new THREE.PointLight(0xffc940, 2.4, CELL_SIZE * 6, 2.0);
    light.position.y = WALL_HEIGHT * 0.8;
    group.add(light);

    // floor glow ring
    const ringGeo = new THREE.RingGeometry(0.8, 1.4, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    group.add(ring);

    group.position.copy(c);
    this.exitMarker = group;
    this.exitMarkerPillar = pillar;
    this.exitMarkerLight = light;
    this.group.add(group);
  }

  // animate exit beacon
  update(dt, time) {
    if (this.exitMarkerPillar) {
      this.exitMarkerPillar.rotation.y += dt * 0.6;
      const pulse = 1.2 + Math.sin(time * 2.5) * 0.5;
      this.exitMarkerPillar.material.emissiveIntensity = pulse;
      if (this.exitMarkerLight) this.exitMarkerLight.intensity = 1.8 + Math.sin(time * 2.5) * 0.8;
    }
  }

  // ---------------------------------------------------------
  // Hammer: destroy the wall segment directly in front of pos
  // along dir. Returns true if a wall was removed.
  // ---------------------------------------------------------
  removeWallInFront(pos, dir) {
    const reach = CELL_SIZE * 0.9;
    const probe = new THREE.Vector3(
      pos.x + dir.x * reach,
      0,
      pos.z + dir.z * reach
    );
    // find closest active collider whose box contains/near probe
    let best = null, bestD = Infinity;
    for (const col of this.colliders) {
      if (!col.active) continue;
      const cx = (col.minX + col.maxX) / 2;
      const cz = (col.minZ + col.maxZ) / 2;
      // skip outer perimeter walls so player can't break the world boundary open into void? keep allowed for fun
      const dx = cx - probe.x, dz = cz - probe.z;
      const d = dx * dx + dz * dz;
      // must be roughly in front
      const toWall = new THREE.Vector3(cx - pos.x, 0, cz - pos.z).normalize();
      const facing = toWall.x * dir.x + toWall.z * dir.z;
      if (facing < 0.45) continue;
      if (d < bestD && d < (CELL_SIZE * 1.2) ** 2) { bestD = d; best = col; }
    }
    if (!best) return false;
    this._openWallForCollider(best);  // clear wall bits so pathfinding sees the gap
    this._removeCollider(best);
    this.computeNavField();           // topology changed → rebuild nav field
    return true;
  }

  // Clear the maze wall bits for the two cells that share a destroyed wall,
  // so collision/pathfinding treat the opening as a real passage.
  _openWallForCollider(col) {
    const cx = (col.minX + col.maxX) / 2;
    const cz = (col.minZ + col.maxZ) / 2;
    const horizontal = (col.maxX - col.minX) > (col.maxZ - col.minZ);
    if (horizontal) {
      const colIdx = Math.floor(cx / CELL_SIZE);
      const ry = Math.round(cz / CELL_SIZE);
      if (this.inBounds(colIdx, ry - 1)) this.cells[ry - 1][colIdx] &= ~S;
      if (this.inBounds(colIdx, ry))     this.cells[ry][colIdx]     &= ~N;
    } else {
      const colLine = Math.round(cx / CELL_SIZE);
      const row = Math.floor(cz / CELL_SIZE);
      if (this.inBounds(colLine - 1, row)) this.cells[row][colLine - 1] &= ~E;
      if (this.inBounds(colLine, row))     this.cells[row][colLine]     &= ~W;
    }
  }

  _removeCollider(col) {
    col.active = false;
    // hide its instance by zero-scaling
    if (this.wallMesh && col.instanceId != null) {
      this._wallMatrix.makeScale(0, 0, 0);
      this._wallMatrix.setPosition(0, -9999, 0);
      this.wallMesh.setMatrixAt(col.instanceId, this._wallMatrix);
      this.wallMesh.instanceMatrix.needsUpdate = true;
    }
  }

  // expose active colliders for collision system
  get activeColliders() {
    return this.colliders;
  }

  dispose(scene) {
    scene.remove(this.group);
    this.group.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
  }
}
