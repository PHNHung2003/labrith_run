// =============================================================
// minimap.js — Top-down minimap with fog-of-war
//
// Performance model (works on 50x50 and 100x100):
//   • The static maze (floor + walls + exit) is rasterised ONCE into an
//     offscreen canvas (`baseCanvas`) at build time.
//   • Fog-of-war lives in a second offscreen canvas (`fogCanvas`) that starts
//     fully opaque. As the player moves we ERASE soft circles into it
//     (destination-out) — only when the player actually moves to a new spot.
//     Erased = permanently discovered.
//   • Each frame we only composite: baseCanvas -> [fogCanvas] -> dynamic
//     markers (flags + player). That's a handful of drawImage calls, never a
//     full rebuild.
// =============================================================

// local wall-bit constants (independent of maze.js internals)
const WN = 1, WS = 2, WE = 4, WW = 8;

const COL = {
  unexplored: '#0a0d15',
  exploredFloor: '#1b2334',
  wall: '#8a96ad',
  exit: '#ffd34d',
  exitGlow: 'rgba(255,211,77,0.35)',
  flag: '#ff5b5b',
  player: '#5bd6ff',
  playerEdge: '#ffffff',
  border: 'rgba(255,255,255,0.10)',
};

export class Minimap {
  constructor(maze, cellSize) {
    this.maze = maze;
    this.cellSize = cellSize;                 // world units per cell (CELL_SIZE)
    this.revealAll = false;

    // pixel scale per maze cell — clamp so big mazes stay light
    this.cellPx = Math.max(4, Math.round(600 / Math.max(maze.width, maze.height)));
    this.baseW = maze.width * this.cellPx;
    this.baseH = maze.height * this.cellPx;
    this.revealPx = ((/* vision cells */ 4.5) + 0.6) * this.cellPx;

    this._lastReveal = { x: -999, y: -999 };

    // visible canvas (kept at base resolution; CSS scales it for small/expanded)
    this.canvas = document.getElementById('minimap-canvas');
    this.canvas.width = this.baseW;
    this.canvas.height = this.baseH;
    this.ctx = this.canvas.getContext('2d');

    // offscreen layers
    this.baseCanvas = document.createElement('canvas');
    this.baseCanvas.width = this.baseW; this.baseCanvas.height = this.baseH;
    this.baseCtx = this.baseCanvas.getContext('2d');

    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = this.baseW; this.fogCanvas.height = this.baseH;
    this.fogCtx = this.fogCanvas.getContext('2d');

    this.expanded = false;
  }

  build() {
    this._rasterizeBaseMap();
    this._resetFog();
    return this;
  }

  // ---- static maze raster (runs once) ----
  _rasterizeBaseMap() {
    const ctx = this.baseCtx, cp = this.cellPx;
    ctx.clearRect(0, 0, this.baseW, this.baseH);

    // explored-floor background
    ctx.fillStyle = COL.exploredFloor;
    ctx.fillRect(0, 0, this.baseW, this.baseH);

    // exit cell highlight (glow + core)
    const ex = this.maze.exit.x * cp, ey = this.maze.exit.y * cp;
    ctx.fillStyle = COL.exitGlow;
    ctx.fillRect(ex - cp, ey - cp, cp * 3, cp * 3);
    ctx.fillStyle = COL.exit;
    ctx.fillRect(ex + cp * 0.18, ey + cp * 0.18, cp * 0.64, cp * 0.64);

    // walls
    ctx.strokeStyle = COL.wall;
    ctx.lineWidth = Math.max(1, cp * 0.18);
    ctx.lineCap = 'square';
    ctx.beginPath();
    for (let y = 0; y < this.maze.height; y++) {
      for (let x = 0; x < this.maze.width; x++) {
        const c = this.maze.cells[y][x];
        const px = x * cp, py = y * cp;
        if (c & WN) { ctx.moveTo(px, py); ctx.lineTo(px + cp, py); }
        if (c & WS) { ctx.moveTo(px, py + cp); ctx.lineTo(px + cp, py + cp); }
        if (c & WW) { ctx.moveTo(px, py); ctx.lineTo(px, py + cp); }
        if (c & WE) { ctx.moveTo(px + cp, py); ctx.lineTo(px + cp, py + cp); }
      }
    }
    ctx.stroke();
  }

  _resetFog() {
    const ctx = this.fogCtx;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = COL.unexplored;
    ctx.fillRect(0, 0, this.baseW, this.baseH);
    this._lastReveal = { x: -999, y: -999 };
  }

  // Mark a wall destroyed by the hammer — re-rasterise that edge so the
  // minimap reflects the opening. Cheap (clears + redraws one cell area).
  refreshCell(cx, cy) {
    // simplest robust approach: re-rasterise whole base map (rare event)
    this._rasterizeBaseMap();
  }

  setRevealAll(on) { this.revealAll = on; }

  toggleExpand() {
    this.expanded = !this.expanded;
    const wrap = document.getElementById('minimap');
    wrap.classList.toggle('expanded', this.expanded);
    const hint = document.getElementById('minimap-hint');
    if (hint) hint.textContent = this.expanded ? 'M to close' : 'M to expand';
    const legend = document.getElementById('minimap-legend');
    if (legend) legend.classList.toggle('hidden', !this.expanded);
  }

  // Erase a soft circle of fog at the player's location (only when moved).
  _revealAt(mapX, mapY) {
    const dx = mapX - this._lastReveal.x, dy = mapY - this._lastReveal.y;
    if (dx * dx + dy * dy < (this.cellPx * 0.4) ** 2) return; // throttle
    this._lastReveal = { x: mapX, y: mapY };

    const ctx = this.fogCtx;
    ctx.globalCompositeOperation = 'destination-out';
    const r = this.revealPx;
    const g = ctx.createRadialGradient(mapX, mapY, r * 0.35, mapX, mapY, r);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(mapX, mapY, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  // Called each frame. `reveal` gates fog discovery (only while playing).
  update(player, flags, reveal = true) {
    const cp = this.cellPx;
    const pX = (player.position.x / this.cellSize) * cp;
    const pY = (player.position.z / this.cellSize) * cp;

    if (reveal) this._revealAt(pX, pY);

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.baseW, this.baseH);

    // 1) static maze
    ctx.drawImage(this.baseCanvas, 0, 0);

    // 2) fog (skipped entirely while a Vision Orb is active)
    if (!this.revealAll) ctx.drawImage(this.fogCanvas, 0, 0);

    // 3) flags (player knowledge — always shown)
    if (flags && flags.length) {
      ctx.fillStyle = COL.flag;
      for (const f of flags) {
        const fx = (f.mesh.position.x / this.cellSize) * cp;
        const fy = (f.mesh.position.z / this.cellSize) * cp;
        const s = Math.max(3, cp * 0.42);
        ctx.beginPath();
        ctx.moveTo(fx, fy - s);
        ctx.lineTo(fx + s * 0.85, fy - s * 0.45);
        ctx.lineTo(fx, fy + s * 0.1);
        ctx.closePath();
        ctx.fill();
        ctx.fillRect(fx - 0.6, fy - s, 1.2, s * 1.3);
      }
    }

    // 4) player marker + facing triangle
    const f = player.facing;
    const fwdX = Math.sin(f), fwdY = Math.cos(f);
    const perpX = fwdY, perpY = -fwdX;
    const size = Math.max(5, cp * 0.7);
    ctx.fillStyle = COL.player;
    ctx.strokeStyle = COL.playerEdge;
    ctx.lineWidth = Math.max(1, cp * 0.08);
    ctx.beginPath();
    ctx.moveTo(pX + fwdX * size, pY + fwdY * size);
    ctx.lineTo(pX - fwdX * size * 0.55 + perpX * size * 0.6, pY - fwdY * size * 0.55 + perpY * size * 0.6);
    ctx.lineTo(pX - fwdX * size * 0.55 - perpX * size * 0.6, pY - fwdY * size * 0.55 - perpY * size * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  dispose() {
    // canvases are GC'd; nothing scene-bound to remove
  }
}
