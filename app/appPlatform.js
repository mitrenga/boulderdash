const { Atari8Platform } = await import('./svision/js/platform/canvas2D/atari8/atari8Platform.js?ver='+window.srcVersion);
// begin code

/**
 * An Atari 800XL on a PAL television (R-039, the reference machine of the
 * remake): square pixels and a border in the colour of COLBK — the same
 * register that colours the background inside, so the game sets both
 * together.
 *
 * ★ The desktop is **200 of the frame's 240 scan lines, from line 24**,
 * because that is what the original's display list draws: 24 blank lines,
 * the status row in mode 6, 24 rows of the cave in mode 4, and then the
 * list ends 16 lines short of the frame. ANTIC still makes all 240 — the
 * machine is untouched — but the 40 lines nothing is drawn on are border
 * here instead of a band inside the picture, which is what a television
 * did with them, and which buys a whole step of the integer ratio on a
 * small display.
 */
export function appPlatform() {
  return new Atari8Platform({
    width: 320,
    height: 200,
    firstLine: 24,
    pixelAspect: 1,
    minimalBorder: 8
  });
} // appPlatform
