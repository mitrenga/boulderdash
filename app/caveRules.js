// begin code

/**
 * The rules of the game around a cave — ★ what the original's main loop does
 * between the end of one cave and the start of the next (M5), read out of
 * its code (sources/asm/main.asm, sources/docs/disasm_notes.md §18) and
 * proved against whole recorded games by tools/matchrules.mjs. A classic
 * script like caveScan.js (importScripts, no import/export, R-001).
 *
 * ★ The main loop ($28F3): while the cave number is 0 the title and the
 * menu run ($25C3, $2554) and a new game starts ($2680); otherwise the cave
 * is set up ($2645), scanned pass after pass until it is over ($2884; the
 * demo $2896 runs its script instead), then $288C: cave_end_vars ($282B) —
 * the bonus for the time left ($27D4), or the next cave after an
 * intermission ($27B8), or a life lost ($2814) with the two players taking
 * turns and the game over — and cave_end ($2012): OUT OF TIME ($1FA7),
 * GAME OVER ($1F67) or the status of the next cave ($1FEA, a BONUS LIFE on
 * entering an intermission), and the covering of the picture ($1870,
 * $1852).
 *
 * The game state `g` is the original's variables: $07A6 player, $07A7 two
 * players, $07AD two joysticks, $07A9 game over, $07AB demo, $07B6 lives,
 * $07B7/$07B8 cave and difficulty, $07B9 score, $07BF the high score (as
 * characters), the two players' saved blocks $07C5/$07D4 (lives, cave,
 * difficulty, score, high score), the title's LAST/HIGH rows $07E3/$07F7
 * and the status line before birth $081F. Lives and score live in the cave
 * state `s` while a cave is on (CaveScan uses them: a diamond, a bonus
 * life) and are synced here at the boundaries.
 *
 * The busy waits of the original ($1C4A delay, $1F75 wait for the trigger,
 * the bonus loop, the covering) are modelled in scanlines of the PAL frame
 * measured without hooks by tools/timerules.py (COST), the same way as the
 * pass (CaveScan.passCost, ZADANI chap. 10.6).
 */
class CaveRules {

  /** ★ $1E0B: cave number 1–20 → (next cave, intermission); 21 = end of the cycle */
  static get SEQUENCE() {
    return [null, [2, 0], [3, 0], [4, 0], [17, 0], [6, 0], [7, 0], [8, 0], [18, 0], [10, 0], [11, 0], [12, 0], [19, 0],
            [14, 0], [15, 0], [16, 0], [20, 0], [5, 1], [9, 1], [13, 1], [21, 1]];
  } // SEQUENCE

  /** ★ $0AAB: "PLAYER 1, 3 MEN A/0", the template of the status line before birth ($2925 → $081F) */
  static get STATUS_TEMPLATE() {
    return [0xB0, 0xAC, 0xA1, 0xB9, 0xA5, 0xB2, 0x80, 0x91, 0x8C, 0x80, 0x93, 0x80, 0xAD, 0xA5, 0xAE, 0x80, 0xA1, 0x8F, 0x90, 0xA0];
  } // STATUS_TEMPLATE

  /** ★ $0A6C / $0A81: the title's LAST and HIGH rows (" 000000 LAST 000000 ") */
  static get LAST_TEMPLATE() {
    return [0xA0, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0xA0, 0xAC, 0xA1, 0xB3, 0xB4, 0xA0, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0xA0];
  } // LAST_TEMPLATE
  static get HIGH_TEMPLATE() {
    return [0xA0, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0xA0, 0xA8, 0xA9, 0xA7, 0xA8, 0xA0, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0xA0];
  } // HIGH_TEMPLATE

  /**
   * ★ tools/timerules.py — the busy waits of the main loop in scanlines of
   * the PAL frame (312), measured on the original without hooks:
   * - bonusIteration: one second of the bonus count ($27F1: time − 1, score
   *   + level, the sound $2746) — 150 iterations in 162 frames
   * - delay: $1C4A (256 × 256 DEX/BNE) — $1C55 is four of them, 71 frames
   * - waitTrig: $1F75 (256 × 128 reads of STRIG) — 67.3 frames; OUT OF TIME
   *   is on for one and off for three, twenty times or until the trigger
   * - coverRound / coverRead: a round of $1875 over the 24 rows and one read
   *   of RANDOM in it — the rounds slow down as the rows fill (48 rounds in
   *   24 frames, RMS 0.6 frame)
   */
  static get COST() {
    return {bonusIteration: 337, delay: 5538, waitTrig: 21008, coverRound: 40.0, coverRead: 0.814};
  } // COST

  /** ★ $1FA7: OUT OF TIME blinks 20 times */
  static get OUT_OF_TIME_BLINKS() { return 20; }

  /** ★ $1FDF / $1FE4: the OUT OF TIME loop ends with the trigger variable $0843 at 0 — pressed, or forced after the last blink */
  static outOfTimeDone(s) {
    s.trig = 0;
  } // outOfTimeDone

  // --- the game --------------------------------------------------------------

  /**
   * ★ init $2993 (first run: the high scores are "000000") + $2680 new_game
   * + menu_start $2554/$258D: a new game with the menu's choices.
   * @param {Object} options - {caveNumber 1–20, levelIndex 0–4, twoPlayers, twoJoysticks, demo}.
   * @returns {Object} The game state.
   */
  static newGame(options) {
    options = options || {};
    var zeros = () => [0, 0, 0, 0, 0, 0];
    var chars = () => [0x90, 0x90, 0x90, 0x90, 0x90, 0x90];
    var g = {
      player: 0, twoPlayers: options.twoPlayers ? 1 : 0, twoJoysticks: options.twoJoysticks ? 1 : 0,   // ★ $07A6, $07A7, $07AD
      gameOver: 0, demo: options.demo ? 1 : 0,                                                          // ★ $07A9, $07AB
      caveNumber: options.caveNumber || 1, levelIndex: options.levelIndex || 0,                         // ★ $07B7, $07B8
      lives: 3, score: zeros(), add: zeros(),                                                           // ★ $07B6, $07B9, $07B0
      high: chars(),                                                                                    // ★ $07BF
      saves: [{lives: 3, caveNumber: 1, levelIndex: 0, score: zeros(), high: chars()},                  // ★ $07C5 player 1
              {lives: 3, caveNumber: 1, levelIndex: 0, score: zeros(), high: chars()}],                 // ★ $07D4 player 2
      lastRow: CaveRules.LAST_TEMPLATE.slice(), highRow: CaveRules.HIGH_TEMPLATE.slice(),               // ★ $07E3, $07F7
      statusB: CaveRules.STATUS_TEMPLATE.slice(),                                                       // ★ $081F
      intermission: 0,                                                                                  // ★ $07AF
      bonusCounter: 0                                                                                   // ★ $0879
    };
    // ★ $2583: the demo plays cave A on the first difficulty
    if (g.demo) {
      g.caveNumber = 1; g.levelIndex = 0;
    }
    // ★ $258D: the cave and the difficulty in the status line before birth
    g.statusB[16] = (g.caveNumber+0xA0) & 0xFF;
    g.statusB[18] = (g.levelIndex+0x91) & 0xFF;
    // ★ $2680 new_game: player 1, no game over, score 0, 3 lives, both
    // players' blocks get the lives, the cave, the difficulty and the score
    // (their high scores stay), the high score is player 1's
    g.saves.forEach((save) => { save.lives = 3; save.caveNumber = g.caveNumber; save.levelIndex = g.levelIndex; save.score = zeros(); });
    g.high = g.saves[0].high.slice();
    return g;
  } // newGame

  /**
   * ★ $1E33 load_cave: the intermission flag of the cave ($07AF, $1E43);
   * ★ $1F3A: two players with one joystick get 6 ticks to hand it over,
   * else 4.
   * @returns {Object} {intermission, demo, birth} for CaveScan.create / startVars.
   */
  static caveOptions(g) {
    g.intermission = CaveRules.SEQUENCE[g.caveNumber][1];
    return {intermission: g.intermission, demo: g.demo,
            birth: ((g.twoJoysticks ^ 1) & g.twoPlayers) ? 6 : 4};
  } // caveOptions

  /** lives and score into the cave state (the same variables on the machine) */
  static attach(g, s) {
    s.lives = g.lives;
    s.score = g.score;
  } // attach

  /** lives back from the cave state (the score array is shared) */
  static detach(g, s) {
    g.lives = s.lives;
  } // detach

  // --- the end of a cave -----------------------------------------------------

  /**
   * ★ $282B cave_end_vars, first half: the game pauses; the exit reached
   * starts the bonus count, an intermission just goes on to the next cave,
   * anything else is a life lost. The status line patch ($2849) comes after
   * the bonus (caveEndVarsDone).
   * @returns {string} 'bonus' | 'next' | 'lifeLost'.
   */
  static caveEndVars(g, s) {
    CaveRules.caveEndPause(g, s);
    return CaveRules.caveEndBranch(g, s);
  } // caveEndVars

  /** ★ $282D: the game pauses (the clock stops in the vertical blank) */
  static caveEndPause(g, s) {
    CaveRules.detach(g, s);
    s.paused = 1;
  } // caveEndPause

  /** ★ $2830: the branch of cave_end_vars — the bonus, the next cave, or a life lost */
  static caveEndBranch(g, s) {
    if (s.exitReached) {
      CaveRules.bonusStart(g, s);
      return 'bonus';
    }
    if (s.intermission) {
      CaveRules.nextCave(g);
    } else {
      CaveRules.lifeLost(g, s);
    }
    CaveRules.caveEndVarsDone(g);
    return s.intermission ? 'next' : 'lifeLost';
  } // caveEndBranch

  /** ★ $2849: not in the demo — the status line before birth gets the player, the lives, MAN/MEN, the cave and the difficulty */
  static caveEndVarsDone(g) {
    if (g.demo) {
      return;
    }
    var b = g.statusB;
    b[7] = (g.player+0x91) & 0xFF;
    b[10] = (g.lives+0x90) & 0xFF;
    b[13] = g.lives == 1 ? 0xA1 : 0xA5;
    b[16] = (g.caveNumber+0xA0) & 0xFF;
    b[18] = (g.levelIndex+0x91) & 0xFF;
  } // caveEndVarsDone

  /** ★ $27D4 bonus_count: the amount is the difficulty + 1 a second; the cave is "not over" while it counts */
  static bonusStart(g, s) {
    g.add = [0, 0, 0, 0, 0, (g.levelIndex+1) & 0xFF];
    s.caveOver = 0;
    g.bonusCounter = 0;
  } // bonusStart

  /**
   * ★ $27F1: one second of the bonus — time − 1 ($10CE, with the time check
   * $10A5: 000 ends it, under 10 ticks), the status line, the score + the
   * amount ($1057, a bonus life every 500), the status line, the sound
   * ($2746), the counter. In three parts, because the vertical blank can
   * fall between them and a tool drives each by the record. Returns true
   * while the count goes on.
   */
  static bonusStep(g, s) {
    CaveRules.bonusTime(s);
    CaveRules.bonusScore(g, s);
    CaveRules.bonusCount(g, s);
    return s.caveOver == 0;
  } // bonusStep

  /** ★ $27F1–$27F4: time − 1 with the time check, the status line — in two parts, because the vertical blank can fall between them (a tool drives each by the record) */
  static bonusTime(s) {
    CaveRules.bonusTimeDec(s);
    CaveRules.bonusTimeCheck(s);
  } // bonusTime

  /** ★ $10CE time_dec: time − 1 */
  static bonusTimeDec(s) {
    CaveScan.addDigits(s.time, [9, 9, 9]);
  } // bonusTimeDec

  /** ★ $10A5 time_check: at 000 the cave is over, under 10 the clock ticks (channel 1); then the status line $10E7 */
  static bonusTimeCheck(s) {
    if (s.time[0] == 0 && s.time[1] == 0) {
      if (s.time[2] == 0) {
        s.caveOver = 2;
      } else {
        s.sound.c = (0x32+s.time[2]) & 0xFF; s.sound.a = 0x0A; s.sound.b = 0x0A;
      }
    }
    CaveScan.statusTime(s);
  } // bonusTimeCheck

  /** ★ $27F7–$27FA: the score + the amount (a bonus life every 500), the status line */
  static bonusScore(g, s) {
    CaveScan.addScore(s, g.add);
    CaveScan.statusScore(s);
    CaveRules.detach(g, s);
  } // bonusScore

  /**
   * ★ $27FD–$2800: the sound and the counter. ★ $2746: AUDC4 = $AA (a pure
   * tone, volume 10), then AUDF4 = X + counter for X = 15 … 1 with a delay
   * of 256 × 5 cycles after each — a rising sweep of fifteen steps, spread
   * here over the iteration's span (`s.passSpan`, set by the caller; the
   * order is what a tool checks) — then AUDC4 = 0.
   */
  static bonusCount(g, s) {
    var base = s.pokeyLine, span = s.passSpan || 0;
    CaveScan.pokey(s, 7, 0xAA);
    for (var x = 15; x >= 1; x--) {
      s.pokeyLine = base+span*(16-x)/16;
      CaveScan.pokey(s, 6, (x+g.bonusCounter) & 0xFF);
    }
    CaveScan.pokey(s, 7, 0);
    s.pokeyLine = base;
    g.bonusCounter = (g.bonusCounter+1) & 0xFF;
  } // bonusCount

  /** ★ $2808: after the count — the delay $1C55, the sound off, the next cave, and the status line patch */
  static bonusDone(g, s) {
    s.sound.a = 0;
    CaveRules.nextCave(g);
    CaveRules.caveEndVarsDone(g);
  } // bonusDone

  // --- the title ------------------------------------------------------------

  /**
   * ★ $2608 (the title $25C3 after the game): the tune's variables and the
   * chip — $0872 = 0 (the index into the page of notes), $0874 = 0 (the
   * repeats), $0873 = $A0 (the phase), AUDC1 = AUDC3 = 0, AUDCTL = $78
   * (channels 1+2 and 3+4 joined into 16-bit dividers at 1.79 MHz). SKCTL
   * = 3 is the normal state of the chip and is not a write here.
   * @param {Array} out - Where the writes go: [line, register, value].
   * @returns {Object} The tune's state.
   */
  static titleStart(out) {
    out.push([0, 1, 0], [0, 5, 0], [0, 8, 0x78]);
    return {index: 0, phase: 0xA0, repeats: 0, demo: false};
  } // titleStart

  /**
   * ★ $23A0, every frame of the title and the menu from the vertical blank
   * ($2446): with the phase at $A0 (every eighth frame) the next two bytes
   * of the **page of notes** — the first 256 bytes of character set B at
   * $4400, read as they stand — index the table of 16-bit dividers at
   * $2328 (a byte's double, so the 256 bytes there, table and the code
   * after it): the byte at index + 1 sets channel 1+2, the byte at index
   * channel 3+4. Every frame the volumes: AUDC4 = phase + 3, AUDC2 =
   * (phase ^ 7) + 4, the phase cycling $A0 … $A7. When the index wraps
   * the repeat count goes up; two repeats with the demo flag ($07AB) start
   * the demo ($0875) — ★ 2 041 frames of the tune (2 × 128 notes × 8
   * frames, the first note at once; RTCLOK 2 060 from power-on).
   * @param {Object} tune - The state of titleStart.
   * @param {Array|Uint8Array} notes - The 256 bytes at $2328 (data/global.json title.notes).
   * @param {Array|Uint8Array} page - The 256 bytes at $4400 (character set B, data/charset.json).
   * @param {Array} out - Where the writes go.
   * @param {boolean} demoFlag - ★ $07AB: whether the demo may start.
   * @returns {boolean} True when the demo starts this frame.
   */
  static titleStep(tune, notes, page, out, demoFlag) {
    if (tune.phase == 0xA0) {
      var x = tune.index;
      tune.index = (tune.index+2) & 0xFF;
      var y = (page[(x+1) & 0xFF]*2) & 0xFF;
      out.push([0, 0, notes[y]], [0, 2, notes[(y+1) & 0xFF]]);
      y = (page[x]*2) & 0xFF;
      out.push([0, 4, notes[y]], [0, 6, notes[(y+1) & 0xFF]]);
      if (tune.index == 0) {
        tune.repeats = (tune.repeats+1) & 0xFF;
      }
    }
    out.push([0, 7, (tune.phase+3) & 0xFF]);
    out.push([0, 3, ((tune.phase ^ 7)+4) & 0xFF]);
    tune.phase = (tune.phase+1) & 0xA7;
    if (demoFlag && tune.repeats == 2 && !tune.demo) {
      tune.demo = true;
      return true;
    }
    return false;
  } // titleStep

  /**
   * ★ $27B8 next_cave: the sequence table; at the end of the cycle the
   * difficulty goes up (not past the fifth) and the game returns to cave A.
   */
  static nextCave(g) {
    var next = CaveRules.SEQUENCE[g.caveNumber][0];
    if (next == 21) {
      if (g.levelIndex != 4) {
        g.levelIndex++;
      }
      next = 1;
    }
    g.caveNumber = next;
  } // nextCave

  /**
   * ★ $2814 life_lost: the high score ($2763, compared as the characters of
   * the status line), a life less and the current player's block saved
   * ($26CD), the other player's turn if he has lives ($26F2), his block
   * loaded ($270F), and with no lives the game is over ($2731): three lives
   * again, player 1, cave 0 (the title) and the LAST/HIGH rows of the title
   * ($2793).
   */
  static lifeLost(g, s) {
    // ★ $2763: the score in the status line ($0819, score + $90) against the high score, digit by digit
    var chars = g.score.map((d) => (d+0x90) & 0xFF);
    for (var x = 0; x < 6; x++) {
      if (chars[x] == g.high[x]) {
        continue;
      }
      if (g.high[x] < chars[x]) {
        g.high = chars.slice();
      }
      break;
    }
    // ★ $26CD
    g.lives = (g.lives-1) & 0xFF;
    CaveRules.saveBlock(g, g.player);
    // ★ $26F2: two players take turns while the other one has lives
    if (g.twoPlayers) {
      if (g.player == 0) {
        if (g.saves[1].lives != 0) g.player++;
      } else {
        if (g.saves[0].lives != 0) g.player--;
      }
    }
    // ★ $270F
    CaveRules.loadBlock(g, g.player);
    // ★ $2731
    if (g.lives == 0) {
      g.gameOver = 1;
      g.lives = 3;
      g.player = 0;
    }
    // ★ $281A
    if (g.gameOver) {
      g.caveNumber = 0;
      g.levelIndex = 0;
      for (var i = 0; i < 6; i++) {
        g.lastRow[1+i] = (g.saves[0].score[i]+0x90) & 0xFF;
        g.lastRow[13+i] = (g.saves[1].score[i]+0x90) & 0xFF;
        g.highRow[1+i] = g.saves[0].high[i];
        g.highRow[13+i] = g.saves[1].high[i];
      }
    }
    s.lives = g.lives;
  } // lifeLost

  /** ★ $26D5 / $26E5: $07B6–$07C4 (lives, cave, difficulty, score, high score) into the player's block */
  static saveBlock(g, player) {
    var save = g.saves[player];
    save.lives = g.lives; save.caveNumber = g.caveNumber; save.levelIndex = g.levelIndex;
    save.score = g.score.slice(); save.high = g.high.slice();
  } // saveBlock

  /** ★ $2714 / $2724: the player's block back into $07B6–$07C4 */
  static loadBlock(g, player) {
    var save = g.saves[player];
    g.lives = save.lives; g.caveNumber = save.caveNumber; g.levelIndex = save.levelIndex;
    for (var i = 0; i < 6; i++) g.score[i] = save.score[i];   // the array the cave state shares
    g.high = save.high.slice();
  } // loadBlock

  // --- cave_end $2012 --------------------------------------------------------

  /** ★ $2012: OUT OF TIME only when the seconds gone reached the cave's time ($0865) — the natural end, not a patched clock */
  static outOfTime(s) {
    return s.secondsGone == s.caveTime;
  } // outOfTime

  /**
   * ★ $201D–$202D: after OUT OF TIME (if any) the status line shows GAME
   * OVER, or — with a cave to come — the status of the next cave
   * ($1FEA next_status): entering an intermission gives a BONUS LIFE
   * ($102C: a life up to 9 and 128 frames of flicker), else the line
   * before birth.
   * The status line's buffer ($5EA4) is `s.statusText` (a text over the
   * two buffers) with `s.statusInGame` (which of the two).
   * @returns {string} 'gameOver' | 'bonusLife' | 'statusB' | null (cave 0 after the demo: unchanged).
   */
  static nextStatus(g, s) {
    if (g.gameOver) {
      s.statusText = 'gameOver';                                 // ★ $1F67: LMS → $0A96
      return 'gameOver';
    }
    if (g.caveNumber != 0) {
      g.intermission = CaveRules.SEQUENCE[g.caveNumber][1];
      if (g.intermission) {
        s.statusText = 'bonusLife';                              // ★ $1FF7: LMS → $0AD5
        CaveRules.attach(g, s);
        CaveScan.bonusLife(s);
        CaveRules.detach(g, s);
        return 'bonusLife';
      }
      s.statusText = null; s.statusInGame = false;               // ★ $2007: LMS → $081F
      return 'statusB';
    }
    return null;
  } // nextStatus

  // --- the covering $1870 ----------------------------------------------------

  /** the addresses of the 24 rows the display list shows — ★ $1652: LMS = $5000 + 80 (row + y) + x */
  static rowAddress(s, row) {
    return (0x5000+80*(row+s.scroll.y)+s.scroll.x) & 0xFFFF;
  } // rowAddress

  /**
   * ★ $1886: one read of RANDOM in the covering — a random character
   * (RANDOM & $3F under 48) of the current row of the window that is not
   * the cover yet gets the cover glyph $7C, and the row advances; after 256
   * misses in a row the pick is forced. `s.covered` remembers what is the
   * cover (the picture is the model's). Split from coverRound so a tool can
   * feed the recorded values one by one.
   * @returns {number} The address written, or −1.
   */
  static coverRead(s, value) {
    var y = value & 0x3F;
    if (y >= 0x30) {
      return -1;
    }
    var address = (CaveRules.rowAddress(s, s.coverRow)+y) & 0xFFFF;
    s.coverMisses = (s.coverMisses+1) & 0xFF;
    if (s.coverMisses == 0) {
      s.covered[address-0x5000] = 0;                        // ★ $1895: the character is cleared, so the check below passes
    }
    if (s.covered[address-0x5000]) {
      return -1;
    }
    s.covered[address-0x5000] = 1;
    if (address < 0x5003) {
      s.marginTop[address-0x5000] = 0x7C;
    }
    // ★ $18A3: the next row; ★ $18B4: after the 24 rows the next round
    s.coverMisses = 0;
    if (++s.coverRow == 24) {
      s.coverRow = 0;
      s.coverRounds++;
    }
    return address;
  } // coverRead

  /**
   * ★ $1875: one round of the covering over the 24 rows of the window
   * (48 rounds, $0790).
   * @returns {Object} {writes: [address…], reads}.
   */
  static coverRound(s, rand) {
    var writes = [], reads = 0, round = s.coverRounds;
    while (s.coverRounds == round) {
      var address = CaveRules.coverRead(s, rand('1886'));
      reads++;
      if (address >= 0) {
        writes.push(address);
      }
    }
    return {writes: writes, reads: reads};
  } // coverRound

  /** ★ $1852 cover_cave: every cell of the 22 rows is the cover glyph again (the margins stay) */
  static coverCave(s) {
    s.tiles.fill(CaveScan.COVERED);
    s.covered.fill(0);
    s.coverRounds = 0; s.coverRow = 0; s.coverMisses = 0;
  } // coverCave

} // class CaveRules

if (typeof self !== 'undefined') { self.CaveRules = CaveRules; } else if (typeof globalThis !== 'undefined') { globalThis.CaveRules = CaveRules; }
if (typeof module !== 'undefined' && module.exports) { module.exports = CaveRules; }
