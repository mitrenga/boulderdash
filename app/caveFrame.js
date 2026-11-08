// begin code

/**
 * One frame of the cave — ★ $1BB0 cave_step, what the original does in its
 * deferred vertical blank interrupt every frame of the PAL machine while a
 * cave is on (sources/docs/disasm_notes.md §2, §14). A classic script like
 * caveScan.js; it works on the same state object and is proved frame by
 * frame by tools/matchscan.mjs against the frame log of the original.
 *
 * What it decides here is what the model then draws: the luminance of the
 * background ($1AA6), the state of the magic wall's glyphs ($1B40), the
 * phase of the tile animation and whether idle Rockford blinks or taps
 * ($1B62, $1986), the position of the window and HSCROL/VSCROL ($1814), the
 * rotation of the cover glyph ($192C), the status line after the countdown
 * ($1127). The clocks — the tick of a game second (60 frames), the birth
 * countdown, the magic wall's time, the flicker of a bonus life — live
 * here too.
 */
class CaveFrame {

  /** ★ $15E7 / $15F3: (Rockford's position in the window, velocity lo, hi) */
  static get Y_TABLE() { return [[5, 0xC0, 0xFF], [7, 0, 0], [8, 0, 0], [10, 0x40, 0]]; }
  static get X_TABLE() { return [[3, 0xC0, 0xFF], [9, 0, 0], [10, 0, 0], [16, 0x40, 0]]; }

  /**
   * One frame.
   * @param {Object} s - The cave state (CaveScan.create).
   * @param {Function} rand - rand(site) → 0–255.
   */
  static step(s, rand) {
    // the writes into POKEY of the vertical blank land at the frame's start (M6)
    s.pokeyLine = 0;
    // ★ $1AA6: the background flashes for `flash` frames (luminance $F), else its luminance is 0
    if (s.flash) {
      s.bkLum = 0x0F;
      s.flash--;
    } else {
      s.bkLum = 0;
    }
    // ★ $1B40
    CaveFrame.magicWallStep(s, rand);
    // ★ $1B62: every other frame the tiles advance a frame (8 of them, $085C += 8)
    s.animToggle = (s.animToggle+1) & 0xFF;
    if (!(s.animToggle & 1)) {
      s.animPhase = (s.animPhase+8) & 0x3F;
      CaveFrame.animate(s, rand);
      CaveFrame.magicWallStep(s, rand);
    }
    // ★ $1814: the window follows Rockford — not in an intermission once he is born
    if (!s.intermission || s.birth != 0) {
      CaveFrame.scroll(s);
    }
    // ★ $192C: while the cover is up, its glyph rotates and rattles — AUDC3 = $AA, AUDF3 = RANDOM & $0F
    if (s.cover) {
      CaveScan.pokey(s, 5, 0xAA);
      CaveScan.pokey(s, 4, rand('1936') & 0x0F);
      s.coverRotation = (s.coverRotation+1) & 7;
    }
    // ★ $1B7E: the magic wall's time runs while it mills and the game is not paused
    if ((((s.paused ^ 1) & s.magicWall) & 0xFF) == 1) {
      s.magicWallSec = (s.magicWallSec+1) & 0xFF;
      if (s.magicWallSec == 60) {
        s.magicWallSec = 0;
        s.magicWallTime = (s.magicWallTime+1) & 0xFF;
        if (s.magicWallTime == s.raw[1]) {
          s.magicWall = 2;
        }
      }
    }
    // ★ $1127: a game second is 60 frames; before birth it counts the inbox down, after it the time
    s.tick = (s.tick+1) & 0xFF;
    if (s.tick == 60) {
      s.tick = 0;
      if (!s.paused) {
        if (s.beforeBirth) {
          CaveFrame.birthTick(s);
        } else {
          CaveFrame.timeTick(s);
        }
      }
    }
    // ★ $1ABF: every eighth frame the envelopes go out to the chip — channel 1
    // (AUDF1 = pitch, AUDC1 = distortion·16 + volume, the volume halves) and
    // channel 4 (the same from d, e, f; the volume counts down by one)
    s.sound.counter = (s.sound.counter+1) & 0xFF;
    if ((s.sound.counter & 7) == 0) {
      CaveScan.pokey(s, 0, s.sound.c);
      CaveScan.pokey(s, 1, (s.sound.a << 4)+s.sound.b);
      s.sound.b >>= 1;
      CaveScan.pokey(s, 6, s.sound.f);
      CaveScan.pokey(s, 7, (s.sound.d << 4)+s.sound.e);
      if (s.sound.e) {
        s.sound.e--;
      }
    }
    // ★ $159E: the bonus life flickers the space tile for 128 frames with RANDOM rows
    if (s.flicker) {
      if (s.flicker == 1) {
        s.flickerRows = null;                                     // ★ $1581: the glyph is cleared
      } else {
        var rows = [];
        for (var i = 0; i < 2; i++) {
          rows.push(rand('15AD'), rand('15B3'), rand('15B9'), rand('15BF'));
        }
        s.flickerRows = rows;
      }
      s.flicker--;
    }
  } // step

  /**
   * ★ $1B40: the magic wall — milling (1) animates its glyph and rattles
   * (RANDOM), expired (2) puts the plain wall back and goes quiet (3).
   */
  static magicWallStep(s, rand) {
    if (s.magicWall == 1) {
      CaveScan.pokey(s, 5, 0xA6);                                 // ★ $1B12: AUDC3 = $A6, AUDF3 = (RANDOM & 7) + $0A
      CaveScan.pokey(s, 4, (rand('1B17') & 7)+0x0A);
      s.magicWallFrame = s.animPhase & 0x1F;                      // ★ $1B22: rows $4760 + phase
    } else if (s.magicWall == 2) {
      s.magicWallFrame = -1;                                      // ★ $1AFD: the wall's own glyph
      CaveScan.pokey(s, 5, 0);                                    // ★ $1B54: quiet
      s.magicWall = 3;
    }
    // ★ $1B5E → $16FF: the anti-tamper check, not reproduced
  } // magicWallStep

  /**
   * ★ $1A35 → $1986: with the stick idle, once per cycle of the eight
   * frames (phase 0) Rockford blinks with probability 1/4 and starts or
   * stops tapping with probability 1/16; moving, he walks.
   */
  static animate(s, rand) {
    if (s.stick != 0x0F) {
      s.animBlink = 0;
      s.animTap = 0;
    } else if (s.animPhase == 0) {
      s.animBlink = 0;
      if ((rand('19D9') & 3) == 0) {
        s.animBlink = 1;
      }
      if ((rand('19E5') & 0x0F) == 0) {
        s.animTap ^= 1;
      }
    }
  } // animate

  /**
   * ★ $1814: the window. Its position is in characters (half cells) with an
   * 8-bit fraction; the velocity is ±1/4 character a frame and is set when
   * Rockford's position in the window crosses the thresholds of the
   * tables, cleared when he is back in the middle (x 9–10, y 7–8), and
   * stopped at the edges. HSCROL/VSCROL come out of the fractions.
   */
  static scroll(s) {
    var sc = s.scroll;
    // ★ $15FF
    var relX = (s.rockfordX-(sc.x >> 1)) & 0xFF;
    var relY = (s.rockfordY-(sc.y >> 1)) & 0xFF;
    // ★ $17E3 / $1790
    CaveFrame.Y_TABLE.forEach((entry) => {
      if (relY == entry[0]) {
        sc.vyLo = entry[1]; sc.vy = entry[2];
      }
    });
    if (((relY-11) & 0xFF) < 0x80) { sc.vyLo = 0x40; sc.vy = 0; }
    if (((relY-5) & 0xFF) >= 0x80) { sc.vyLo = 0xC0; sc.vy = 0xFF; }
    // ★ $17FB / $17C0
    CaveFrame.X_TABLE.forEach((entry) => {
      if (relX == entry[0]) {
        sc.vxLo = entry[1]; sc.vx = entry[2];
      }
    });
    if (((relX-17) & 0xFF) < 0x80) { sc.vxLo = 0x40; sc.vx = 0; }
    if (((relX-3) & 0xFF) >= 0x80) { sc.vxLo = 0xC0; sc.vx = 0xFF; }
    // ★ $1734: the edges — 0 and 21 rows, 0 and 40 characters
    if (sc.yLo == 0) {
      if (sc.y == 0 && sc.vy != 0) { sc.vyLo = 0; sc.vy = 0; }
      if (sc.y == 0x15 && sc.vy == 0) { sc.vyLo = 0; sc.vy = 0; }
    }
    if (sc.xLo == 0) {
      if (sc.x == 0 && sc.vx != 0) { sc.vxLo = 0; sc.vx = 0; }
      if (sc.x == 0x28 && sc.vx == 0) { sc.vxLo = 0; sc.vx = 0; }
    }
    // ★ $169E
    var sum = sc.xLo+sc.vxLo, carry = sum > 0xFF ? 1 : 0;
    sc.xLo = sum & 0xFF;
    var old = sc.x;
    sc.x = (old+sc.vx+carry) & 0xFF;
    sc.dx = (sc.x-old) & 0xFF;
    s.hscrol = (sc.xLo >> 6) ^ 3;
    // ★ $1673
    sum = sc.yLo+sc.vyLo; carry = sum > 0xFF ? 1 : 0;
    sc.yLo = sum & 0xFF;
    old = sc.y;
    sc.y = (old+sc.vy+carry) & 0xFF;
    sc.dy = (sc.y-old) & 0xFF;
    s.vscrol = sc.yLo >> 5;
    // ★ $1652: every row's LMS moves by dx characters and dy rows — the
    // model sets LMS = $5000 + 80 (row + y) + x, which is the same thing
  } // scroll

  /** ★ $110F: the inbox's countdown; at 0 the status line switches to the game's */
  static birthTick(s) {
    s.birth--;
    if (s.birth == 0) {
      s.sound.a = 0x08; s.sound.b = 0x0F; s.sound.c = 0x0A;    // ★ $1095 sound_enough, the birth's sound too
      s.beforeBirth = 0;
      s.statusInGame = true; s.statusText = null;               // ★ $111C: LMS → $080B (over any text of the cave's end)
    }
  } // birthTick

  /**
   * ★ $10F8: one second of the game — time − 1 ($10CE), the status line,
   * the seconds gone; when they reach the header's time the amoeba grows
   * fast (mask $0F); at 000 the cave is over, under 10 the clock ticks.
   */
  static timeTick(s) {
    CaveScan.addDigits(s.time, [9, 9, 9]);
    // ★ $10A5
    if (s.time[0] == 0 && s.time[1] == 0) {
      if (s.time[2] == 0) {
        s.caveOver = 2;
      } else {
        s.sound.c = (0x32+s.time[2]) & 0xFF; s.sound.a = 0x0A; s.sound.b = 0x0A;   // ★ $10BC: the clock ticks under 10 s
      }
    }
    CaveScan.statusTime(s);
    s.secondsGone = (s.secondsGone+1) & 0xFF;
    if (s.secondsGone == s.raw[1]) {
      s.amoebaMask = 0x0F;
    }
  } // timeTick

} // class CaveFrame

if (typeof self !== 'undefined') { self.CaveFrame = CaveFrame; } else if (typeof globalThis !== 'undefined') { globalThis.CaveFrame = CaveFrame; }
if (typeof module !== 'undefined' && module.exports) { module.exports = CaveFrame; }
