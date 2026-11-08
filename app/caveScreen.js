// begin code

/**
 * The cave on the machine's screen, built the way the original builds it:
 * the character sets at $4000, the display list at $5EA0, the status line
 * buffers at $080B/$081F, and the grid drawn as 2 × 2 tiles into $5003.
 *
 * ★ Everything here is an address or a rule read out of the program
 * (sources/docs/disasm_notes.md §9, data/global.json, data/charset.json,
 * data/texts.json — each made by a tools/dump* out of the reference image)
 * and checked by tools/matchcavegen.mjs against the screen memory of the
 * running original for 100 caves. Nothing is drawn that the original does
 * not draw. No DOM (R-001): the model and the tools share this file.
 *
 * M3 added what the original rewrites while a cave runs, each a pure
 * function of what the worker decided (caveScan.js, caveFrame.js): the
 * tiles as drawn with the cover glyph (drawTiles), the margin, the window
 * — LMS of every row plus HSCROL/VSCROL (setWindow) —, the glyphs of set B
 * (animate) and the status line in the game. Checked frame by frame and
 * pass by pass by tools/matchscan.mjs.
 */
export class CaveScreen {

  /** ★ $3C40 → base char; tile = c, c+1, c+16, c+17 ($0BA3) */
  static tileChars(tiles, object) {
    var c = tiles.base[object & 0x3F];
    return [c, (c+1) & 0xFF, (c+16) & 0xFF, (c+17) & 0xFF];
  } // tileChars

  static bytesOfBase64(text) {
    var binary = typeof atob === 'function' ? atob(text) : Buffer.from(text, 'base64').toString('binary');
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i) & 0xFF;
    }
    return bytes;
  } // bytesOfBase64

  static bytesOfHex(hex) {
    var out = new Uint8Array(hex.length/2);
    for (var i = 0; i < out.length; i++) {
      out[i] = parseInt(hex.substr(2*i, 2), 16);
    }
    return out;
  } // bytesOfHex

  static address(text) {
    return parseInt(String(text).replace('$', ''), 16);
  } // address

  /**
   * Puts the fixed part of the cave screen into the machine: character sets,
   * display list, margins, registers.
   * @param {Atari8Screen} screen - The machine.
   * @param {Object} charset - data/charset.json.
   * @param {Object} global - data/global.json.
   * @returns {Atari8Screen} The screen.
   */
  static build(screen, charset, global, texts) {
    charset.blocks.forEach((block) => {
      screen.write(CaveScreen.address(block.address), CaveScreen.bytesOfBase64(block.data));
    });
    // ★ $0A18–$0B27: the texts the status line's LMS can point at (GAME OVER, OUT OF TIME, BONUS LIFE …)
    if (texts) {
      texts.strings.forEach((t) => screen.write(CaveScreen.address(t.address), CaveScreen.bytesOfHex(t.raw)));
    }
    var dl = CaveScreen.address(global.displayList.address);
    screen.write(dl, CaveScreen.bytesOfHex(global.displayList.raw));
    // ★ $25A1: the status line before birth is the $081F buffer
    var status = CaveScreen.address(global.displayList.statusBeforeBirth);
    screen.poke(CaveScreen.address(global.displayList.statusLms), status & 0xFF);
    screen.poke(CaveScreen.address(global.displayList.statusLms)+1, status >> 8);
    CaveScreen.drawMargin(screen, global, global.caveScreen.margin.value);
    var r = global.caveStart;
    screen.setDisplayList(dl);
    screen.setRegister('dmactl', r.dmactl);
    screen.setRegister('chactl', r.chactl);
    screen.setCharsetPage(r.chbase);
    screen.setRegister('hscrol', r.hscrol);
    screen.setRegister('vscrol', r.vscrol);
    screen.setRegister('pmbase', r.pmbase);
    screen.setRegister('gractl', r.gractl);
    screen.setRegister('prior', r.prior);
    screen.setDLI(r.dli);
    return screen;
  } // build

  /**
   * ★ $1E71: the five colour bytes of the header go to COLOR0–4.
   * @param {Atari8Screen} screen - The machine.
   * @param {Array} colors - header[$13..$17].
   */
  static applyColors(screen, colors) {
    for (var i = 0; i < 4; i++) {
      screen.setColor('colpf'+i, colors[i]);
    }
    screen.setColor('colbk', colors[4]);
  } // applyColors

  /**
   * ★ $1954 / $0BDC: every cell of rows 2..23 of the grid as a 2 × 2 tile at
   * $5003 + 160 × row + 2 × column.
   * @param {Atari8Screen} screen - The machine.
   * @param {Uint8Array} grid - 40 × 24 object codes.
   * @param {Object} charset - data/charset.json.
   * @param {Object} global - data/global.json.
   */
  static drawGrid(screen, grid, charset, global) {
    var base = CaveScreen.address(global.caveScreen.base);
    var stride = global.caveScreen.rowStride, tileRow = global.caveScreen.tileRow;
    var width = global.grid.width, first = global.grid.caveRows[0];
    var memory = screen.memory;
    for (var row = 0; row < global.caveScreen.rows; row++) {
      var line = base+row*stride;
      for (var col = 0; col < width; col++) {
        var c = charset.tiles.base[grid[(row+first)*width+col] & 0x3F];
        var a = line+2*col;
        memory[a] = c;
        memory[a+1] = (c+1) & 0xFF;
        memory[a+tileRow] = (c+16) & 0xFF;
        memory[a+tileRow+1] = (c+17) & 0xFF;
      }
    }
  } // drawGrid

  /**
   * ★ $18BF: the margin bytes around the cave picture — $4A once the first
   * cave was fully drawn; before that (the first cave after power-on) they
   * are the zeros of the boot.
   * @param {Atari8Screen} screen - The machine.
   * @param {Object} global - data/global.json.
   * @param {number} value - The byte.
   */
  static drawMargin(screen, global, value, top) {
    global.caveScreen.margin.ranges.forEach((range) => {
      var ends = range.split('–').map(CaveScreen.address);
      for (var a = ends[0]; a <= ends[1]; a++) {
        screen.poke(a, value);
      }
    });
    // ★ $5000–$5002 one by one: the covering $1870 can put the cover glyph there (M5)
    if (top) {
      var base = CaveScreen.address(global.caveScreen.base)-3;
      top.forEach((byte, i) => screen.poke(base+i, byte));
    }
  } // drawMargin

  /**
   * ★ $1870: the characters that got the cover glyph this frame — single
   * characters of the window, not tiles (M5).
   * @param {Atari8Screen} screen - The machine.
   * @param {Array} addresses - Absolute addresses.
   * @param {Object} global - data/global.json.
   */
  static coverChars(screen, addresses, global) {
    var glyph = global.caveScreen.covered.char;
    addresses.forEach((a) => screen.poke(a, glyph));
  } // coverChars

  /**
   * ★ $0BDC / $1852: the tiles as the original drew them — the tile of the
   * object code in `tiles`, or the cover glyph $7C where the cell is still
   * covered (CaveScan.COVERED).
   * @param {Atari8Screen} screen - The machine.
   * @param {Uint8Array} tiles - 40 × 24 drawn codes (caveScan.js).
   * @param {Object} charset - data/charset.json.
   * @param {Object} global - data/global.json.
   */
  static drawTiles(screen, tiles, charset, global) {
    var base = CaveScreen.address(global.caveScreen.base);
    var stride = global.caveScreen.rowStride, tileRow = global.caveScreen.tileRow;
    var width = global.grid.width, first = global.grid.caveRows[0];
    var covered = global.caveScreen.covered.char;
    var memory = screen.memory;
    for (var row = 0; row < global.caveScreen.rows; row++) {
      var line = base+row*stride;
      for (var col = 0; col < width; col++) {
        var code = tiles[(row+first)*width+col];
        var a = line+2*col;
        if (code == 0xFF) {
          memory[a] = covered; memory[a+1] = covered; memory[a+tileRow] = covered; memory[a+tileRow+1] = covered;
          continue;
        }
        var c = charset.tiles.base[code & 0x3F];
        memory[a] = c;
        memory[a+1] = (c+1) & 0xFF;
        memory[a+tileRow] = (c+16) & 0xFF;
        memory[a+tileRow+1] = (c+17) & 0xFF;
      }
    }
  } // drawTiles

  /**
   * ★ $0BC1 / $0BA3: the four screen addresses of a grid cell's tile.
   * @param {number} index - Grid index (row × 40 + column, rows 2..23).
   * @param {Object} global - data/global.json.
   * @returns {Array} The addresses of c, c+1, c+16, c+17.
   */
  static cellAddresses(index, global) {
    var width = global.grid.width, first = global.grid.caveRows[0];
    var row = Math.floor(index/width)-first, col = index % width;
    var a = CaveScreen.address(global.caveScreen.base)+row*global.caveScreen.rowStride+2*col;
    return [a, a+1, a+global.caveScreen.tileRow, a+global.caveScreen.tileRow+1];
  } // cellAddresses

  /**
   * ★ $1652 / $16C6 / $169A: the window — every row's LMS is the cave
   * picture at (x characters, y character rows) from the top left, plus the
   * fine scroll registers.
   * @param {Atari8Screen} screen - The machine.
   * @param {Object} window - {x, y, hscrol, vscrol} (caveFrame.js).
   * @param {Object} global - data/global.json.
   */
  static setWindow(screen, window, global) {
    var dl = CaveScreen.address(global.displayList.address);
    var base = 0x5000+global.caveScreen.tileRow*window.y+window.x;
    for (var row = 0; row < 24; row++) {
      var lms = (base+global.caveScreen.tileRow*row) & 0xFFFF;
      screen.poke(dl+7+3*row, lms & 0xFF);
      screen.poke(dl+8+3*row, lms >> 8);
    }
    screen.setRegister('hscrol', window.hscrol);
    screen.setRegister('vscrol', window.vscrol);
  } // setWindow

  /**
   * ★ $1A35 / $1986 / $1B12 / $1AFD / $192C / $159E: the glyphs of set B
   * that the original rewrites every frame — the animated tiles from block
   * C by the phase, Rockford from $3D00–$3FFF by direction, blinking and
   * tapping, the magic wall, the rotating cover glyph, the flickering
   * space of a bonus life. Everything is copied from the dumped data, so
   * the set is a pure function of `anim`.
   * @param {Atari8Screen} screen - The machine.
   * @param {Object} charset - data/charset.json.
   * @param {Object} anim - {phase, moving, facing, blink, tap, magicWallFrame, coverRotation, flickerRows}.
   */
  static animate(screen, charset, anim) {
    var data = CaveScreen.charsetData(charset);
    var blockB = data.blockB, blockC = data.blockC, rockford = data.rockford;
    var m = screen.memory;
    var x = (anim.phase*2) & 0xFF;
    for (var y = 0; y < 8; y++) {
      // ★ $1A3C: diamond $48, tile $40, butterfly $20, firefly $64
      m[0x4640+y] = blockC[0x200+x+y]; m[0x4648+y] = blockC[0x208+x+y]; m[0x46C0+y] = blockC[0x280+x+y]; m[0x46C8+y] = blockC[0x288+x+y];
      m[0x4600+y] = blockC[0x000+x+y]; m[0x4608+y] = blockC[0x008+x+y]; m[0x4680+y] = blockC[0x080+x+y]; m[0x4688+y] = blockC[0x088+x+y];
      m[0x4500+y] = blockC[0x300+x+y]; m[0x4508+y] = blockC[0x308+x+y]; m[0x4580+y] = blockC[0x380+x+y]; m[0x4588+y] = blockC[0x388+x+y];
      m[0x4720+y] = blockC[0x100+x+y]; m[0x4728+y] = blockC[0x108+x+y]; m[0x47A0+y] = blockC[0x180+x+y]; m[0x47A8+y] = blockC[0x188+x+y];
      // ★ $1986: Rockford $4C — walking right ($3F00) or left ($3E00); idle: the still glyphs $42/$43/$52/$53, blink $3D00, tap $3D80
      if (anim.moving) {
        var walk = anim.facing ? 0x100 : 0x200;
        m[0x4660+y] = rockford[walk+x+y]; m[0x4668+y] = rockford[walk+8+x+y];
        m[0x46E0+y] = rockford[walk+0x80+x+y]; m[0x46E8+y] = rockford[walk+0x88+x+y];
      } else {
        if (anim.blink) {
          m[0x4660+y] = rockford[x+y]; m[0x4668+y] = rockford[8+x+y];
        } else {
          m[0x4660+y] = blockB[0x210+y]; m[0x4668+y] = blockB[0x218+y];
        }
        if (anim.tap) {
          m[0x46E0+y] = rockford[0x80+x+y]; m[0x46E8+y] = rockford[0x88+x+y];
        } else {
          m[0x46E0+y] = blockB[0x290+y]; m[0x46E8+y] = blockB[0x298+y];
        }
      }
      // ★ $1B12 / $1AFD: the magic wall $22 — milling from $4760 + phase, else the wall's glyph $4670
      var wall = anim.magicWallFrame >= 0 ? blockB[0x360+anim.magicWallFrame+y] : blockB[0x270+y];
      m[0x4510+y] = wall; m[0x4518+y] = wall; m[0x4590+y] = wall; m[0x4598+y] = wall;
      // ★ $192C: the cover glyph $7C rotates a row per frame
      m[0x47E0+y] = blockB[0x3E0+((y+anim.coverRotation) & 7)];
    }
    // ★ $15AD / $1581: rows 0 and 4 of the space tile $60 from RANDOM, or all of them cleared
    var rows = anim.flickerRows;
    [0x4700, 0x4708, 0x4780, 0x4788].forEach((a, i) => {
      m[a] = rows ? rows[i] : blockB[a-0x4400];
      m[a+4] = rows ? rows[4+i] : blockB[a+4-0x4400];
    });
  } // animate

  /**
   * The decoded blocks of data/charset.json, once.
   * @param {Object} charset - data/charset.json.
   * @returns {Object} {blockB, blockC, rockford} as bytes.
   */
  static charsetData(charset) {
    if (!charset._decoded) {
      var block = (address) => CaveScreen.bytesOfBase64(charset.blocks.find((b) => b.address == address).data);
      charset._decoded = {blockB: block('$4400'), blockC: block('$4800'), rockford: CaveScreen.bytesOfBase64(charset.rockfordFrames.data)};
    }
    return charset._decoded;
  } // charsetData

  /**
   * ★ $111C / $25A1: which status buffer the display list shows.
   * @param {Atari8Screen} screen - The machine.
   * @param {Object} global - data/global.json.
   * @param {boolean} inGame - The game's buffer ($080B) or the one before birth ($081F).
   */
  static showStatus(screen, global, inGame, text, texts) {
    var status = CaveScreen.address(inGame ? global.displayList.statusInGame : global.displayList.statusBeforeBirth);
    // ★ $1F67 / $1FB8 / $1FF7: a text of the cave's end over either buffer (M5)
    if (text && texts) {
      var t = texts.strings.find((x) => x.key == text);
      if (t) status = CaveScreen.address(t.address);
    }
    screen.poke(CaveScreen.address(global.displayList.statusLms), status & 0xFF);
    screen.poke(CaveScreen.address(global.displayList.statusLms)+1, status >> 8);
  } // showStatus

  /**
   * ★ $081F: the status line before birth as the game keeps it (patched at
   * every cave's end, $282B — M5).
   */
  static statusBeforeBirthBytes(screen, global, bytes) {
    screen.write(CaveScreen.address(global.displayList.statusBeforeBirth), Uint8Array.from(bytes));
  } // statusBeforeBirthBytes

  /**
   * ★ $080B: the status line in the game, as the worker keeps it.
   * @param {Atari8Screen} screen - The machine.
   * @param {Object} global - data/global.json.
   * @param {Uint8Array|Array} status - 20 bytes.
   */
  static statusInGame(screen, global, status) {
    screen.write(CaveScreen.address(global.displayList.statusInGame), Uint8Array.from(status));
  } // statusInGame

  /**
   * The whole cave at the start, for the screens that only show it (menu,
   * about): build, generate, draw, colour, status line.
   * @param {Atari8Screen} screen - The machine.
   * @param {Object} data - {caves, charset, global, texts} (data/*.json).
   * @param {Function} generator - CaveGen (app/caveGen.js, a classic script).
   * @param {number} caveNumber - ★ $07B7, 1–20.
   * @param {number} levelIndex - ★ $07B8, 0–4.
   * @returns {Object} What CaveGen.generate returned.
   */
  static present(screen, data, generator, caveNumber, levelIndex) {
    var cave = data.caves.caves[caveNumber-1];
    var made = generator.generate(generator.bytesOf(cave.raw), levelIndex);
    CaveScreen.build(screen, data.charset, data.global);
    CaveScreen.applyColors(screen, cave.header.colors);
    CaveScreen.drawGrid(screen, made.grid, data.charset, data.global);
    CaveScreen.statusBeforeBirth(screen, data.texts, data.global, {player: 1, lives: 3, caveNumber: caveNumber, level: levelIndex});
    screen.touch();
    return made;
  } // present

  /**
   * Reads the four data files the cave screen needs.
   * @param {Function} load - model.loadDataFile.
   * @returns {Object|null} {caves, charset, global, texts}, or null when one is missing.
   */
  static loadData(load) {
    var data = {caves: load('caves'), charset: load('charset'), global: load('global'), texts: load('texts')};
    return (data.caves && data.charset && data.global && data.texts) ? data : null;
  } // loadData

  /**
   * ★ $2925 + $282B–$2883: the status line before birth, "PLAYER 1, 3 MEN
   * A/1", patched at the offsets the code patches.
   * @param {Atari8Screen} screen - The machine.
   * @param {Object} texts - data/texts.json.
   * @param {Object} global - data/global.json.
   * @param {Object} state - {player 1–2, lives, caveNumber 1–20, level 0–4}.
   */
  static statusBeforeBirth(screen, texts, global, state) {
    var template = texts.strings.find((s) => s.key == texts.statusLine.beforeBirth.template);
    var buffer = CaveScreen.address(texts.statusLine.beforeBirth.buffer);
    var bytes = CaveScreen.bytesOfHex(template.raw);
    bytes[7] = (state.player-1+0x91) & 0xFF;
    bytes[10] = (state.lives+0x90) & 0xFF;
    bytes[13] = state.lives == 1 ? 0xA1 : 0xA5;
    bytes[16] = (state.caveNumber+0xA0) & 0xFF;
    bytes[18] = (state.level+0x91) & 0xFF;
    screen.write(buffer, bytes);
  } // statusBeforeBirth

} // class CaveScreen
