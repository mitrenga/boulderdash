const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { BorderEntity } = await import('./borderEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { Atari8ScreenEntity } = await import('./svision/js/platform/canvas2D/atari8/atari8ScreenEntity.js?ver='+window.srcVersion);
const { Atari8Color } = await import('./svision/js/platform/canvas2D/atari8/atari8Color.js?ver='+window.srcVersion);
const { TitleScreen } = await import('./titleScreen.js?ver='+window.srcVersion);
const { PauseGameEntity } = await import('./pauseGameEntity.js?ver='+window.srcVersion);
// begin code

/**
 * The title screen — ★ what the original shows from power-on and after
 * every GAME OVER (`$25C3` out of the main loop `$28F3`): the logo BOULDER
 * DASH out of character set A, the FIRST STAR logo in mode E
 * (titleScreen.js, data/title.json) and the tune `$23A0`, which the worker
 * plays frame by frame as writes into POKEY (CaveRules.titleStart /
 * titleStep, proved by tools/matchsound.mjs, M6). The picture shimmers
 * every other frame the way the vertical blank makes it (TitleScreen.step)
 * — drawn on the worker's frame, the loop only as a backup (R-037).
 *
 * The menu's START GAME opens it (as Manic Miner's does): the trigger —
 * the fire key, Enter, the gamepad, a click or a touch — starts the game
 * with the menu's choices (★ the trigger in the original's menu), Escape
 * opens the OPTIONS panel (PauseGameEntity, as in Manic Miner) whose EXIT
 * goes back to the menu; the tune plays on under it. ★ Left alone, the title turns into the demo when
 * the tune has played twice
 * ($23FD: the second wrap of the index of notes, 2 041 frames) — the
 * worker says so (`demo`) and the demo starts as on the machine.
 *
 * The sound is the POKEY bus (R-024): the browser lets it run after the
 * user's first gesture, until then the chip keeps its place in the tune.
 */
export class MainModel extends AbstractModel {

  constructor(app) {
    super(app);
    this.id = 'MainModel';

    this.worker = null;
    this.screenEntity = null;
    this.screen = null;
    this.data = null;
    this.animation = null;
    this.needDraw = true;
    /** the luminance of COLBK, for the border's X (white on the title's black) */
    this.borderLuminance = 0;
  } // constructor

  newBorderEntity() {
    return new BorderEntity(true, false);
  } // newBorderEntity

  init() {
    super.init();

    // the data files: at once from localStorage, or from the server when they
    // are missing there (R-062)
    this.loadDataFiles(['charset', 'global', 'texts', 'title'], (files, error) => this.initData(files, error));
  } // init

  /**
   * The part of init() that needs the data files. Runs inside init() when
   * they are in localStorage, later when they had to come from the server.
   * @param {Object|null} files - The data files, or null.
   * @param {Error} [error] - Why they are missing.
   */
  initData(files, error) {
    if (this.app.model !== this) {
      return;
    }
    if (!files) {
      this.app.showErrorMessage(error ? error.message : 'Game data could not be loaded.', 'restart');
    }
    this.data = TitleScreen.loadData((key) => this.loadDataFile(key));
    if (!this.data) {
      this.desktopEntity.bkColor = Atari8Color.color(0x00);
      this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.atari8Fonts8x8, 0, 8*8, this.desktopWidth, 8, 'BOULDER DASH', Atari8Color.color(0x0E), false, {align: 'center'}));
      this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.fonts5x5, 8, 8*8+16, this.desktopWidth-16, 40,
        'GAME DATA MISSING (data/charset, global, texts, title). RUN tools/dump*.py.', Atari8Color.color(0xCA), false, {align: 'center', textWrap: true}));
      return;
    }
    this.screenEntity = new Atari8ScreenEntity(this.desktopEntity, 0, 0, this.desktopWidth, this.desktopHeight);
    this.desktopEntity.addEntity(this.screenEntity);
    this.screen = this.screenEntity.screen;
    try {
      TitleScreen.build(this.screen, this.data);
    } catch (error) {
      console.error(error.message);
    }
    this.animation = TitleScreen.start(0);
    // ★ COLBK on the border and under the frame, as in the game
    var bk = Atari8Color.color(this.screen.colbk);
    this.borderLuminance = this.screen.colbk & 15;
    this.borderEntity.bkColor = bk;
    this.desktopEntity.bkColor = bk;

    // ★ $2608: the tune starts with the title; the worker ticks it at 50 Hz
    // and reports the writes into POKEY (WORKER-PROTOCOL.md `title`)
    this.worker = this.app.worker;
    this.sendWorkerMessage({
      id: 'title',
      initData: {
        headless: false,
        hiScore: this.app.hiScore,
        tune: TitleScreen.tuneData(this.data.global, this.data.charset)
      }
    });
    this.sendEvent(0, {id: 'openAudioBus', bus: 'pokey', options: {}});
  } // initData

  shutdown() {
    super.shutdown();
    this.sendWorkerMessage({id: 'reset'});
  } // shutdown

  sendWorkerMessage(event) {
    if (this.worker) {
      this.worker.postMessage(event);
    }
  } // sendWorkerMessage

  handleWorkerMessage(event) {
    var data = event.data;
    switch (data.id) {
      case 'frame':
        if (this.screen && TitleScreen.step(this.screen, this.data.charset, this.data.title, this.animation)) {
          this.screen.touch();
        }
        if (data.pokey && this.app.audioManager) {
          this.app.audioManager.writeChip('pokey', {frame: data.frame, writes: data.pokey});
        }
        this.drawModel();
        this.needDraw = false;
        break;
      case 'demo':
        // ★ $0875: the tune played twice without input — the demo
        this.app.startDemo();
        break;
      case 'error':
        console.error(data.message);
        break;
    }
  } // handleWorkerMessage

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }

    switch (event.id) {

      case 'keyPress':
        if (this.desktopEntity.modalEntity != null) {
          break;
        }
        var key = event.key;
        if (key.length == 1) {
          key = key.toUpperCase();
        }
        switch (key) {
          case 'Escape':
          case 'GamepadExit':
            this.desktopEntity.addModalEntity(new PauseGameEntity(this.desktopEntity, 84, Math.round((this.desktopHeight-60)/2), 153, 60, 'OPTIONS', 'MenuModel'));
            return true;
          case 'Enter':
          case 'GamepadOK':
          case 'GamepadFire':
          case 'Mouse1':
          case 'Touch':
          case this.app.controls.keyboard.fire:
            // ★ the trigger starts the game (menu_start $252C → new_game)
            this.app.startGame();
            return true;
        }
        break;

      case 'continueGame':
        // the panel closed; the tune never stopped
        return true;

      case 'errorAudioBus':
        this.app.showErrorMessage(event.error, 'reopen');
        return true;
    }
    return false;
  } // handleEvent

  loopModel(timestamp) {
    super.loopModel(timestamp);

    if (this.desktopEntity.modalEntity) {
      this.desktopEntity.modalEntity.loopEntity(timestamp);
    }
    // the frame handler drew and dropped the flag; when no frame came, the loop draws instead (R-037)
    if (this.needDraw) {
      this.drawModel();
    }
    this.needDraw = true;
  } // loopModel

} // MainModel
