// begin code

/**
 * Loads a captured state of the original into an {@link Atari8Screen}: the
 * 64 KB of its memory, the ANTIC and GTIA registers as they stand after the
 * VBI, and its display list interrupts as data (`data/screen.json`,
 * tools/mkscreen.py).
 *
 * ★ **M1's path, kept as a reference.** Since M2 the game draws the cave
 * out of the original's tables (caveScreen.js, caveGen.js); this loader
 * and data/screen.json stay for tools/matchscreen.mjs, which checks the
 * library's ANTIC against an independent renderer on the original's own
 * memory, pixel by pixel. Nothing in app/ imports it any more.
 *
 * No DOM (R-001): the tools load it under Node.
 */
export class ScreenLoader {

  /**
   * Decodes the base64 memory image of a scene.
   * @param {Object} scene - The parsed data/screen.json.
   * @returns {Uint8Array} 65536 bytes.
   */
  static memoryOf(scene) {
    var binary = typeof atob === 'function' ? atob(scene.memory) : Buffer.from(scene.memory, 'base64').toString('binary');
    var bytes = new Uint8Array(65536);
    for (var i = 0; i < binary.length && i < 65536; i++) {
      bytes[i] = binary.charCodeAt(i) & 0xFF;
    }
    return bytes;
  } // memoryOf

  /**
   * Puts the scene into the screen: memory, registers, DLI.
   * @param {Atari8Screen} screen - The machine.
   * @param {Object} scene - The parsed data/screen.json.
   * @returns {Atari8Screen} The screen.
   */
  static apply(screen, scene) {
    var r = scene.registers;
    screen.memory.set(ScreenLoader.memoryOf(scene), 0);
    screen.setDisplayList(r.dlist);
    screen.setRegister('dmactl', r.dmactl);
    screen.setRegister('chactl', r.chactl);
    screen.setCharsetPage(r.chbase);
    screen.setRegister('hscrol', r.hscrol);
    screen.setRegister('vscrol', r.vscrol);
    screen.setRegister('pmbase', r.pmbase);
    screen.setRegister('gractl', r.gractl);
    screen.setRegister('prior', r.prior);
    screen.setColor('colbk', r.colbk);
    for (var i = 0; i < 4; i++) {
      screen.setColor('colpf'+i, r.colpf[i]);
      screen.setColor('colpm'+i, r.colpm[i]);
    }
    screen.setDLI(scene.dli || []);
    return screen.touch();
  } // apply

} // ScreenLoader
