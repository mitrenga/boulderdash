// begin code

/**
 * The scan of the cave — one pass over the grid, ★ $1D8F of the original,
 * with every object handler read out of its code (sources/asm/main.asm,
 * sources/docs/disasm_notes.md §13) and proved pass by pass against the
 * running program by tools/matchscan.mjs. A classic script: the worker takes
 * it with importScripts(), the tools through app/svision/tools/classicScript.cjs
 * (no import/export here, R-001).
 *
 * ★ How the original does it. The pass runs in the **main loop**, not in the
 * vertical blank: rows 3..23 of the 40 × 24 grid ($4C00), left to right, top
 * to bottom, with a delay loop per row that depends on the difficulty
 * ($1C2F, $1C2A: 20/10/5/2/0). Every cell is dispatched through the table
 * $3C80 (JMP ($0086)); after a cell is handled, the cell one row up and one
 * column left is stripped of its "scanned" flag through the table $3C00.
 * An object that moves down or right writes its scanned code into the target
 * cell (boulder $13, diamond $17, creature +4, Rockford $39, amoeba $3B), so
 * it is not handled again in the same pass; the flag comes off as the scan
 * passes below it.
 *
 * The grid holds the object codes of the original ($4C00): 00 space, 01
 * dirt, 02 wall, 03 magic wall, 04 closed exit, 05 open exit, 07 steel,
 * 08–0B firefly (direction), 0C–0F firefly scanned, 10 boulder, 11 boulder
 * scanned, 12 boulder falling, 13 falling scanned, 14–17 diamond alike,
 * 1B–1F explosion to space, 20–24 explosion to diamond, 25 inbox, 26–28
 * Rockford being born, 30–33 butterfly, 34–37 butterfly scanned, 38
 * Rockford, 39 Rockford scanned, 3A amoeba, 3B amoeba scanned.
 *
 * `tiles` is what the original drew ($0BDC store_draw_cell draws while it
 * stores; $140D draws the closed-exit tile without storing) — the object
 * code whose tile stands in the picture, or COVERED where the cover glyph
 * still stands. The model draws from it.
 *
 * Randomness: every read of RANDOM ($D20A) goes through `rand(site)` with
 * the site's address as the name, so the match tool can feed back what the
 * original read at that site (sources/docs/disasm_notes.md §6). The order of
 * the reads inside a pass is the original's.
 */
class CaveScan {

  static get W() { return 40; }
  static get ROWS() { return 24; }
  /** what `tiles` holds where the cover glyph $7C still stands ($1852) */
  static get COVERED() { return 0xFF; }

  /**
   * ★ Offsets from the cell pointer $80 (the cell itself is $29 = +41): the
   * eight neighbours, two cells left/right (pushing) and two rows down
   * (magic wall, explosion below). All of them are in the screen offset
   * table $0B79, which is why nothing else is ever used.
   */
  static get O() {
    return {UL: 0x00, U: 0x01, UR: 0x02, L2: 0x27, L: 0x28, S: 0x29, R: 0x2A, R2: 0x2B,
            DL: 0x50, D: 0x51, DR: 0x52, D2L: 0x78, D2: 0x79, D2R: 0x7A};
  } // O

  /** ★ $3C00: scanned code → unscanned code (0 = leave it) */
  static get UNFLAG() {
    return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x08, 0x09, 0x0A, 0x0B,
            0, 0x10, 0, 0x12, 0, 0x14, 0, 0x16, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0x30, 0x31, 0x32, 0x33, 0, 0x38, 0, 0x3A, 0, 0, 0, 0];
  } // UNFLAG

  /** ★ $1398: explosion frame → next frame (the last ones become space / diamond) */
  static get EXPLOSION_NEXT() {
    return {0x1F: 0x00, 0x1E: 0x1F, 0x1D: 0x1E, 0x1C: 0x1D, 0x1B: 0x1C,
            0x24: 0x14, 0x23: 0x24, 0x22: 0x23, 0x21: 0x22, 0x20: 0x21};
  } // EXPLOSION_NEXT

  /** ★ $13AC: birth frame → next frame; the inbox becomes Rockford in four passes */
  static get BIRTH_NEXT() {
    return {0x28: 0x38, 0x27: 0x28, 0x26: 0x27, 0x25: 0x26};
  } // BIRTH_NEXT

  /** ★ $0CE5 / $0CE9: the two cells a creature looks at, by direction 0–3 */
  static get CREATURE_A() { return [0x28, 0x01, 0x2A, 0x51]; }
  static get CREATURE_B() { return [0x51, 0x28, 0x01, 0x2A]; }

  /** ★ $1C2A: the delay loop count per row, by difficulty */
  static get ROW_DELAY() { return [20, 10, 5, 2, 0]; }

  /**
   * ★ The state of a cave at the start of $2645, before its generation: what
   * the init and the menu leave (the window, the animation) and zeros where
   * cave_start_vars ($1E7D, `startVars`) has not run yet — the caller calls
   * it at the end of the generation (gameWorker.js 'setup').
   * @param {Object} made - What CaveGen.generate returned (grid, rockford).
   * @param {Uint8Array} raw - The cave's bytes (header + instructions).
   * @param {number} level - Difficulty index 0–4.
   * ★ Between two caves nothing but what $2645 writes is reset: the window,
   * the animation, the blink counter $0844, the cover glyph's rotation, the
   * flicker of a bonus life, the pause flag, the tick counter and the
   * status line all carry over from the previous cave (`options.previous`,
   * M5); the first cave of a session starts from the zeros of the boot.
   * @param {Object} [options] - {intermission, demo, stick, lives, scroll, animPhase, margin, previous}.
   * @returns {Object} The cave state.
   */
  static create(made, raw, level, options) {
    options = options || {};
    var p = options.previous || null;
    var s = {
      grid: Uint8Array.from(made.grid),
      tiles: new Uint8Array(CaveScan.W*CaveScan.ROWS).fill(CaveScan.COVERED),
      raw: raw, level: level,
      intermission: !!options.intermission,      // ★ $07AF
      demo: !!options.demo,                      // ★ $07AB
      // ★ $079E/$079F, $079D, $0788 (0 after boot), $0843 (0: the cave was started by fire), $0842, $0844
      rockfordX: made.rockford.x, rockfordY: made.rockford.y, facing: 0, stick: options.stick || 0, trig: 0, moved: 0, blink: 0,
      // ★ $0793, $0792, $0794, $0795, $07A8, $07A4 — zero until cave_start_vars (startVars) at the end of the generation
      birth: 0, beforeBirth: 0, noRockford: 0, caveOver: 0, exitReached: 0, paused: 0,
      // ★ $078A–$078D
      magicWall: 0, magicWallSec: 0, magicWallTime: 0, diamondsEnough: 0,
      // ★ $078E, $078F, $0789 (1 = not enclosed), $07A1, $07A2, $07A3
      amoebaGrow: 0, amoebaGrewLast: 0, amoebaEnclosed: 1, amoebaMask: 0x7F, amoebaCount: 0, amoebaCountLast: 0,
      explosion: 0,                              // ★ $0780
      // ★ $0836–$0838 (3 decimal digits), $083A, $0839
      time: CaveScan.digits(raw[0x0E+level], 3), secondsGone: 0, tick: 0,
      // ★ $083B/$083C, $083D/$083E, $07B3–$07B5, $083F–$0841, $07B9–$07BE
      collected: [0, 0], needed: CaveScan.digits(raw[0x09+level], 3).slice(1),
      diamondValue: CaveScan.digits(raw[0x02], 3), extraValue: CaveScan.digits(raw[0x03], 3),
      score: [0, 0, 0, 0, 0, 0], scoreOld: [0, 0],   // ★ $0834/$0835
      lives: options.lives || 3, flicker: 0, flash: 0,   // ★ $07B6, $0833, $07AE
      // ★ $0845–$0852: the window — position (chars, lo/hi), velocity, this frame's step
      scroll: options.scroll || {xLo: 0, x: 0, yLo: 0, y: 0, vxLo: 0, vx: 0, vyLo: 0, vy: 0, dx: 0, dy: 0},
      hscrol: 3, vscrol: 0,
      // ★ $085E, $085C, $085B, $085A; $0859 and the rotation of the cover glyph
      animToggle: 0, animPhase: options.animPhase || 0, animBlink: 0, animTap: 0, cover: 1, coverRotation: 0,
      // ★ $0796–$079C, $0799, $085D: the sound variables — channel 1 (distortion a, volume b, pitch c),
      // channel 4 (d, e, f), the envelope of channel 2 and the counter of the envelope step (M6)
      sound: {a: 0, b: 0, c: 0, envelope: 0x40, d: 0, e: 0, f: 0, counter: 0},
      // ★ the writes into POKEY since the last frame message: [line, register, value] (WORKER-PROTOCOL.md, M6);
      // `pokeyLine` is where a write lands (0 = the frame's start), `passLine`/`passSpan` place the pass's writes
      pokey: [], pokeyLine: 0, passLine: 0, passSpan: 0,
      // ★ $080B: the status line in the game, and which buffer the display list shows ($5EA4):
      // a text of the cave's end ('gameOver' / 'outOfTime' / 'bonusLife', M5) or one of the two buffers
      status: new Uint8Array(20), statusInGame: false, statusText: null,
      // counts for the pass cost model (tools/tracescan.py, MILNIKY.md M3)
      counts: null,
      // the uncovering ($18D8): round 0..119, row 0..21
      uncoverRound: 0, uncoverRow: 0, drawRow: 0,
      // ★ $18BF: the margin byte — 0 until the first full drawing (boot zeros), then $4A;
      // the three bytes $5000–$5002 one by one, because the covering $1870 can overwrite them (M5)
      margin: options.margin || 0, marginTop: null,
      // ★ $1870: which characters of the picture hold the cover glyph (offset from $5000), the rounds done ($0790),
      // the row of the window in the round and the misses in it ($0856)
      covered: new Uint8Array(0x1000), coverRounds: 0, coverRow: 0, coverMisses: 0,
      // ★ $0865: the cave's time of the header — OUT OF TIME is only for the seconds gone reaching it (M5)
      caveTime: raw[0x0E+level]
    };
    s.marginTop = [s.margin, s.margin, s.margin];
    if (p) {
      // ★ what $2645 leaves alone: the vertical blank's state and the game's
      ['facing', 'stick', 'trig', 'moved', 'blink', 'lives', 'flicker', 'flickerRows', 'flash', 'paused', 'tick', 'cover', 'coverRotation',
       'animToggle', 'animPhase', 'animBlink', 'animTap', 'hscrol', 'vscrol', 'statusInGame', 'statusText', 'margin', 'bkLum',
       'time', 'secondsGone', 'collected', 'needed', 'diamondValue', 'extraValue', 'score', 'scoreOld', 'sound', 'status',
       'birth', 'beforeBirth', 'noRockford', 'caveOver', 'exitReached', 'magicWall', 'magicWallSec', 'magicWallTime', 'magicWallFrame', 'diamondsEnough',
       'amoebaGrow', 'amoebaGrewLast', 'amoebaEnclosed', 'amoebaMask', 'amoebaCount', 'amoebaCountLast', 'explosion', 'caveTime'].forEach((key) => {
        if (key in p) s[key] = p[key];
      });
      s.scroll = Object.assign({}, p.scroll);
      s.marginTop = p.marginTop.slice();
      s.covered = p.covered;                                     // the cover glyphs of the previous cave's end still stand
      s.coverRounds = 0; s.coverRow = 0; s.coverMisses = 0;
    }
    s.scroll.vxLo = 0; s.scroll.vx = 0; s.scroll.vyLo = 0; s.scroll.vy = 0;   // ★ $2654
    if (!p) {
      // ★ $2925 / $2943 — the score ($107C) appears after the first pass
      s.status[3] = 0xBC;
      CaveScan.statusNeeded(s); CaveScan.statusValue(s); CaveScan.statusCollected(s); CaveScan.statusTime(s);
    }
    return s;
  } // create

  /**
   * ★ $1E7D cave_start_vars: the variables of the cave's start, set at the
   * end of the generation ($2645 → $2671), **not** at its beginning — until
   * then $0793 is 0 and an intermission does not scroll (M4). On the
   * machine the routine's four decimal conversions ($1DDF) spread it over
   * 2–3 frames; here it is one call.
   * @param {Object} s - The cave state.
   * @param {Object} [options] - {birth}: 6 for the second player with one joystick (M5), else 4.
   */
  static startVars(s, options) {
    CaveScan.startVarsZero(s);
    CaveScan.startVarsTime(s);
    CaveScan.startVarsRest(s, options);
  } // startVars

  /** ★ $1E7D–$1EA6: the first part — the zeros and the magic wall's glyph (one frame; a tool can call the parts apart) */
  static startVarsZero(s) {
    s.amoebaGrow = 0; s.amoebaGrewLast = 0; s.noRockford = 0; s.caveOver = 0;
    s.magicWall = 0; s.magicWallSec = 0; s.magicWallTime = 0; s.diamondsEnough = 0;
    s.amoebaCount = 0; s.secondsGone = 0; s.tick = 0; s.exitReached = 0; s.paused = 0;
    s.magicWallFrame = -1;                                     // ★ $1AFD magic_wall_glyph_off
  } // startVarsZero

  /** ★ $1EA9–$1ECB: the second part — the cave's time, converted to digits (a frame), and its status line */
  static startVarsTime(s) {
    var raw = s.raw, level = s.level;
    s.caveTime = raw[0x0E+level];                                                    // ★ $1EB2: $0865
    s.time = CaveScan.digits(raw[0x0E+level], 3); CaveScan.statusTime(s);            // ★ $1EB2 / $10E7
  } // startVarsTime

  /** ★ $1ECE–$1F56: the rest — the other conversions, the status line, the birth countdown, the amoeba's mask */
  static startVarsRest(s, options) {
    options = options || {};
    var raw = s.raw, level = s.level;
    s.needed = CaveScan.digits(raw[0x09+level], 3).slice(1); CaveScan.statusNeeded(s);   // ★ $1ED1 / $1176
    s.diamondValue = CaveScan.digits(raw[0x02], 3);                                  // ★ $1EEA
    s.extraValue = CaveScan.digits(raw[0x03], 3); CaveScan.statusValue(s);           // ★ $1F00 / $1187
    s.collected = [0, 0]; CaveScan.statusCollected(s);                               // ★ $1F1B / $1165
    s.amoebaEnclosed = 1; s.beforeBirth = 1;                                         // ★ $1F28
    s.birth = options.birth || 4;                                                    // ★ $1F30 / $1F44
    s.amoebaMask = 0x7F;                                                             // ★ $1F51
  } // startVarsRest

  /**
   * ★ $1DDF: a binary value as decimal digits (repeated decimal increment,
   * so 1000 wraps to 000 like the original).
   * @param {number} value - 0–255.
   * @param {number} count - Digits.
   * @returns {Array} The digits, most significant first.
   */
  static digits(value, count) {
    var d = [];
    for (var i = 0; i < count; i++) d.push(0);
    for (var n = 0; n < value; n++) {
      CaveScan.addDigits(d, d.map((x, i) => i == count-1 ? 1 : 0));
    }
    return d;
  } // digits

  /**
   * ★ $10CE / $1057 / $114F: decimal add with the carry chain of the
   * original (CMP #10; SBC #10 leaves the carry for the next digit).
   * @param {Array} digits - Most significant first; changed in place.
   * @param {Array} add - Same length.
   */
  static addDigits(digits, add) {
    var carry = 0;
    for (var i = digits.length-1; i >= 0; i--) {
      var v = digits[i]+add[i]+carry;
      carry = v >= 10 ? 1 : 0;
      digits[i] = carry ? v-10 : v;
    }
  } // addDigits

  // --- POKEY ($D200–$D208) -----------------------------------------------

  /**
   * ★ One write into POKEY: register 0–8 (AUDF1, AUDC1 … AUDF4, AUDC4,
   * AUDCTL), placed at `s.pokeyLine` — scanlines from the frame's start,
   * possibly beyond the frame (the pass takes several, ZADANI chap. 10.6).
   * tools/matchsound.mjs compares them write by write with the original.
   */
  static pokey(s, register, value) {
    s.pokey.push([s.pokeyLine, register, value & 0xFF]);
  } // pokey

  /** ★ $1C3D silence: AUDF1 … AUDC4 and AUDCTL zeroed in that order */
  static silence(s) {
    for (var r = 0; r <= 8; r++) {
      CaveScan.pokey(s, r, 0);
    }
  } // silence

  /** ★ $1F57 (the end of cave_setup): channel 2 ready for the walk — AUDF2 = $4B, AUDC2 = 0, envelope $40 */
  static setupSound(s) {
    CaveScan.pokey(s, 2, 0x4B);
    CaveScan.pokey(s, 3, 0);
    s.sound.envelope = 0x40;
  } // setupSound

  // --- status line ($080B) ---------------------------------------------

  static statusNeeded(s)    { s.status[1] = s.needed[0]+0x50; s.status[2] = s.needed[1]+0x50; }        // ★ $1176
  static statusValue(s)     { s.status[4] = s.diamondValue[1]+0x90; s.status[5] = s.diamondValue[2]+0x90; }   // ★ $1187
  static statusCollected(s) { s.status[7] = s.collected[0]+0x50; s.status[8] = s.collected[1]+0x50; }   // ★ $1165
  static statusTime(s)      { for (var i = 0; i < 3; i++) s.status[10+i] = s.time[i]+0x90; }           // ★ $10E7
  static statusScore(s)     { for (var i = 0; i < 6; i++) s.status[14+i] = s.score[i]+0x90; }          // ★ $107C

  // --- the pass ----------------------------------------------------------

  /**
   * ★ $1D8F cave_scan: one pass over rows 3..23.
   * @param {Object} s - The cave state.
   * @param {Object} input - {stick, trig}: the STICK nibble ($0F none, $0E up,
   *   $0D down, $0B left, $07 right, diagonals) and STRIG (0 = pressed).
   * @param {Function} rand - rand(site) → 0–255, the RANDOM read at that site.
   * @returns {Object} Counts of what ran, for the cost model.
   */
  static pass(s, input, rand) {
    var W = CaveScan.W, O = CaveScan.O, UNFLAG = CaveScan.UNFLAG;
    var counts = {handled: 0, stores: 0, rands: 0, rows: 21};
    s.counts = counts;
    s.input = input;
    var ctx = {s: s, rand: function(site) { counts.rands++; return rand(site); }, ptr: 0, counts: counts};
    // ★ $1D73: sixteen passes without Rockford and the button ends the cave (once time ran)
    if (s.noRockford != 0x10) {
      s.noRockford++;
    }
    // ★ $1D38 → $1235
    s.trig = input.trig;
    if (s.noRockford == 0x10 && s.trig == 0 && s.secondsGone != 0) {
      s.caveOver = 2;
    }
    // ★ $1D0F: the amoeba's flags of the last pass — and its sound off once it stopped growing
    s.pokeyLine = s.passLine;
    if (s.amoebaGrow == 0 && s.amoebaGrewLast != 0) {
      s.amoebaEnclosed = 0;
      CaveScan.pokey(s, 5, 0);
    }
    s.amoebaGrewLast = s.amoebaGrow;
    s.amoebaGrow = 0;
    s.amoebaCountLast = s.amoebaCount;
    s.amoebaCount = 0;
    // ★ rows $0791 = 1..21 → grid rows 3..23; the pointer starts at (0,3) − 41
    var ptr = 3*W-41;
    for (var y = 3; y <= 23; y++) {
      for (var x = 0; x < W; x++) {
        ctx.ptr = ptr; ctx.x = x; ctx.y = y;
        // where in the pass a write of this cell lands (the pass's span from the cost model)
        s.pokeyLine = s.passLine+s.passSpan*((y-3)*W+x)/(21*W);
        var code = s.grid[ptr+O.S];
        var handler = CaveScan.HANDLERS[code];
        if (handler) {
          counts.handled++;
          counts[code] = (counts[code] || 0)+1;
          handler(ctx);
        }
        // ★ $1DA2: the cell at offset 0 (one up, one left) loses its scanned flag
        var un = UNFLAG[s.grid[ptr] & 0x3F];
        if (un) {
          s.grid[ptr] = un;
        }
        ptr++;
      }
      // a tool's hook between the row's last cell and $1385 (tools/matchsound.mjs places a vertical blank there)
      if (s.rowEndHook) {
        s.rowEndHook(y);
      }
      // ★ $1385: the envelope of channel 2 — AUDC2 counts $41 … $4F, $40 (4-bit poly, the volume up, then off)
      if (s.sound.envelope != 0x40) {
        s.sound.envelope = ((s.sound.envelope+1) & 0x4F);
        CaveScan.pokey(s, 3, s.sound.envelope);
      }
      // ★ $0FAD: the amoeba's sound while it grew — AUDC3 = $A6, AUDF3 = RANDOM, once per row
      if (s.amoebaGrewLast) {
        CaveScan.pokey(s, 5, 0xA6);
        CaveScan.pokey(s, 4, ctx.rand('0FB7'));
      }
      // ★ $1C2F: the delay loop, in the cost model only
    }
    // ★ $1D69: keyboard ($1CCD, the app's), $107C, the anti-tamper check $1D52 (not reproduced)
    CaveScan.statusScore(s);
    return counts;
  } // pass

  /**
   * ★ $0BDC store_draw_cell: stores the object into the grid and draws its tile.
   * @param {Object} c - The context.
   * @param {number} off - Offset from the pointer (CaveScan.O).
   * @param {number} code - The object.
   */
  static store(c, off, code) {
    c.s.grid[c.ptr+off] = code;
    c.s.tiles[c.ptr+off] = code;
    c.counts.stores++;
  } // store

  /** ★ $0DA9: rounded — a stationary boulder, a stationary diamond or a wall */
  static rounded(code) {
    return code == 0x10 || code == 0x14 || code == 0x02;
  } // rounded

  /**
   * ★ $0C8D: the 3 × 3 explosion around the cell, base code in
   * `explosion` ($1C to space, $21 to diamond). The five cells the scan has
   * passed get the base, the four still ahead get base − 1, so that all of
   * them show the same frame after this pass. Steel survives ($0C31).
   * @param {Object} c - The context.
   */
  static explodeHere(c) {
    var O = CaveScan.O;
    [O.UL, O.U, O.UR, O.L, O.S].forEach((off) => CaveScan.explodeCell(c, off));
    c.s.explosion--;
    [O.R, O.DL, O.D, O.DR].forEach((off) => CaveScan.explodeCell(c, off));
    CaveScan.explosionSound(c.s);
  } // explodeHere

  /** ★ $0C3E: the explosion around the cell below (a falling object landed on someone) */
  static explodeBelow(c) {
    var O = CaveScan.O;
    [O.L, O.S].forEach((off) => CaveScan.explodeCell(c, off));
    c.s.explosion--;
    [O.R, O.DL, O.D, O.DR, O.D2L, O.D2, O.D2R].forEach((off) => CaveScan.explodeCell(c, off));
    CaveScan.explosionSound(c.s);
  } // explodeBelow

  /** ★ $0C31 */
  static explodeCell(c, off) {
    if (c.s.grid[c.ptr+off] != 0x07) {
      CaveScan.store(c, off, c.s.explosion);
    }
  } // explodeCell

  /** ★ $0C6E / $0CBD: the explosion's sound variables — channel 4: 17-bit noise, volume 14 fading, AUDF4 $46 */
  static explosionSound(s) {
    s.sound.d = 0; s.sound.e = 0x0E; s.sound.f = 0x46;
  } // explosionSound

  /** ★ $0D88: the sound of a diamond starting to fall / landing — reads RANDOM; channel 1: a pure tone, volume 10 halving */
  static diamondSound(c) {
    c.s.sound.c = ((c.rand('0D88') & 0x0F)+0x0A) & 0xFF;
    c.s.sound.b = 0x0A; c.s.sound.a = 0x0A;
  } // diamondSound

  /** ★ $0D9B: the sound of a boulder — channel 1: 17-bit noise, volume 10 halving */
  static boulderSound(s) {
    s.sound.c = 0x0A; s.sound.b = 0x0A; s.sound.a = 0;
  } // boulderSound

  /**
   * ★ $0D59: is Rockford ($38/$39) or the amoeba ($3A) next to the creature
   * (up, left, right, down)?
   */
  static touchesRockfordOrAmoeba(c) {
    var O = CaveScan.O, g = c.s.grid, p = c.ptr;
    return [O.U, O.L, O.R, O.D].some((off) => g[p+off] == 0x38 || g[p+off] == 0x39 || g[p+off] == 0x3A);
  } // touchesRockfordOrAmoeba

  /** ★ $0D72: the firefly — explodes next to Rockford or the amoeba, else keeps its left hand on the wall */
  static firefly(c) {
    var s = c.s, A = CaveScan.CREATURE_A, B = CaveScan.CREATURE_B;
    if (CaveScan.touchesRockfordOrAmoeba(c)) {
      s.explosion = 0x1C;
      CaveScan.explodeHere(c);
      return;
    }
    // ★ $0D1F
    var d = s.grid[c.ptr+CaveScan.O.S] & 3;
    if (s.grid[c.ptr+B[d]] == 0) {
      CaveScan.store(c, B[d], ((d+3) & 3)+0x0C);       // ★ $0CFA: turn left and go
      CaveScan.store(c, CaveScan.O.S, 0);
    } else if (s.grid[c.ptr+A[d]] == 0) {
      CaveScan.store(c, A[d], d+0x0C);                 // ★ $0D0D: straight on
      CaveScan.store(c, CaveScan.O.S, 0);
    } else {
      s.grid[c.ptr+CaveScan.O.S] = ((d+1) & 3)+0x0C;   // ★ $0CED: turn right in place, no redraw
    }
  } // firefly

  /** ★ $0E3A: the butterfly — the same with the right hand, and it explodes into diamonds */
  static butterfly(c) {
    var s = c.s, A = CaveScan.CREATURE_A, B = CaveScan.CREATURE_B;
    if (CaveScan.touchesRockfordOrAmoeba(c)) {
      s.explosion = 0x21;
      CaveScan.explodeHere(c);
      return;
    }
    // ★ $0E15
    var d = s.grid[c.ptr+CaveScan.O.S] & 3;
    if (s.grid[c.ptr+A[d]] == 0) {
      CaveScan.store(c, A[d], ((d+1) & 3)+0x34);       // ★ $0DF0
      CaveScan.store(c, CaveScan.O.S, 0);
    } else if (s.grid[c.ptr+B[d]] == 0) {
      CaveScan.store(c, B[d], d+0x34);                 // ★ $0E03
      CaveScan.store(c, CaveScan.O.S, 0);
    } else {
      s.grid[c.ptr+CaveScan.O.S] = ((d+3) & 3)+0x34;   // ★ $0DE3
    }
  } // butterfly

  /**
   * ★ $0DDA: is the cell below an unscanned butterfly ($30–$33, explosion
   * $21) or firefly ($08–$0B, explosion $1C)? Sets `explosion` when so.
   */
  static creatureBelow(c) {
    var s = c.s, below = s.grid[c.ptr+CaveScan.O.D];
    if ((below & 0x33) == below && (below | 0x30) == below) {   // ★ $0DC0
      s.explosion = 0x21;
      return true;
    }
    if ((below & 0x0B) == below && (below & 0x08)) {            // ★ $0CCD
      s.explosion = 0x1C;
      return true;
    }
    return false;
  } // creatureBelow

  /** ★ $1488 (boulder, $13) / $0F36 (diamond, $17): a stationary object rolls off a rounded one — left first, then right */
  static rollStationary(c, falling) {
    var O = CaveScan.O, g = c.s.grid, p = c.ptr;
    if (g[p+O.DL] == 0 && g[p+O.L] == 0) {
      CaveScan.store(c, O.L, falling);
      CaveScan.store(c, O.S, 0);
    } else if (g[p+O.DR] == 0 && g[p+O.R] == 0) {              // ★ $146F / $0F1D
      CaveScan.store(c, O.R, falling);
      CaveScan.store(c, O.S, 0);
    }
  } // rollStationary

  /** ★ $1505 (boulder) / $0EA1 (diamond): a falling object rolls, or stops ($11 / $15) when it cannot */
  static rollFalling(c, falling, stopped) {
    var O = CaveScan.O, g = c.s.grid, p = c.ptr;
    if (g[p+O.DL] == 0 && g[p+O.L] == 0) {
      CaveScan.store(c, O.L, falling);
      CaveScan.store(c, O.S, 0);
    } else if (g[p+O.DR] == 0 && g[p+O.R] == 0) {              // ★ $14E0 / $0E7C
      CaveScan.store(c, O.R, falling);
      CaveScan.store(c, O.S, 0);
    } else {
      CaveScan.store(c, O.S, stopped);                         // ★ $14D8 / $0E74
    }
  } // rollFalling

  /**
   * ★ $152A (boulder) / $0EC6 (diamond): a falling object over something —
   * rolls off a rounded object; kills Rockford or an unscanned creature
   * below it; else stops.
   */
  static land(c, falling, stopped) {
    var s = c.s, below = s.grid[c.ptr+CaveScan.O.D];
    if (CaveScan.rounded(below)) {
      CaveScan.rollFalling(c, falling, stopped);
    } else if (below == 0x38) {
      s.explosion = 0x1C;
      CaveScan.explodeBelow(c);
    } else if (CaveScan.creatureBelow(c)) {
      CaveScan.explodeBelow(c);
    } else {
      CaveScan.store(c, CaveScan.O.S, stopped);
    }
  } // land

  /** ★ $14BA: a stationary boulder starts to fall or rolls */
  static boulder(c) {
    var s = c.s, O = CaveScan.O, below = s.grid[c.ptr+O.D];
    if (below == 0) {
      CaveScan.store(c, O.D, 0x13);
      CaveScan.store(c, O.S, 0);
      CaveScan.boulderSound(s);
    } else if (CaveScan.rounded(below)) {                      // ★ $14AD
      CaveScan.rollStationary(c, 0x13);
    }
  } // boulder

  /** ★ $1557: a falling boulder */
  static boulderFalling(c) {
    var s = c.s, O = CaveScan.O, below = s.grid[c.ptr+O.D];
    if (below == 0) {
      CaveScan.store(c, O.D, 0x13);
      CaveScan.store(c, O.S, 0);
    } else if (below == 0x03) {
      CaveScan.magicWall(c, 0x17, true);                       // ★ $144B
    } else {
      CaveScan.boulderSound(s);
      CaveScan.land(c, 0x13, 0x11);
    }
  } // boulderFalling

  /** ★ $0F68: a stationary diamond */
  static diamond(c) {
    var s = c.s, O = CaveScan.O, below = s.grid[c.ptr+O.D];
    if (below == 0) {
      CaveScan.store(c, O.D, 0x17);
      CaveScan.store(c, O.S, 0);
      CaveScan.diamondSound(c);
    } else if (CaveScan.rounded(below)) {                      // ★ $0F5B
      CaveScan.rollStationary(c, 0x17);
    }
  } // diamond

  /** ★ $0EF3: a falling diamond */
  static diamondFalling(c) {
    var s = c.s, O = CaveScan.O, below = s.grid[c.ptr+O.D];
    if (below == 0) {
      CaveScan.store(c, O.D, 0x17);
      CaveScan.store(c, O.S, 0);
    } else if (below == 0x03) {
      CaveScan.magicWall(c, 0x13, false);                      // ★ $0E50
    } else {
      CaveScan.diamondSound(c);
      CaveScan.land(c, 0x17, 0x15);
    }
  } // diamondFalling

  /**
   * ★ $144B / $0E50: a falling object into the magic wall starts it; while
   * it mills, the object comes out two rows below as the other kind (when
   * that cell is empty); the object vanishes in any case, even into an
   * expired wall.
   */
  static magicWall(c, product, isBoulder) {
    var s = c.s, O = CaveScan.O;
    if (s.magicWall == 0) {
      s.magicWall = 1;
    }
    if (s.magicWall == 1 && s.grid[c.ptr+O.D2] == 0) {
      CaveScan.store(c, O.D2, product);
    }
    CaveScan.store(c, O.S, 0);
    if (isBoulder) {
      CaveScan.diamondSound(c);        // ★ $0D88 — yes, the boulder's milling uses the diamond sound
    } else {
      CaveScan.boulderSound(s);        // ★ $0D9B
    }
  } // magicWall

  /** ★ $0C7E: the closed exit opens once enough diamonds are in */
  static exitClosed(c) {
    if (c.s.diamondsEnough) {
      CaveScan.store(c, CaveScan.O.S, 0x05);
    }
  } // exitClosed

  /**
   * ★ $142A: the inbox and the open exit blink — every other handling the
   * closed-exit tile is drawn without touching the grid ($140D); when the
   * inbox's countdown is over, it starts turning into Rockford ($13D1).
   */
  static blinking(c) {
    var s = c.s, O = CaveScan.O;
    s.blink = (s.blink+1) & 0xFF;
    if (s.blink & 1) {
      s.tiles[c.ptr+O.S] = 0x04;
      c.counts.stores++;
    } else {
      var code = s.grid[c.ptr+O.S];
      CaveScan.store(c, O.S, code);
      if (code == 0x25) {
        CaveScan.birth(c);
      }
    }
  } // blinking

  /** ★ $13D1: one step of the birth, once the countdown $0793 reached 0 */
  static birth(c) {
    var s = c.s;
    if (s.birth == 0) {
      CaveScan.store(c, CaveScan.O.S, CaveScan.BIRTH_NEXT[s.grid[c.ptr+CaveScan.O.S]]);
    }
  } // birth

  /** ★ $13B4: the explosion advances a frame */
  static explosion(c) {
    CaveScan.store(c, CaveScan.O.S, CaveScan.EXPLOSION_NEXT[c.s.grid[c.ptr+CaveScan.O.S]]);
  } // explosion

  /**
   * ★ $0FF6: the amoeba — counts itself; when the last pass counted 200 or
   * more it turns into a boulder; when it was found enclosed, into a
   * diamond; else it may grow into an empty or dirt cell (RANDOM & mask
   * < 4 picks up, left, right, down).
   */
  static amoeba(c) {
    var s = c.s, O = CaveScan.O, g = s.grid, p = c.ptr;
    s.amoebaCount = (s.amoebaCount+1) & 0xFF;
    if (s.amoebaCountLast >= 200) {
      CaveScan.store(c, O.S, 0x11);
      return;
    }
    if (s.amoebaEnclosed == 0) {
      CaveScan.store(c, O.S, 0x14);
      return;
    }
    // ★ $0FDC: can it grow at all?
    if (s.amoebaGrow == 0) {
      [O.U, O.L, O.R, O.D].forEach((off) => {
        if (g[p+off] == 0 || g[p+off] == 1) {
          s.amoebaGrow = 1;
        }
      });
    }
    var r = c.rand('1018') & s.amoebaMask;
    if (r < 4) {
      var off = [O.U, O.L, O.R, O.D][r];
      var target = g[p+off];
      if (target == 1) {
        s.sound.envelope = 0x41;       // ★ $0F94
      }
      if (target == 0 || target == 1) {
        CaveScan.store(c, off, 0x3B);  // ★ $0FA2
      }
    }
  } // amoeba

  /** ★ $135B: Rockford — reads the stick (or the demo's), moves, resets the no-Rockford count */
  static rockford(c) {
    var s = c.s;
    if (!s.demo) {
      s.stick = c.s.input.stick;
    }
    // ★ $1322: four directions; a diagonal counts as its horizontal part
    switch (s.stick) {
      case 0x0B: case 0x09: case 0x0A: CaveScan.rockfordLeft(c); break;
      case 0x07: case 0x06: case 0x05: CaveScan.rockfordRight(c); break;
      case 0x0D: CaveScan.rockfordDown(c); break;
      case 0x0E: CaveScan.rockfordUp(c); break;
    }
    s.noRockford = 0;
  } // rockford

  static rockfordRight(c) { c.s.facing = 0; if (CaveScan.rockfordTry(c, CaveScan.O.R)) c.s.rockfordX = (c.s.rockfordX+1) & 0xFF; }   // ★ $12D8
  static rockfordLeft(c)  { c.s.facing = 1; if (CaveScan.rockfordTry(c, CaveScan.O.L)) c.s.rockfordX = (c.s.rockfordX-1) & 0xFF; }   // ★ $12ED
  static rockfordUp(c)    { if (CaveScan.rockfordTry(c, CaveScan.O.U)) c.s.rockfordY = (c.s.rockfordY-1) & 0xFF; }                  // ★ $1302
  static rockfordDown(c)  { if (CaveScan.rockfordTry(c, CaveScan.O.D)) c.s.rockfordY = (c.s.rockfordY+1) & 0xFF; }                  // ★ $1312

  /**
   * ★ $12AD: what the target cell allows ($127C); with the button held
   * Rockford acts on the cell without moving.
   * @returns {boolean} Whether Rockford moved.
   */
  static rockfordTry(c, off) {
    var s = c.s;
    CaveScan.rockfordTarget(c, off);
    if (!s.moved) {
      return false;
    }
    s.trig = s.input.trig;                                     // ★ $1235
    if (s.trig != 0) {
      CaveScan.store(c, off, 0x39);
      CaveScan.store(c, CaveScan.O.S, 0);
      s.moved = 1;
      return true;
    }
    CaveScan.store(c, off, 0);
    s.moved = 0;
    return false;
  } // rockfordTry

  /** ★ $127C: space and dirt are walked, a diamond collected, the open exit taken, a boulder pushed */
  static rockfordTarget(c, off) {
    var s = c.s, O = CaveScan.O, target = s.grid[c.ptr+off];
    s.moved = 0;
    switch (target) {
      case 0x00:
        s.sound.envelope = 0x41; CaveScan.pokey(s, 2, 0xCC);   // ★ $1225 walk_sound: AUDF2 = $CC, the envelope starts
        s.moved = 1;
        break;
      case 0x01:
        s.sound.envelope = 0x41; CaveScan.pokey(s, 2, 0x4B);   // ★ $1215 dig_sound: AUDF2 = $4B
        s.moved = 1;
        break;
      case 0x14:
        CaveScan.collect(c);                                   // ★ $11EE
        break;
      case 0x05:
        s.caveOver = 2; s.exitReached = 1;                     // ★ $1296
        s.moved = 1;
        break;
      case 0x10:                                               // ★ $125D
        if (off == O.L && s.grid[c.ptr+O.L2] == 0) {
          CaveScan.push(c, O.L2);
        } else if (off == O.R && s.grid[c.ptr+O.R2] == 0) {
          CaveScan.push(c, O.R2);
        }
        break;
    }
  } // rockfordTarget

  /** ★ $124A: a boulder moves with probability 1/4 per pass (RANDOM & 3 == 0) */
  static push(c, behind) {
    if ((c.rand('124A') & 3) == 0) {
      c.s.moved = 1;
      CaveScan.boulderSound(c.s);
      CaveScan.store(c, behind, 0x11);
    }
  } // push

  /** ★ $11EE: a diamond — score, count, status line; the needed count switches the value to the extra value ($1198) */
  static collect(c) {
    var s = c.s;
    s.sound.c = 0x64; s.sound.a = 0x0A; s.sound.b = 0x0A;        // ★ $11F3: channel 1, a pure tone $64
    CaveScan.addScore(s, [0, 0, 0].concat(s.diamondValue));   // ★ $1057 with $07B0–$07B5
    CaveScan.addDigits(s.collected, [0, 1]);                   // ★ $114F
    CaveScan.statusCollected(s);
    if (s.collected[0] == s.needed[0] && s.collected[1] == s.needed[1]) {   // ★ $11BE
      s.diamondsEnough = 1;
      s.diamondValue = s.extraValue.slice();
      CaveScan.statusValue(s);
      s.status[1] = 0xBC; s.status[2] = 0xBC;
      s.sound.a = 0x08; s.sound.b = 0x0F; s.sound.c = 0x0A;      // ★ $1095 sound_enough: channel 1, 17-bit noise ungated, volume 15
      s.flash = 6;
    }
    s.moved = 1;
  } // collect

  /**
   * ★ $1057 / $103C / $102C: adds to the score; every 500 points give a
   * life (up to 9) and 128 frames of flickering space.
   */
  static addScore(s, add) {
    s.scoreOld = [s.score[2], s.score[3]];
    CaveScan.addDigits(s.score, add);
    var bonus = false;
    if (s.score[2] != s.scoreOld[0]) bonus = true;
    if (s.scoreOld[1] == 4 && s.score[3] != s.scoreOld[1]) bonus = true;
    if (bonus) {
      CaveScan.bonusLife(s);
    }
  } // addScore

  /** ★ $102C */
  static bonusLife(s) {
    if (s.lives != 9) {
      s.lives++;
      s.flicker = 0x80;
    }
  } // bonusLife

  // --- the cost of a pass ----------------------------------------------------

  /**
   * ★ tools/fitpasscost.mjs — scanlines of the PAL frame (312) a pass takes,
   * a linear model fitted to the measured passes of the original
   * (MILNIKY.md M3, refitted on all 20 caves in M4): a base, the delay loop
   * $1C2F (iterations × 21 rows), every store_draw_cell, and every handled
   * object by code.
   */
  static get COST() {
    // ★ tools/fitpasscost.mjs — 80 524 průchodů, 20 jeskyní × úrovně 1–5 (M4): RMS 0,145 snímku,
    // střední |chyba| 0,097, max 1,44; odlehlé průchody jsou z většiny párový jitter měření
    // (sousední průchody s opačnou chybou), ne hra. Kódy 04/25/38 jsou spíš ukazatele fáze
    // (před sběrem, před narozením, Rockford žije) než cena obsluhy — regrese je tak čte
    return {
      base: 1130.7, delayIteration: 1.498, store: 3.79,
      code: {0x04: -42.2, 0x05: -18.7, 0x08: 5.5, 0x09: 6.4, 0x0A: 5.4, 0x0B: 7.1, 0x10: 2.1, 0x12: 4.4, 0x14: 2.5, 0x16: 5.6,
             0x1B: 7.8, 0x1C: 6.3, 0x1D: 6.1, 0x1E: 6.1, 0x1F: 6.2, 0x20: 11.2, 0x21: 9.0, 0x22: 7.8, 0x23: 8.5, 0x24: 8.5,
             0x25: 50.9, 0x26: 23.8, 0x27: 18.1, 0x28: 22.0, 0x30: 6.3, 0x31: 5.8, 0x32: 6.2, 0x33: 5.9, 0x38: 46.1, 0x3A: 3.0}
    };
  } // COST

  /**
   * How many scanlines the pass that just ran took on the original — the
   * next pass starts when they have gone by (gameWorker.js).
   * @param {Object} counts - What CaveScan.pass returned.
   * @param {number} level - Difficulty index 0–4.
   * @returns {number} Scanlines.
   */
  static passCost(counts, level) {
    var cost = CaveScan.COST;
    var lines = cost.base+cost.delayIteration*CaveScan.ROW_DELAY[level]*21+cost.store*counts.stores;
    Object.keys(cost.code).forEach((code) => {
      lines += cost.code[code]*(counts[code] || 0);
    });
    return lines;
  } // passCost

  // --- the start of a cave: the uncovering ---------------------------------

  /**
   * ★ $18D8: one cell of the uncovering — a random column of the current
   * row (RANDOM until it is below 40) gets its tile drawn over the cover;
   * 120 rounds of 22 rows. Returns the index drawn, or −1 when done.
   */
  static uncoverCell(s, rand) {
    if (s.uncoverRound >= 120) {
      return -1;
    }
    var x;
    do {
      x = rand('18E5');
    } while (x > 39);
    return CaveScan.uncoverAccept(s, x);
  } // uncoverCell

  /**
   * ★ $18F3: the accepted column of the current row gets its tile; the row
   * advances, 22 rows make a round. Split from uncoverCell so a tool can
   * feed the recorded RANDOM values one by one.
   * @returns {number} The index drawn.
   */
  static uncoverAccept(s, x) {
    var index = (s.uncoverRow+2)*CaveScan.W+x;
    s.tiles[index] = s.grid[index];
    if (++s.uncoverRow == 22) {
      s.uncoverRow = 0;
      s.uncoverRound++;
    }
    return index;
  } // uncoverAccept

  /** ★ $1954: the rows of the full drawing after the uncovering. Returns false when done. */
  static drawRow(s) {
    if (s.drawRow >= 22) {
      return false;
    }
    var from = (s.drawRow+2)*CaveScan.W;
    for (var i = from; i < from+CaveScan.W; i++) {
      s.tiles[i] = s.grid[i];
    }
    if (++s.drawRow == 22) {
      s.margin = 0x4A;                 // ★ $18BF
      s.marginTop = [0x4A, 0x4A, 0x4A];
      s.covered.fill(0);
      s.cover = 0;                     // ★ $2676: the cover glyph stops rattling
    }
    return true;
  } // drawRow

} // class CaveScan

/** ★ $3C80: code → handler (null entries are not handled) */
CaveScan.HANDLERS = (function() {
  var h = [];
  for (var i = 0; i < 64; i++) h.push(null);
  h[0x04] = CaveScan.exitClosed;
  h[0x05] = CaveScan.blinking;
  for (i = 0x08; i <= 0x0B; i++) h[i] = CaveScan.firefly;
  h[0x10] = CaveScan.boulder;
  h[0x12] = CaveScan.boulderFalling;
  h[0x14] = CaveScan.diamond;
  h[0x16] = CaveScan.diamondFalling;
  for (i = 0x1B; i <= 0x24; i++) h[i] = CaveScan.explosion;
  h[0x25] = CaveScan.blinking;
  for (i = 0x26; i <= 0x28; i++) h[i] = CaveScan.birth;
  for (i = 0x30; i <= 0x33; i++) h[i] = CaveScan.butterfly;
  h[0x38] = CaveScan.rockford;
  h[0x3A] = CaveScan.amoeba;
  return h;
})();

if (typeof self !== 'undefined') { self.CaveScan = CaveScan; } else if (typeof globalThis !== 'undefined') { globalThis.CaveScan = CaveScan; }
if (typeof module !== 'undefined' && module.exports) { module.exports = CaveScan; }
