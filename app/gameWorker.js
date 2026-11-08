// begin code

/**
 * Boulder Dash game worker.
 *
 * It keeps the game state, the clock and the protocol (WORKER-PROTOCOL.md);
 * the model only sends it the controls and draws what comes back.
 *
 * ★ **M3: the cave lives.** The grid is built by `caveGen.js` (M2), the
 * pass over it is `caveScan.js` — ★ $1D8F with every object handler of the
 * original — and the per-frame step of the vertical blank is
 * `caveFrame.js` — ★ $1BB0: the clocks, the birth countdown, the window's
 * scroll, the animation phase. Both are proved against the running program
 * by tools/matchscan.mjs, pass by pass and frame by frame.
 *
 * ★ **M5: the game around the cave** is `caveRules.js` — the original's
 * main loop $28F3: the bonus for the time left, a life lost and the two
 * players taking turns, the next cave and the intermissions, OUT OF TIME,
 * GAME OVER, the covering of the picture, the demo — proved against whole
 * recorded games by tools/matchrules.mjs.
 *
 * ★ The tick is one frame of the PAL machine, 50 Hz (R-039, ZADANI chap. 2).
 * The original's pass runs in its **main loop** and takes several frames —
 * the CPU is slowed by ANTIC's DMA and by a delay loop per row that depends
 * on the difficulty ($1C2F) — so a pass is **not** a whole number of frames
 * and its length depends on what is in the cave. Here the pass runs whole
 * on one frame and the next one is scheduled by a cost model in scanlines
 * measured on thousands of the original's passes (CaveScan.passCost,
 * tools/fitpasscost.mjs, ZADANI chap. 10.6). The busy waits of the main
 * loop after a cave (the bonus count, the delays, OUT OF TIME, the
 * covering) are scheduled the same way (CaveRules.COST, tools/timerules.py).
 * The start of a cave follows the measured phases of $2645: ~11 frames of
 * generation, the uncovering of $18D8 (120 rounds over ~63 frames), the
 * full drawing of $1954 (~14 frames), then the passes.
 */

var query = (typeof self !== 'undefined' && self.location) ? self.location.search : '';
if (typeof importScripts === 'function') {
  importScripts('caveGen.js'+query, 'caveScan.js'+query, 'caveFrame.js'+query, 'caveRules.js'+query);
}

var TICK_MS = 20;                      // ★ 50 Hz PAL, one frame of the reference machine
var LINES_PER_FRAME = 312;             // ★ PAL scanlines a frame (the unit of the pass cost)

// ★ the phases of a cave's start, frames of the PAL machine, measured on the
// original without hooks (tools/tracescan.py, MILNIKY.md M3): $2645 →
// draw_cave 10.2–11.5, $18D8 62.3–63.6, $1954 13.8–14.1
var SETUP_FRAMES = 11;
var UNCOVER_FRAMES = 63;
var UNCOVER_ROUNDS = 120;
var DRAW_FRAMES = 14;
var DRAW_ROWS = 22;
var COVER_ROUNDS = 48;                 // ★ $18B7: rounds of the covering $1870
var DEFAULT_PASS_LINES = 1500;         // the span of the first pass's sounds before its cost is known (~4.8 frames)

var CAVES = ['A', 'E', 'I', 'M'];      // ★ the caves a game may start in (User's Guide)
var CAVE_NUMBERS = {A: 1, E: 5, I: 9, M: 13};   // ★ $07B7 — 1-based, the menu's four ($24CA…)
var CAVE_LETTERS = 'ABCDEFGHIJKLMNOP';
var LEVELS = [1, 2, 3, 4, 5];
var PLAYERS = [1, 2];                  // ★ 1 or 2 players, alternating (User's Guide, `PLYR 1` / `PLYR 2`)

var state = null;
var timer = 0;
var lastTime = false;
var accumulator = 0;

/**
 * The sources of randomness — **injectable from the first line of the
 * project** (../STANDARDS.md), and there are **two** of them, because the
 * original has two (ZADANI chap. 2):
 *
 * - the cave generator (`CaveGen.nextRandom`, ★ $0C01): the cave is
 *   generated from the seed in its header (★ five seeds per cave, one per
 *   difficulty, at $04-$08 of the header, disasm notes §4). It is the
 *   original's own, reproduced bit for bit — it is not random at all, it
 *   is the cave.
 * - `nextRand(site)`: what the original reads from RANDOM ($D20A) while
 *   playing (★ 14 reads, disasm notes §6) — the pushed boulder, the
 *   amoeba's growth, the uncovering, the sounds, Rockford's blinking. Here
 *   a seeded xorshift; the site is the address of the read, which
 *   tools/matchscan.mjs uses to feed the recorded values back in, site by
 *   site, and which is ignored here.
 *
 * `Math.random()` is never used: it cannot be seeded, so a run could not be
 * repeated and a regression would have no fingerprint (../METHODOLOGY.md).
 */
var randState = 1;

function seedRand(seed) {
  randState = (seed >>> 0) || 1;
} // seedRand

function nextRand(site) {
  randState ^= randState << 13; randState >>>= 0;
  randState ^= randState >>> 17;
  randState ^= randState << 5;  randState >>>= 0;
  return randState & 0xFF;
} // nextRand

function reset() {
  clearTimeout(timer);
  timer = 0;
  lastTime = false;
  accumulator = 0;
  seedRand(1);
  state = {
    running: false, paused: false, headless: false,
    frame: 0,
    cave: CAVES[0],
    level: LEVELS[0],
    players: PLAYERS[0],
    joysticks: 1,
    seed: 1,
    hiScore: 0,
    // ★ the 20 caves of the original (data/caves.json), handed over in init
    caves: null,
    // ★ the demo's script $3BC0 (data/demo.json), and whether this is the demo
    demoScript: null,
    demo: false,
    // ★ the game around the cave (CaveRules.newGame): player, lives, score, cave number, saves, game over
    game: null,
    // ★ $07B7: the cave number 1–20; ★ $07B8: the difficulty index 0–4
    caveNumber: 1,
    levelIndex: 0,
    // ★ header $13–$17 → COLOR0–4
    colors: null,
    // the cave itself (caveScan.js): grid, tiles, Rockford, clocks, window
    world: null,
    // the start of the cave: 'setup' → 'uncover' → 'draw' → 'play' → 'bonus' → 'end' → (next cave | 'title')
    phase: 'setup',
    phaseFrame: 0,
    phaseAccumulator: 0,
    // the pass scheduling: scanlines accumulated, and what the next pass costs
    passLines: 0,
    nextPassLines: 0,
    // the end of the cave: the step of cave_end and its line budget (CaveRules.COST)
    end: null,
    // ★ $087A–$087C: the demo's count, index and end flag
    demoCount: 0, demoIndex: 0, demoDone: false,
    tilesChanged: false,
    statusChanged: false,
    statusBChanged: false,
    marginChanged: false,
    coverWrites: [],
    controls: {left: false, right: false, up: false, down: false, fire: false},
    // ★ the writes into POKEY outside the cave (the title's tune, the silence of the menu, the pause): [line, register, value]
    pokey: [],
    // ★ $0872–$0875: the title's tune (CaveRules.titleStart) and its data — the 256 bytes at $2328 and the page of notes $4400
    tune: null, tuneData: null
  };
} // reset

/**
 * ★ STICK: bit 0 up, 1 down, 2 left, 3 right, a pressed direction is 0;
 * STRIG: 0 = pressed. Two opposite directions held make a nibble the
 * original's $1322 matches nothing with — no movement, as on the machine.
 * @returns {Object} {stick, trig}
 */
function inputOf(controls) {
  var stick = 0x0F;
  if (controls.up) stick &= ~1;
  if (controls.down) stick &= ~2;
  if (controls.left) stick &= ~4;
  if (controls.right) stick &= ~8;
  return {stick: stick & 0x0F, trig: controls.fire ? 0 : 1};
} // inputOf

function digitsToNumber(digits) {
  return digits.reduce((n, d) => n*10+d, 0);
} // digitsToNumber

/** ★ $07BF and the saves' high scores are characters (digit + $90) */
function charsToNumber(chars) {
  return chars.reduce((n, c) => n*10+((c-0x90) & 0x0F), 0);
} // charsToNumber

/**
 * The frame the model draws.
 * @returns {Object} The 'frame' message.
 */
function frame() {
  var w = state.world, g = state.game;
  var message = {
    id: 'frame',
    frame: state.frame,
    phase: state.phase,
    tiles: null,
    window: null,
    anim: null,
    status: null,
    panel: {
      cave: state.cave,
      level: state.level,
      caveNumber: state.caveNumber,
      levelIndex: state.levelIndex,
      colors: state.colors,
      players: state.players,
      player: g ? g.player+1 : 1,
      lives: w ? w.lives : (g ? g.lives : 3),
      score: g ? digitsToNumber(g.saves[0].score) : 0,
      score2: g ? digitsToNumber(g.saves[1].score) : 0,
      hiScore: state.hiScore,
      time: w ? digitsToNumber(w.time) : 0,
      collected: w ? digitsToNumber(w.collected) : 0,
      needed: w ? digitsToNumber(w.needed) : 0,
      caveOver: w ? w.caveOver : 0,
      gameOver: g ? g.gameOver : 0,
      demo: state.demo
    },
    controls: state.controls
  };
  // ★ what went into POKEY this frame, in order: the vertical blank's, the pass's (spread over the frames it takes), the title's
  var writes = state.pokey.splice(0, state.pokey.length);
  if (w && w.pokey.length) {
    writes = writes.concat(w.pokey.splice(0, w.pokey.length));
  }
  if (writes.length) {
    message.pokey = writes;
  }
  if (g) {
    // the current player's score is the live one; the other player's is his block
    message.panel[g.player ? 'score2' : 'score'] = digitsToNumber(g.score);
    message.panel.hiScore = Math.max(state.hiScore, charsToNumber(g.high), charsToNumber(g.saves[0].high), charsToNumber(g.saves[1].high));
  }
  if (w) {
    if (state.tilesChanged) {
      message.tiles = w.tiles.slice();       // a copy: the state keeps changing
      state.tilesChanged = false;
    }
    if (state.marginChanged || message.tiles) {
      message.margin = w.margin;
      message.marginTop = w.marginTop.slice();
      state.marginChanged = false;
    }
    if (state.coverWrites.length) {
      message.cover = state.coverWrites;     // ★ $1870: the characters that got the cover glyph this frame
      state.coverWrites = [];
    }
    // ★ what the vertical blank decides every frame: the window, the glyphs, the background
    message.window = {x: w.scroll.x, y: w.scroll.y, hscrol: w.hscrol, vscrol: w.vscrol};
    message.anim = {phase: w.animPhase, moving: w.stick != 0x0F, facing: w.facing, blink: w.animBlink, tap: w.animTap,
                    magicWallFrame: w.magicWallFrame === undefined ? -1 : w.magicWallFrame,
                    coverRotation: w.coverRotation, flickerRows: w.flickerRows || null};
    message.bkLum = w.bkLum || 0;
    if (state.statusChanged) {
      message.status = {inGame: w.statusInGame, text: w.statusText || null, bytes: w.status.slice()};
      state.statusChanged = false;
    }
    if (state.statusBChanged && g) {
      message.statusB = g.statusB.slice();   // ★ $081F: the line before birth, as the game keeps it
      state.statusBChanged = false;
    }
  }
  return message;
} // frame

/**
 * ★ $2645: the cave out of the table — header, random fill, steel frame,
 * drawing instructions (caveGen.js) — and the state of its start
 * (CaveScan.create, carrying the previous cave's window and clocks). The
 * screen is still covered; the start's phases run in tick().
 */
function buildCave() {
  var g = state.game;
  state.caveNumber = g.caveNumber;
  state.levelIndex = g.levelIndex;
  state.cave = CAVE_LETTERS[(state.caveNumber-1) & 15] || 'A';
  state.level = state.levelIndex+1;
  var previous = state.world;
  state.world = null;
  state.colors = null;
  if (!state.caves || !state.caves[state.caveNumber-1] || typeof CaveGen === 'undefined' || typeof CaveScan === 'undefined') {
    return;
  }
  var cave = state.caves[state.caveNumber-1];
  var raw = CaveGen.bytesOf(cave.raw);
  var made = CaveGen.generate(raw, state.levelIndex);
  var options = CaveRules.caveOptions(g);
  options.previous = previous;
  state.world = CaveScan.create(made, raw, state.levelIndex, options);
  CaveRules.attach(g, state.world);
  state.colors = cave.header.colors.slice();
  state.phase = 'setup';
  state.phaseFrame = 0;
  state.phaseAccumulator = 0;
  state.passLines = 0;
  state.nextPassLines = 0;
  state.end = null;
  state.tilesChanged = true;
  state.statusChanged = true;
  state.statusBChanged = true;
  state.marginChanged = true;
} // buildCave

/** ★ $2896 demo_play: the demo's variables at the start of the cave */
function startDemo() {
  state.demoIndex = 0;
  state.demoCount = 0;
  state.demoDone = false;
} // startDemo

/**
 * ★ $28A1: one step of the demo's script before a pass — a new byte when
 * the count ran out (stick 0 ends the demo), the trigger ends it too.
 * @returns {boolean} True when a pass follows.
 */
function demoStep() {
  var w = state.world;
  if (state.demoCount == 0) {
    var byte = state.demoScript && state.demoIndex < state.demoScript.length ? state.demoScript[state.demoIndex] : 0;
    w.stick = byte & 0x0F;
    if (w.stick == 0) {
      state.demoDone = true;
    }
    state.demoCount = byte >> 4;
    state.demoIndex++;
  }
  if (state.controls.fire) {                 // ★ $28CA: STRIG0
    state.demoDone = true;
  }
  return !state.demoDone;
} // demoStep

/**
 * ★ $288C (or $28E2 after the demo): the cave is over — the sound off,
 * cave_end_vars (the bonus count, a life lost or the next cave) and then
 * cave_end. The bonus runs over frames ('bonus'); the rest is the 'end'
 * phase with its steps.
 */
function endCave() {
  var w = state.world, g = state.game;
  w.pokeyLine = w.passLine+w.passSpan;         // ★ $1C3D silence, right after the last pass
  CaveScan.silence(w);
  if (state.demo && !w.exitReached) {
    // ★ $28E5: the demo without the exit skips cave_end_vars (no pause either)
    afterEndVars();
    return;
  }
  var what = CaveRules.caveEndVars(g, w);
  if (what == 'bonus') {
    state.phase = 'bonus';
    state.end = {lines: CaveRules.COST.bonusIteration, delayLines: 0};   // the first second is counted at once
    bonusFrame(0);
  } else {
    afterEndVars();
  }
  state.statusChanged = true;
  state.statusBChanged = true;
} // endCave

/** ★ $27F1: the bonus's seconds this frame, by the measured cost; then the delay $1C55 */
function bonusFrame(lines) {
  var w = state.world, g = state.game, e = state.end, cost = CaveRules.COST;
  if (w.caveOver == 0) {
    e.lines += lines;
    var at = LINES_PER_FRAME-e.lines;          // the line the pending iteration started at (before this frame when negative)
    while (w.caveOver == 0 && e.lines >= cost.bonusIteration) {
      e.lines -= cost.bonusIteration;
      w.pokeyLine = at; w.passSpan = cost.bonusIteration;   // ★ $2746: the sweep over the iteration's span
      CaveRules.bonusStep(g, w);
      at += cost.bonusIteration;
      state.statusChanged = true;
    }
    if (w.caveOver) {
      e.delayLines = 4*cost.delay+e.lines;   // ★ $2808 L1C55, four delays
    }
    return;
  }
  e.delayLines -= lines;
  if (e.delayLines <= 0) {
    CaveRules.bonusDone(g, w);
    state.statusBChanged = true;
    afterEndVars();
  }
} // bonusFrame

/** ★ $2892 L1598: cave_end waits for the flicker of a bonus life to end */
function afterEndVars() {
  state.phase = 'end';
  state.end = {step: 'flicker', lines: 0, blinks: 0, wait: 0};
  if (state.demo) {
    state.game.caveNumber = 0;                 // ★ $28ED: after the demo the title comes
  }
} // afterEndVars

/**
 * ★ $2012 cave_end, over frames: OUT OF TIME blinking (20 times or until
 * the trigger), GAME OVER or the next cave's status (a BONUS LIFE on
 * entering an intermission), the cover glyph up and the random covering
 * ($1870, 48 rounds), everything covered ($1852), the delay after GAME
 * OVER; then the next cave or the title.
 */
function endFrame() {
  var w = state.world, g = state.game, e = state.end, cost = CaveRules.COST;
  var fire = state.controls.fire;
  switch (e.step) {

    case 'flicker':
      if (w.flicker) {
        return;
      }
      if (CaveRules.outOfTime(w)) {
        e.step = 'outOfTime'; e.blinks = CaveRules.OUT_OF_TIME_BLINKS; e.wait = 0; e.lines = 0;
        w.statusText = 'outOfTime'; state.statusChanged = true;      // ★ $1FB8: LMS → $0AC0
        return;
      }
      e.step = 'status';
      return;

    case 'outOfTime':
      // ★ $1FAC: on for one wait, off for three, twenty times; the trigger cuts every wait short
      w.trig = fire ? 0 : 1;                                              // ★ $1F97: wait_trig keeps the trigger in $0843
      if (fire) {
        w.statusText = null; state.statusChanged = true;
        CaveRules.outOfTimeDone(w);
        e.step = 'status';
        return;
      }
      e.lines += LINES_PER_FRAME;
      while (e.lines >= cost.waitTrig) {
        e.lines -= cost.waitTrig;
        if (e.wait == 0) {
          w.statusText = null; state.statusChanged = true;          // ★ $1FC5: the LMS back
        }
        e.wait++;
        if (e.wait == 4) {
          e.wait = 0;
          if (--e.blinks == 0) {
            CaveRules.outOfTimeDone(w);
            e.step = 'status';
            return;
          }
          w.statusText = 'outOfTime'; state.statusChanged = true;
        }
      }
      return;

    case 'status':
      // ★ $201D: GAME OVER, or the next cave's status line — then the cover goes up
      CaveRules.nextStatus(g, w);
      state.statusChanged = true;
      w.cover = 1;                                                    // ★ $2032
      w.pokeyLine = 0; CaveScan.silence(w);                           // ★ $2035
      e.step = g.gameOver ? 'gameOverDelay' : 'cover';
      e.lines = g.gameOver ? 4*cost.delay : 0;
      return;

    case 'gameOverDelay':
      // ★ $1F71: GAME OVER stays for four delays before the covering
      e.lines -= LINES_PER_FRAME;
      if (e.lines <= 0) {
        e.step = 'cover'; e.lines = 0;
      }
      return;

    case 'cover':
      // ★ $1870: rounds of the random covering as the line budget allows
      e.lines += LINES_PER_FRAME;
      while (e.lines > 0 && w.coverRounds < COVER_ROUNDS) {
        var round = CaveRules.coverRound(w, nextRand);
        state.coverWrites = state.coverWrites.concat(round.writes);
        e.lines -= cost.coverRound+cost.coverRead*round.reads;
        state.marginChanged = true;
      }
      if (w.coverRounds >= COVER_ROUNDS) {
        CaveRules.coverCave(w);                                       // ★ $1852
        state.tilesChanged = true;
        if (g.gameOver) {
          e.step = 'finalDelay'; e.lines = 4*cost.delay;              // ★ $2043
        } else {
          e.step = 'next';
        }
      }
      return;

    case 'finalDelay':
      e.lines -= LINES_PER_FRAME;
      if (e.lines <= 0) {
        e.step = 'next';
      }
      return;

    case 'next':
      // ★ $2918 → main_loop: cave 0 is the title, else the next cave is set up
      if (g.caveNumber == 0) {
        state.phase = 'title';
        state.end = null;
        state.tune = CaveRules.titleStart(state.pokey);               // ★ $2608: the title's tune starts
        // the scores: after GAME OVER the blocks hold both players' (life_lost saved them), after the demo the live one is player 1's
        postMessage({id: 'gameOver', demo: state.demo, gameOver: g.gameOver,
                     score: digitsToNumber(g.gameOver ? g.saves[0].score : g.score), score2: digitsToNumber(g.saves[1].score),
                     hiScore: Math.max(state.hiScore, charsToNumber(g.saves[0].high), charsToNumber(g.saves[1].high))});
        return;
      }
      buildCave();
      return;
  }
} // endFrame

/**
 * One frame of the machine — one tick: the vertical blank's step, then the
 * phase of the cave's start, then the pass when its time has come.
 */
function tick() {
  state.frame++;
  var w = state.world, g = state.game;
  if (state.phase == 'title' && state.tune && state.tuneData) {
    // ★ $2446: the title's tune from the vertical blank; ★ $23FD: played twice with the
    // demo flag ($07AB, set by menu_start for the whole title) it starts the demo
    if (CaveRules.titleStep(state.tune, state.tuneData.notes, state.tuneData.page, state.pokey, state.demo)) {
      postMessage(frame());
      postMessage({id: 'demo', frame: state.frame});
      state.running = false;
      clearTimeout(timer);
      return;
    }
  }
  if (w && typeof CaveFrame !== 'undefined' && state.phase != 'title') {
    var statusBefore = w.statusInGame, textBefore = w.statusText, timeBefore = w.status.join();
    // ★ the vertical blank runs from the moment the menu started the cave,
    // the generation included (the window already scrolls toward Rockford)
    CaveFrame.step(w, nextRand);
    if (w.statusInGame != statusBefore || w.statusText != textBefore || w.status.join() != timeBefore) {
      state.statusChanged = true;
    }
    switch (state.phase) {

      case 'setup':
        if (++state.phaseFrame >= SETUP_FRAMES) {
          state.phase = 'uncover';
          CaveScan.startVars(w, {birth: CaveRules.caveOptions(g).birth});   // ★ $1E7D cave_start_vars at the end of the generation
          state.statusChanged = true;
        }
        break;

      case 'uncover':
        // ★ $18D8: 120 rounds of 22 random cells over the measured 63 frames (integer accumulator: exact)
        state.phaseAccumulator += UNCOVER_ROUNDS;
        while (state.phaseAccumulator >= UNCOVER_FRAMES && w.uncoverRound < UNCOVER_ROUNDS) {
          for (var i = 0; i < DRAW_ROWS; i++) {
            CaveScan.uncoverCell(w, nextRand);
          }
          state.phaseAccumulator -= UNCOVER_FRAMES;
        }
        state.tilesChanged = true;
        if (w.uncoverRound >= UNCOVER_ROUNDS) {
          state.phase = 'draw';
          state.phaseAccumulator = 0;
        }
        break;

      case 'draw':
        // ★ $1954: the full drawing, row by row, over the measured 14 frames
        state.phaseAccumulator += DRAW_ROWS;
        while (state.phaseAccumulator >= DRAW_FRAMES && CaveScan.drawRow(w)) {
          state.phaseAccumulator -= DRAW_FRAMES;
        }
        state.tilesChanged = true;
        if (w.drawRow >= DRAW_ROWS) {
          state.phase = 'play';
          state.marginChanged = true;          // ★ $18BF
          w.cover = 0;                         // ★ $2676
          w.pokeyLine = 0;
          CaveScan.silence(w);                 // ★ $2679
          CaveScan.setupSound(w);              // ★ $267C
          state.passLines = 0;
          state.nextPassLines = 0;
          if (state.demo) {
            startDemo();
          }
        }
        break;

      case 'play':
        // ★ $2884: pass after pass until the cave is over; the next pass
        // starts when the last one's measured cost in scanlines has run out.
        // ★ $2896: the demo takes its stick from the script and runs it to
        // the end, whether the cave is over or not
        state.passLines += LINES_PER_FRAME;
        if (state.passLines >= state.nextPassLines) {
          state.passLines -= state.nextPassLines;
          if (state.demo && !demoStep()) {
            endCave();
            break;
          }
          // the pass's writes into POKEY are spread over the frames the pass
          // takes in the original: from the line it started at over its cost
          // — estimated by the previous pass's while it runs, rescaled after
          w.passLine = LINES_PER_FRAME-state.passLines;
          w.passSpan = state.nextPassLines || DEFAULT_PASS_LINES;
          var first = w.pokey.length;
          var counts = CaveScan.pass(w, inputOf(state.controls), nextRand);
          var estimate = w.passSpan;
          state.nextPassLines = CaveScan.passCost(counts, state.levelIndex);
          w.passSpan = state.nextPassLines;
          for (var i = first; i < w.pokey.length; i++) {
            w.pokey[i][0] = w.passLine+(w.pokey[i][0]-w.passLine)*w.passSpan/estimate;
          }
          state.tilesChanged = true;
          state.statusChanged = true;
          if (state.demo) {
            state.demoCount = (state.demoCount-1) & 0xFF;   // ★ $28DC
          } else if (w.caveOver) {
            endCave();
          }
        }
        break;

      case 'bonus':
        bonusFrame(LINES_PER_FRAME);
        break;

      case 'end':
        endFrame();
        break;
    }
  }
  postMessage(frame());
} // tick

function schedule() {
  if (!state.running || state.paused || state.headless) {
    return;
  }
  timer = setTimeout(() => {
    var now = Date.now();
    if (lastTime === false) {
      lastTime = now;
    }
    accumulator += now - lastTime;
    lastTime = now;
    // catch up rather than drift, but never run away with it after a stall
    var steps = Math.min(Math.floor(accumulator/TICK_MS), 4);
    accumulator -= steps*TICK_MS;
    for (var step = 0; step < steps; step++) {
      tick();
    }
    schedule();
  }, TICK_MS);
} // schedule

onmessage = function(event) {
  var message = event.data;
  switch (message.id) {

    case 'init':
      reset();
      var initData = message.initData || {};
      state.headless = !!initData.headless;
      state.hiScore = initData.hiScore || 0;
      state.seed = initData.seed || 1;
      state.demo = !!initData.demo;
      if (CAVES.indexOf(initData.cave) >= 0) {
        state.cave = initData.cave;
      }
      if (LEVELS.indexOf(initData.level) >= 0) {
        state.level = initData.level;
      }
      // ★ on difficulty levels 4 and 5 the game starts in cave A (User's Guide)
      if (state.level >= 4) {
        state.cave = CAVES[0];
      }
      if (PLAYERS.indexOf(initData.players) >= 0) {
        state.players = initData.players;
      }
      state.joysticks = initData.joysticks == 2 ? 2 : 1;
      if (Array.isArray(initData.caves)) {
        state.caves = initData.caves;
      }
      if (Array.isArray(initData.demoScript)) {
        state.demoScript = initData.demoScript;
      }
      if (initData.tune && initData.tune.notes && initData.tune.page) {
        state.tuneData = {notes: initData.tune.notes, page: initData.tune.page};
      }
      seedRand(state.seed);
      // ★ $2680 new_game with the menu's choices; ★ $2583: the demo is cave A on the first difficulty
      state.game = CaveRules.newGame({caveNumber: CAVE_NUMBERS[state.cave], levelIndex: state.level-1,
                                      twoPlayers: state.players == 2, twoJoysticks: state.joysticks == 2, demo: state.demo});
      buildCave();
      // ★ $257B: the menu's start silences the chip before the first cave
      for (var r = 0; r <= 8; r++) {
        state.pokey.push([0, r, 0]);
      }
      state.running = true;
      postMessage(frame());
      schedule();
      break;

    case 'title':
      // ★ $25C3 → $2608: the title from power-on or after GAME OVER — no cave, the tune from
      // its start, the demo flag up (menu_start $2566); the model draws the picture itself
      reset();
      var titleData = message.initData || {};
      state.headless = !!titleData.headless;
      state.hiScore = titleData.hiScore || 0;
      if (titleData.tune && titleData.tune.notes && titleData.tune.page) {
        state.tuneData = {notes: titleData.tune.notes, page: titleData.tune.page};
      }
      state.demo = true;
      state.phase = 'title';
      state.tune = CaveRules.titleStart(state.pokey);
      state.running = true;
      postMessage(frame());
      schedule();
      break;

    case 'controls':
      Object.keys(state.controls).forEach((key) => {
        if (key in message) {
          state.controls[key] = !!message[key];
        }
      });
      break;

    case 'pause':
      state.paused = true;
      clearTimeout(timer);
      lastTime = false;
      // ★ $1CDE: the pause silences the chip (one more frame carries the writes)
      if (state.running) {
        for (var q = 0; q <= 8; q++) {
          state.pokey.push([0, q, 0]);
        }
        postMessage(frame());
      }
      break;

    case 'continue':
      state.paused = false;
      lastTime = false;
      accumulator = 0;
      schedule();
      break;

    case 'tick':
      if (state.headless) {
        tick();
      }
      break;

    case 'reset':
      reset();
      break;

  } // switch
}; // onmessage

reset();
