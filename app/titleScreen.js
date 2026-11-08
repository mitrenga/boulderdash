const { CaveScreen } = await import('./caveScreen.js?ver='+window.srcVersion);
// begin code

/**
 * The title screen on the machine's screen, built the way the original
 * builds it (★ sources/asm/main.asm `$2252`, `$25C3`; data/title.json by
 * tools/dumptitle.py): the logo BOULDER DASH as 19 rows of mode 4 at
 * `$4C00` — the same memory the cave's grid lives in during a game —
 * composed out of character set A's own bytes, and the FIRST STAR logo as
 * two blocks of mode E bitmap (`$2D80`, `$3000`) through the display list
 * at `$0961`. Colours `$25BE`, CHBAS `$40`, no DLI.
 *
 * ★ The shimmer: every other frame the vertical blank (`$2425`) rotates
 * character 0 of set A by one row (`$15D1`) and recomposes characters 9
 * and 10 as characters 6 and 7 OR character 0 (`$240A`); the logo is made
 * of those. Character 0 is zero in the file and after every cave
 * (`$2918`); `menu_start` (`$2554`), which runs right after the title's
 * first frame, copies character 11 into it — so the first frame of the
 * title never shimmers, the rest do.
 *
 * Nothing is drawn that the original does not draw; tools/matchtitle.mjs
 * checks the memory, the registers and the animation against the running
 * original. No DOM (R-001): the model and the tools share this file.
 */
export class TitleScreen {

  /** ★ neighbours `$2098`: the step of draw_run per direction (0 up, 2 right, 4 down, 6 left) */
  static get STEPS() { return {0: -40, 2: 1, 4: 40, 6: -1}; }

  /**
   * Reads the data files the title needs.
   * @param {Function} load - model.loadDataFile.
   * @returns {Object|null} {charset, global, texts, title}, or null when one is missing.
   */
  static loadData(load) {
    var data = {charset: load('charset'), global: load('global'), texts: load('texts'), title: load('title')};
    return (data.charset && data.global && data.texts && data.title) ? data : null;
  } // loadData

  /**
   * ★ The data of the tune $23A0 for the worker (CaveRules.titleStep):
   * the 256 bytes at $2328 (data/global.json title.notes) and the page of
   * notes = the first 256 bytes of character set B at $4400.
   * @param {Object} global - data/global.json.
   * @param {Object} charset - data/charset.json.
   * @returns {Object|null} {notes, page}, or null when the dumps lack it.
   */
  static tuneData(global, charset) {
    var title = global && global.title;
    var blockB = charset && charset.blocks && charset.blocks.find((b) => b.address == '$4400');
    if (!title || !title.notes || !blockB) {
      return null;
    }
    return {notes: Array.from(CaveScreen.bytesOfHex(title.notes)), page: Array.from(CaveScreen.bytesOfBase64(blockB.data)).slice(0, 256)};
  } // tuneData

  /**
   * Puts the whole title into the machine: character sets, the texts, the
   * display list, the bitmaps, the logo, the registers and the colours.
   * @param {Atari8Screen} screen - The machine.
   * @param {Object} data - {charset, global, texts, title}.
   * @returns {Atari8Screen} The screen.
   */
  static build(screen, data) {
    var title = data.title;
    // the character sets as the file has them; the texts the menu rows point at (not shown by this display list)
    data.charset.blocks.forEach((block) => {
      screen.write(CaveScreen.address(block.address), CaveScreen.bytesOfBase64(block.data));
    });
    if (data.texts) {
      data.texts.strings.forEach((t) => screen.write(CaveScreen.address(t.address), CaveScreen.bytesOfHex(t.raw)));
    }
    // ★ $2918 / the file: character 0 of set A is zero until menu_start copies character 11 (step)
    screen.write(CaveScreen.address(data.charset.blocks[0].address), new Uint8Array(8));
    var dl = CaveScreen.address(title.displayList.address);
    screen.write(dl, CaveScreen.bytesOfHex(title.displayList.raw));
    title.bitmaps.forEach((bitmap) => {
      screen.write(CaveScreen.address(bitmap.address), CaveScreen.bytesOfHex(bitmap.raw));
    });
    TitleScreen.drawLogo(screen, data.charset, title);
    var r = title.registers;
    screen.setDisplayList(dl);
    screen.setRegister('dmactl', r.dmactl);
    screen.setRegister('chactl', r.chactl);
    screen.setCharsetPage(r.chbase);
    screen.setRegister('hscrol', r.hscrol);
    screen.setRegister('vscrol', r.vscrol);
    screen.setRegister('pmbase', r.pmbase);
    screen.setRegister('gractl', r.gractl);
    screen.setRegister('prior', r.prior);
    screen.setDLI(r.dli || []);
    CaveScreen.applyColors(screen, title.colors.values);
    return screen.touch();
  } // build

  /**
   * ★ $2252: the 19 rows at $4C00 — three double rows of $80, the logo out
   * of set A's block $4200–$43FF with bit 7, then the hollow rectangle of
   * object 3 ($2308 → ins_rect).
   * @param {Atari8Screen} screen - The machine.
   * @param {Object} charset - data/charset.json.
   * @param {Object} title - data/title.json.
   */
  static drawLogo(screen, charset, title) {
    var s = title.screen;
    var base = CaveScreen.address(s.address);
    var setA = CaveScreen.bytesOfBase64(charset.blocks[0].data);
    var setBase = CaveScreen.address(charset.blocks[0].address);
    s.fill.ranges.forEach((range) => {
      var bytes = new Uint8Array(range.length);
      bytes.fill(s.fill.value);
      screen.write(CaveScreen.address(range.address), bytes);
    });
    s.logo.copies.forEach((copy) => {
      var from = CaveScreen.address(copy.from)-setBase;
      var bytes = new Uint8Array(copy.length);
      for (var i = 0; i < copy.length; i++) {
        bytes[i] = setA[from+i] | s.logo.orBit;
      }
      screen.write(CaveScreen.address(copy.to), bytes);
    });
    // ★ ins_rect $2152: four runs of draw_run — right along the top, down the
    // right side, left along the bottom, up the left side; each writes
    // count-1 cells and leaves the pointer on the corner the next starts at
    var f = s.frame;
    var address = base+f.y*s.columns+f.x;
    [[2, f.width], [4, f.height], [6, f.width], [0, f.height]].forEach((run) => {
      for (var i = 0; i < run[1]-1; i++) {
        screen.poke(address, f.object);
        address += TitleScreen.STEPS[run[0]];
      }
    });
  } // drawLogo

  /**
   * The state of the title's vertical blank: the frame count and the
   * toggle `$085E` (its parity decides which frames rotate).
   * @param {number} toggle - The toggle's value before the first frame.
   * @returns {Object} The state.
   */
  static start(toggle) {
    return {frame: 0, toggle: toggle || 0};
  } // start

  /**
   * ★ One frame of the title ($2425 from the vertical blank, and what the
   * main loop did in between): the first frame only arms the loop
   * ($0877); from the second on character 0 holds character 11 ($2554),
   * the toggle counts, and on its even values character 0 rotates
   * ($15D1) and characters 9 and 10 are recomposed ($240A).
   * @param {Atari8Screen} screen - The machine.
   * @param {Object} charset - data/charset.json.
   * @param {Object} title - data/title.json.
   * @param {Object} state - Of start().
   * @returns {boolean} True when set A changed.
   */
  static step(screen, charset, title, state) {
    var a = title.animation;
    var setBase = CaveScreen.address(charset.blocks[0].address);
    state.frame++;
    if (state.frame == 1) {
      return false;
    }
    var changed = false;
    if (state.frame == 2) {
      var eleven = new Uint8Array(8);
      for (var i = 0; i < 8; i++) {
        eleven[i] = screen.peek(setBase+a.menuStart.from*8+i);
      }
      screen.write(setBase+a.menuStart.char*8, eleven);
      changed = true;
    }
    state.toggle = (state.toggle+1) & 0xFF;
    if (state.toggle & 1) {
      return changed;
    }
    var zero = setBase+a.rotate.char*8;
    var first = screen.peek(zero);
    for (var row = 0; row < 7; row++) {
      screen.poke(zero+row, screen.peek(zero+row+1));
    }
    screen.poke(zero+7, first);
    a.compose.forEach((c) => {
      for (var row = 0; row < 8; row++) {
        screen.poke(setBase+c.char*8+row, screen.peek(setBase+c.from*8+row) | screen.peek(zero+row));
      }
    });
    return true;
  } // step

} // class TitleScreen
