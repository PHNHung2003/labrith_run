// =============================================================
// main.js — Game bootstrap, loop, state, input, effects
// "Labyrinth Run" — single-player maze escape prototype.
// =============================================================

import * as THREE from 'three';
import { Maze, CELL_SIZE } from './maze.js';
import { Player, VISION_RADIUS } from './player.js';
import { FollowCamera } from './camera.js';
import { ItemManager, ITEM } from './items.js';
import { Minimap } from './minimap.js';
import { UI } from './ui.js';

// ====== Exposed game settings ======
const MAZE_WIDTH  = 25;   // cells in X  (scales smoothly up to 50)
const MAZE_HEIGHT = 25;   // cells in Z
// VISION_RADIUS is exposed from player.js

const COMPASS_DURATION = 5;  // seconds (smart path-guidance window)
const VISION_DURATION  = 10; // seconds

// ====== Engine globals ======
let renderer, scene, camera, clock;
let maze, player, followCam, items, ui, minimap;

// ====== Game state ======
const state = {
  running: false,
  paused: false,
  won: false,
  elapsed: 0,
  itemsCollected: 0,
  wallsSmashed: 0,
  flagsPlaced: 0,
  hasHammer: false,
  effects: { compass: 0, vision: 0 },
  visionActive: false,
};

// ====== Input ======
const input = { forward: false, back: false, left: false, right: false, sprint: false };

// fog presets for the visibility system — lantern-in-a-dungeon falloff:
// clear sight up to ~FOG_NEAR, smooth dimming to FOG_FAR, distant geometry
// survives as faint silhouettes (fog colour is a dark blue, not pure black).
const FOG_NEAR = VISION_RADIUS * 0.85;   // ~15m fully clear
const FOG_FAR  = VISION_RADIUS * 2.4;    // ~43m before it reads as dark
const BG_COLOR = 0x0b0f18;

init();

function init() {
  // ---- renderer ----
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch (err) {
    const l = document.getElementById('loading');
    l.querySelector('p').textContent = 'WebGL is not available in this browser/context.';
    const sp = l.querySelector('.spinner'); if (sp) sp.style.display = 'none';
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  document.getElementById('game-root').appendChild(renderer.domElement);

  // ---- camera ----
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 500);

  clock = new THREE.Clock();
  ui = new UI();

  bindInput();
  window.addEventListener('resize', onResize);

  // build the first maze immediately so the start screen sits over a live scene
  buildWorld();
  ui.hideLoading();

  // start button
  document.getElementById('start-btn').addEventListener('click', startGame);
  document.getElementById('restart-btn').addEventListener('click', () => {
    ui.hideVictory();
    rebuild();
    startGame();
  });

  // Optional debug hook (only active with ?debug in the URL) — used for
  // automated testing of compass/turning. No effect in normal play.
  if (location.search.includes('debug')) {
    window.__game = {
      get state() { return state; },
      get player() { return player; },
      get maze() { return maze; },
      get camera() { return camera; },
      onPickup,
    };
  }

  animate();
}

// ---------------------------------------------------------
// World construction / teardown
// ---------------------------------------------------------
function buildWorld() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(BG_COLOR);
  scene.fog = new THREE.Fog(BG_COLOR, FOG_NEAR, FOG_FAR);

  // Raised ambient so nothing is ever pitch-black — distant walls stay readable
  // as silhouettes; the player's lantern provides the bright near-field.
  scene.add(new THREE.AmbientLight(0x6d7891, 0.55));
  // cool sky / warm-ish ground fill for shape definition
  const hemi = new THREE.HemisphereLight(0x5a6a99, 0x141820, 0.55);
  scene.add(hemi);

  maze = new Maze(MAZE_WIDTH, MAZE_HEIGHT);
  maze.build(scene);

  player = new Player(maze);
  player.addToScene(scene);

  followCam = new FollowCamera(camera, maze);

  items = new ItemManager(maze, scene);
  items.spawnItems({ compass: 3, vision: 2, hammer: 3 });

  // minimap (fog-of-war). CELL_SIZE comes from maze.js.
  minimap = new Minimap(maze, CELL_SIZE);
  minimap.build();
  minimap.setRevealAll(state.visionActive);
}

function rebuild() {
  items.dispose();
  if (minimap) minimap.dispose();
  player.removeFromScene(scene);
  maze.dispose(scene);
  // reset state
  state.elapsed = 0;
  state.itemsCollected = 0;
  state.wallsSmashed = 0;
  state.flagsPlaced = 0;
  state.hasHammer = false;
  state.effects.compass = 0;
  state.effects.vision = 0;
  state.visionActive = false;
  state.won = false;
  buildWorld();
  applyVisibility();
  syncHUD();
}

// ---------------------------------------------------------
// Game flow
// ---------------------------------------------------------
function startGame() {
  ui.hideStart();
  ui.showGameHUD();
  state.running = true;
  state.paused = false;
  state.won = false;
  syncHUD();
}

function winGame() {
  if (state.won) return;
  state.won = true;
  state.running = false;
  ui.toast('🏆 EXIT REACHED');
  ui.showVictory({
    time: formatTime(state.elapsed),
    items: state.itemsCollected,
    walls: state.wallsSmashed,
    flags: state.flagsPlaced,
    size: `${MAZE_WIDTH} × ${MAZE_HEIGHT}`,
  });
}

// ---------------------------------------------------------
// Input handling
// ---------------------------------------------------------
function bindInput() {
  const down = (e) => setKey(e.code, true, e);
  const up   = (e) => setKey(e.code, false, e);
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);

  // The camera is fully automatic — the mouse does NOT control it. The only
  // mouse interaction is clicking the pause overlay to resume.
  document.getElementById('lock-prompt').addEventListener('click', () => {
    state.paused = false;
    ui.showLockPrompt(false);
  });
}

function togglePause() {
  if (!state.running || state.won) return;
  state.paused = !state.paused;
  ui.showLockPrompt(state.paused);
}

function setKey(code, pressed, e) {
  switch (code) {
    case 'KeyW': case 'ArrowUp':    input.forward = pressed; break;
    case 'KeyS': case 'ArrowDown':  input.back = pressed; break;
    case 'KeyA': case 'ArrowLeft':  input.left = pressed; break;
    case 'KeyD': case 'ArrowRight': input.right = pressed; break;
    case 'ShiftLeft': case 'ShiftRight': input.sprint = pressed; break;
    case 'KeyE': if (pressed) useHammer(); break;
    case 'KeyF': if (pressed) placeFlag(); break;
    case 'KeyM': if (pressed) minimap && minimap.toggleExpand(); break;
    case 'KeyP': case 'Escape': if (pressed) togglePause(); break;
    default: return;
  }
  if (['KeyW','KeyS','KeyA','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(code)) {
    e.preventDefault();
  }
}

// ---------------------------------------------------------
// Item actions
// ---------------------------------------------------------
function onPickup(type) {
  if (type === ITEM.HAMMER) {
    if (state.hasHammer) {
      ui.toast('🔨 Already carrying a hammer');
      return false; // refuse — leave it in the world
    }
    state.hasHammer = true;
    ui.toast('🔨 Hammer acquired — press E');
  } else if (type === ITEM.COMPASS) {
    state.effects.compass = COMPASS_DURATION;
    ui.toast('🧭 Compass active');
  } else if (type === ITEM.VISION) {
    state.effects.vision = VISION_DURATION;
    setVision(true);
    ui.toast('💠 Vision Orb — maze revealed');
  }
  state.itemsCollected++;
  syncHUD();
  return true;
}

function useHammer() {
  if (!state.running || !state.hasHammer) return;
  const removed = maze.removeWallInFront(player.position, player.forwardVector);
  if (removed) {
    state.hasHammer = false;
    state.wallsSmashed++;
    if (minimap) minimap.refreshCell();   // reflect the new opening on the map
    ui.toast('💥 Wall smashed!');
    syncHUD();
  } else {
    ui.toast('No wall to smash ahead');
  }
}

function placeFlag() {
  if (!state.running) return;
  state.flagsPlaced = items.placeFlag(player.position);
  ui.toast('🚩 Flag planted');
  syncHUD();
}

// ---------------------------------------------------------
// Visibility system
// ---------------------------------------------------------
function setVision(on) {
  state.visionActive = on;
  applyVisibility();
  if (minimap) minimap.setRevealAll(on);   // orb also clears minimap fog
}

function applyVisibility() {
  if (state.visionActive) {
    // reveal: push fog far away and brighten ambient
    scene.fog.near = 60;
    scene.fog.far = (MAZE_WIDTH + MAZE_HEIGHT) * 4;
    player.light.distance = (MAZE_WIDTH + MAZE_HEIGHT) * 2;
    if (!scene._revealLight) {
      const reveal = new THREE.AmbientLight(0x9fb6d8, 0.8);
      reveal.name = 'revealLight';
      scene._revealLight = reveal;
      scene.add(reveal);
    }
  } else {
    scene.fog.near = FOG_NEAR;
    scene.fog.far = FOG_FAR;
    player.light.distance = VISION_RADIUS * 2.6;
    if (scene._revealLight) {
      scene.remove(scene._revealLight);
      scene._revealLight = null;
    }
  }
}

// ---------------------------------------------------------
// HUD sync
// ---------------------------------------------------------
function syncHUD() {
  ui.setHammer(state.hasHammer);
  ui.setFlags(state.flagsPlaced);
  ui.setItems(state.itemsCollected);
}

function updateEffects(dt) {
  const list = [];
  // compass
  if (state.effects.compass > 0) {
    state.effects.compass = Math.max(0, state.effects.compass - dt);
    list.push({ label: 'Compass', icon: '🧭', remaining: state.effects.compass, total: COMPASS_DURATION, kind: 'compass' });
  }
  // vision
  if (state.effects.vision > 0) {
    state.effects.vision = Math.max(0, state.effects.vision - dt);
    list.push({ label: 'Vision', icon: '💠', remaining: state.effects.vision, total: VISION_DURATION, kind: 'vision' });
    if (state.effects.vision === 0 && state.visionActive) setVision(false);
  }
  ui.renderEffects(list);

  // smart compass arrow: point toward the NEXT correct step on the shortest
  // path (BFS nav field), not the raw exit direction. Recomputed every frame
  // from the player's current cell, so it self-corrects if they stray.
  if (state.effects.compass > 0) {
    const cell = maze.worldToCell(player.position);
    const step = maze.nextStepDir(cell);
    let rel = 0;
    if (step && step.cellCenter) {
      const dx = step.cellCenter.x - player.position.x;
      const dz = step.cellCenter.z - player.position.z;
      const stepAngle = Math.atan2(dx, dz);
      // screen-up = player facing (camera is locked behind), so subtract facing
      rel = stepAngle - player.facing;
    }
    ui.setCompass(true, rel, state.effects.compass);
  } else {
    ui.setCompass(false, 0, 0);
  }
}

// ---------------------------------------------------------
// Win check
// ---------------------------------------------------------
function checkWin() {
  const c = maze.worldToCell(player.position);
  if (c.x === maze.exit.x && c.y === maze.exit.y) winGame();
}

// ---------------------------------------------------------
// Main loop
// ---------------------------------------------------------
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;

  if (state.running && !state.paused) {
    // Gameplay runs regardless of pointer-lock availability (sandbox-safe).
    state.elapsed += dt;
    player.update(dt, input);
    items.update(dt, time, player.position, onPickup);
    updateEffects(dt);
    checkWin();
    ui.setTime(state.elapsed);
  } else if (state.running) {
    // manually paused: keep world idle but still render
    player.update(dt, { forward:false, back:false, left:false, right:false, sprint:false });
  }

  // camera + ambient maze animation always run for a lively backdrop
  maze.update(dt, time);
  followCam.update(dt, player.position, player.facing);

  // minimap: only discover new fog while actively playing
  if (minimap) minimap.update(player, items.flags, state.running && !state.paused);

  renderer.render(scene, camera);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const d = Math.floor((seconds * 10) % 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`;
}
