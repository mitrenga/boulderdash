// begin code

/**
 * The cave generator of the original, bit for bit — a classic script, so the
 * worker takes it with importScripts() and the tools through
 * app/svision/tools/classicScript.cjs (no import/export here, R-001).
 *
 * ★ Everything below is read out of the running program
 * (sources/asm/main.asm, sources/docs/disasm_notes.md §9) and proved by
 * tools/matchcavegen.mjs against the grid the original itself builds, for
 * all 20 caves × 5 difficulties:
 *
 * - **PRNG $0C01**: two bytes, seed1 at $0782 (starts 0) and seed2 at $0781
 *   (starts at header[$04 + level]); ROR/ADC dance with the constant $13.
 *   The same algorithm as the C64 port (Broadribb), which is why the cave
 *   data could be shared between the machines.
 * - **Random fill $1C02**: rows 1..21 of the loop land on grid rows 3..23
 *   ($1840 with A = 1 gives $4C4F, plus the cell offset $29 = $4C78 = row 3;
 *   the pointer then runs on, 40 cells a row), columns 0..39; every cell
 *   starts as dirt (1), then for
 *   each of the four random objects in header order the object is taken
 *   when the new seed1 is **below** its probability — the last one wins
 *   ($1BE8).
 * - **Steel frame $2235**: an open rectangle of object 7 at (0, 2) 40 × 22
 *   drawn **before** the instructions (the C64 decoder draws it after).
 * - **Instructions $21A8** from header offset $20 to $FF: bits 6–7 the type,
 *   bits 0–5 the object. Point (x, y); line (x, y, length, direction 0–7 from
 *   the neighbour table $2098); filled rectangle (x, y, w, h, fill: the
 *   border in the object, the inside in the fill — two fills, $2112); open
 *   rectangle (x, y, w, h: four lines of w−1, h−1, w−1, h−1, $2152). The
 *   counters are 8-bit and the loops stop on a negative byte, which is
 *   reproduced rather than tidied up. Object $25 records Rockford's start.
 *
 * The grid is 40 × 24 bytes of object codes like the original's $4C00; the
 * cave is rows 2..23. Rows 0–1 are left at zero (in the original they hold
 * what the title screen left there).
 */
class CaveGen {

  /** ★ $2098: word offsets over the 40-wide grid, indexed by direction 0–7 */
  static get DIRECTIONS() { return [-40, -39, 1, 41, 40, 39, -1, -41]; }

  static get WIDTH() { return 40; }
  static get ROWS() { return 24; }

  /**
   * ★ $0C01. One step of the generator; mutates and returns the state.
   * @param {Object} s - {seed1, seed2} — $0782 and $0781.
   * @returns {Object} The same state.
   */
  static nextRandom(s) {
    var temp1 = (s.seed1 & 1) << 7;                 // LDA $0782; ROR; ROR; AND #$80
    var temp2 = (s.seed2 >> 1) & 0x7F;              // LDA $0781; ROR; AND #$7F
    var sum = ((s.seed2 & 1) << 7) + s.seed2;       // LDA $0781; ROR; ROR; AND #$80; CLC; ADC $0781
    var carry = sum > 0xFF ? 1 : 0;
    sum = (sum & 0xFF) + 0x13 + carry;              // ADC #$13
    carry = sum > 0xFF ? 1 : 0;
    s.seed2 = sum & 0xFF;                           // STA $0781
    sum = s.seed1 + temp1 + carry;                  // LDA $0782; ADC $0783
    carry = sum > 0xFF ? 1 : 0;
    sum = (sum & 0xFF) + temp2 + carry;             // ADC $0784
    s.seed1 = sum & 0xFF;                           // STA $0782
    return s;
  } // nextRandom

  /**
   * Builds the cave the way $2645 does: header → random fill → steel frame →
   * instructions.
   * @param {Uint8Array|Array} raw - The cave's bytes (header + instructions + $FF).
   * @param {number} level - Difficulty index 0–4.
   * @returns {Object} {grid: Uint8Array(960), rockford: {x, y}, rand: [seed2, seed1]}
   */
  static generate(raw, level) {
    var W = CaveGen.WIDTH;
    var grid = new Uint8Array(W*CaveGen.ROWS);
    var s = {seed1: 0, seed2: raw[4+level]};
    var rockford = {x: 0, y: 0};

    // ★ $1C02: random fill of rows 3..23 (row 23 is then covered by the frame)
    for (var y = 1; y <= 21; y++) {
      for (var x = 0; x < W; x++) {
        var obj = 1;
        CaveGen.nextRandom(s);
        for (var i = 0; i < 4; i++) {
          if (s.seed1 < raw[0x1C+i]) {
            obj = raw[0x18+i];
          }
        }
        grid[(y+2)*W+x] = obj;
      }
    }

    var store = function(index, obj) {
      if (index >= 0 && index < grid.length) {
        grid[index] = obj;
      }
    };
    // ★ $20A8: `count` stores along a direction; DEC first, stop on negative
    var line = function(obj, index, count, direction) {
      var step = CaveGen.DIRECTIONS[direction & 7];
      while (true) {
        count = (count-1) & 0xFF;
        if (count & 0x80) {
          return;
        }
        store(index, obj);
        index += step;
      }
    };
    // ★ $20E5: h rows of w cells, right to left, row by row
    var fill = function(obj, index, w, h) {
      var rows = h;
      while (true) {
        rows = (rows-1) & 0xFF;
        if (rows & 0x80) {
          return;
        }
        var col = w;
        while (true) {
          col = (col-1) & 0xFF;
          if (col & 0x80) {
            break;
          }
          store(index+col, obj);
        }
        index += W;
      }
    };
    // ★ $2152: four sides of w−1, h−1, w−1, h−1 stores in directions 2, 4,
    // 6, 0; the pointer moves with the lines, so each side starts where the
    // previous one ended
    var rect = function(obj, index, w, h) {
      var sides = [[(w-1) & 0xFF, 2], [(h-1) & 0xFF, 4], [(w-1) & 0xFF, 6], [(h-1) & 0xFF, 0]];
      sides.forEach(function(side) {
        var count = side[0], step = CaveGen.DIRECTIONS[side[1]];
        while (true) {
          count = (count-1) & 0xFF;
          if (count & 0x80) {
            return;
          }
          store(index, obj);
          index += step;
        }
      });
    };

    // ★ $2235: the steel frame, before the instructions
    rect(7, 2*W, 40, 22);

    // ★ $21A8
    var p = 0x20;
    while (raw[p] != 0xFF) {
      var code = raw[p], obj = code & 0x3F, x = raw[p+1], y = raw[p+2];
      var index = y*W+x;
      if (obj == 0x25) {
        rockford = {x: x, y: y};
      }
      switch (code & 0xC0) {
        case 0x00:
          store(index, obj);
          p += 3;
          break;
        case 0x40:
          line(obj, index, raw[p+3], raw[p+4]);
          p += 5;
          break;
        case 0x80:
          fill(obj, index, raw[p+3], raw[p+4]);
          fill(raw[p+5], index+W+1, (raw[p+3]-2) & 0xFF, (raw[p+4]-2) & 0xFF);
          p += 6;
          break;
        default:
          rect(obj, index, raw[p+3], raw[p+4]);
          p += 5;
          break;
      }
    }

    return {grid: grid, rockford: rockford, rand: [s.seed2, s.seed1]};
  } // generate

  /**
   * Decodes the hex string of data/caves.json.
   * @param {string} hex - The cave's raw bytes.
   * @returns {Uint8Array} The bytes.
   */
  static bytesOf(hex) {
    var out = new Uint8Array(hex.length/2);
    for (var i = 0; i < out.length; i++) {
      out[i] = parseInt(hex.substr(2*i, 2), 16);
    }
    return out;
  } // bytesOf

} // class CaveGen

if (typeof self !== 'undefined') { self.CaveGen = CaveGen; }
if (typeof module !== 'undefined' && module.exports) { module.exports = CaveGen; }
