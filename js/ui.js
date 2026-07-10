// =============================================================
// ui.js — HUD controller (timer, effects, compass, toasts, screens)
// Pure DOM manipulation; no framework.
// =============================================================

export class UI {
  constructor() {
    this.el = {
      hud: document.getElementById('hud'),
      crosshair: document.getElementById('crosshair'),
      timer: document.getElementById('timer-value'),
      hammer: document.getElementById('hammer-status'),
      flagCount: document.getElementById('flag-count'),
      items: document.getElementById('items-collected'),
      effects: document.getElementById('effects-panel'),
      compass: document.getElementById('compass'),
      compassArrow: document.getElementById('compass-arrow'),
      compassTimer: document.getElementById('compass-timer'),
      startScreen: document.getElementById('start-screen'),
      victoryScreen: document.getElementById('victory-screen'),
      victoryStats: document.getElementById('victory-stats'),
      lockPrompt: document.getElementById('lock-prompt'),
      loading: document.getElementById('loading'),
    };
    // toast layer
    this.toastLayer = document.createElement('div');
    this.toastLayer.id = 'toast-layer';
    document.body.appendChild(this.toastLayer);
  }

  showGameHUD() {
    this.el.hud.classList.remove('hidden');
    this.el.crosshair.classList.remove('hidden');
  }
  hideGameHUD() {
    this.el.hud.classList.add('hidden');
    this.el.crosshair.classList.add('hidden');
  }

  hideLoading() { this.el.loading.classList.add('hidden'); }
  showStart() { this.el.startScreen.classList.remove('hidden'); }
  hideStart() { this.el.startScreen.classList.add('hidden'); }
  showLockPrompt(show) { this.el.lockPrompt.classList.toggle('hidden', !show); }

  // ---- timer ----
  setTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const d = Math.floor((seconds * 10) % 10);
    this.el.timer.textContent =
      `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`;
  }

  // ---- stats ----
  setHammer(has) {
    this.el.hammer.textContent = has ? 'Ready (E)' : 'None';
    this.el.hammer.classList.toggle('ready', has);
  }
  setFlags(n) { this.el.flagCount.textContent = n; }
  setItems(n) { this.el.items.textContent = n; }

  // ---- active effects chips ----
  // effects: [{ id, label, icon, remaining, total, kind }]
  renderEffects(effects) {
    this.el.effects.innerHTML = '';
    for (const e of effects) {
      const chip = document.createElement('div');
      chip.className = `effect-chip ${e.kind || ''}`;
      chip.innerHTML = `<span>${e.icon}</span><span>${e.label} ${e.remaining.toFixed(1)}s</span>`;
      const bar = document.createElement('div');
      bar.className = 'chip-bar';
      bar.style.width = `${Math.max(0, (e.remaining / e.total) * 100)}%`;
      chip.appendChild(bar);
      this.el.effects.appendChild(chip);
    }
  }

  // ---- compass ----
  setCompass(active, angleRad, remaining) {
    this.el.compass.classList.toggle('hidden', !active);
    if (active) {
      // angleRad: screen-space angle to point the arrow (0 = up)
      this.el.compassArrow.style.transform = `rotate(${angleRad}rad)`;
      this.el.compassTimer.textContent = `Compass: ${remaining.toFixed(1)}s`;
    }
  }

  // ---- toast ----
  toast(text) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    this.toastLayer.appendChild(t);
    setTimeout(() => t.remove(), 2300);
  }

  // ---- victory ----
  showVictory(stats) {
    this.el.victoryStats.innerHTML = `
      <div class="vstat"><span>Escape time</span><span>${stats.time}</span></div>
      <div class="vstat"><span>Items collected</span><span>${stats.items}</span></div>
      <div class="vstat"><span>Walls smashed</span><span>${stats.walls}</span></div>
      <div class="vstat"><span>Flags planted</span><span>${stats.flags}</span></div>
      <div class="vstat"><span>Maze size</span><span>${stats.size}</span></div>
    `;
    this.el.victoryScreen.classList.remove('hidden');
  }
  hideVictory() { this.el.victoryScreen.classList.add('hidden'); }
}
