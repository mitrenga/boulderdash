const { AbstractAudioManager } = await import('./svision/js/audio/abstractAudioManager.js?ver='+window.srcVersion);
const { AudioChipHandler } = await import('./svision/js/audio/audioChipHandler.js?ver='+window.srcVersion);
const { AudioSilentHandler } = await import('./svision/js/audio/audioSilentHandler.js?ver='+window.srcVersion);
const { POKEY } = await import('./svision/js/audio/chip/pokey.js?ver='+window.srcVersion);
const { Tool } = await import('./svision/js/tool.js?ver='+window.srcVersion);
// begin code

/**
 * The sound of Boulder Dash: one bus, **`pokey`**, which is the machine's
 * chip itself (svision `audio/chip/pokey.js`, PAL clock) driven by the
 * register writes the worker reports frame by frame (`frame.pokey`,
 * WORKER-PROTOCOL.md) — ★ what the original writes into `$D200`–`$D208`
 * where it writes it, proved write by write by tools/matchsound.mjs (M6).
 * The stream runs in an AudioWorklet (svision `AudioChipHandler`,
 * `ChipStream`): the writes keep their place in the frame and the pass,
 * the audio thread keeps its own clock.
 *
 * One slider for the one bus (R-024: the volume cookie of the siblings,
 * `audioBusSoundsLevel`); the menu is silent, the bus opens in GameModel
 * behind the user's gesture. A browser without AudioWorklet gets the silent
 * handler.
 */
export class AudioManager extends AbstractAudioManager {

  /**
   * ★ The bus of the chip: the PAL POKEY at 1.77 MHz, 50 frames of 312
   * scanlines a second, the writes placed 60 ms ahead of the audio thread.
   * `gain` 3 puts one channel at full volume at 0.75 of full scale, in the
   * loudness of the beeper games at the same slider.
   */
  static get POKEY_OPTIONS() {
    return {chip: 'POKEY', chipSource: 'audio/chip/pokey.js', clock: POKEY.CLOCK_PAL, rate: 50, lines: 312, latency: 0.06, maxLead: 0.25, gain: 3};
  } // POKEY_OPTIONS

  constructor(app) {
    super(app);
    this.id = 'AudioManager';
    this.volume = {};
    this.volume.pokey = Math.min(10, Math.max(0, Math.round(Number(Tool.readCookie('audioBusSoundsLevel', 5)))));
  } // constructor

  /**
   * The handler of the `pokey` bus: the chip in a worklet at the slider's
   * level, or the silent one at 0 (unless the volume dialog says otherwise)
   * or when the worklet is not supported. The chip's options are the bus's
   * own, whoever opens it (the game, the volume dialog).
   */
  createAudioHandler(bus, options) {
    if (bus != 'pokey') {
      return false;
    }
    var volume = this.volumeLevel(this.volume.pokey);
    if (options.audioSilentHandler != 'disable' && volume == 0.0) {
      return new AudioSilentHandler(this.app);
    }
    if (this.unsupportedAudioBus === false) {
      this.unsupportedAudioBus = Tool.readCookie('unsupportedAudioBus', false);
    }
    if (this.unsupportedAudioBus !== false) {
      Tool.writeCookie('unsupportedAudioBus', 'AudioChipHandler');
      return new AudioSilentHandler(this.app);
    }
    Object.assign(options, AudioManager.POKEY_OPTIONS);
    var handler = new AudioChipHandler(this.app);
    handler.setBusVolume(volume);
    return handler;
  } // createAudioHandler

  /** the slider's ten steps as a gain, the table of the sibling remakes */
  volumeLevel(volume) {
    var levels = [0, 0.005, 0.01, 0.02, 0.04, 0.07, 0.1, 0.14, 0.18, 0.23, 0.29];
    return levels[volume];
  } // volumeLevel

  /**
   * The sample of the volume dialog: a script of frames of writes — ★ a
   * diamond collected ($11F3: channel 1 a pure tone $64, volume 10 halving
   * every eighth frame, $1ABF) and Rockford walking ($1225: AUDF2 = $CC,
   * the envelope of channel 2 up to 15 over the rows of a pass, $1385).
   */
  audioData(bus, sound, options) {
    var data = super.audioData(bus, sound, options);
    if (data !== false) {
      return data;
    }
    if (bus == 'pokey' && sound == 'exampleSound') {
      var frames = [];
      var a = 0x0A, b = 0x0A, c = 0x64;
      var envelope = 0x41;
      for (var f = 0; f < 60; f++) {
        var writes = [];
        if (f == 0) {
          writes.push([0, 2, 0xCC]);
        }
        if (f < 20) {
          // three rows of the pass a frame: the envelope of channel 2
          for (var row = 0; row < 3 && envelope != 0x40; row++) {
            envelope = (envelope+1) & 0x4F;
            writes.push([Math.round(row*104), 3, envelope]);
          }
        }
        if ((f & 7) == 0) {
          writes.push([0, 0, c], [0, 1, (a << 4)+b]);
          b >>= 1;
        }
        frames.push(writes);
      }
      frames.push([[0, 1, 0], [0, 3, 0]]);
      return {script: frames};
    }
    return false;
  } // audioData

} // AudioManager
