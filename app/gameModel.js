const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { BorderEntity } = await import('./borderEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { PauseGameEntity } = await import('./pauseGameEntity.js?ver='+window.srcVersion);
const { Atari8ScreenEntity } = await import('./svision/js/platform/canvas2D/atari8/atari8ScreenEntity.js?ver='+window.srcVersion);
const { Atari8Color } = await import('./svision/js/platform/canvas2D/atari8/atari8Color.js?ver='+window.srcVersion);
const { CaveScreen } = await import('./caveScreen.js?ver='+window.srcVersion);
const { TitleScreen } = await import('./titleScreen.js?ver='+window.srcVersion);
// begin code

/**
 * The game screen: the whole 320x240 frame as ANTIC and GTIA make it out of
 * the machine's memory — the status line in mode 6 and the cave in mode 4
 * through the original's own display list (sources/docs/display_list.md).
 *
 * The worker (gameWorker.js, WORKER-PROTOCOL.md) keeps the state and ticks;
 * this model routes the controls into it and draws what comes back. The
 * picture is drawn **on the worker's frame** and the model's loop only draws
 * when a frame did not (R-037, `needDraw`), so the screen keeps step with
 * the world and still draws when the worker is paused.
 *
 * ★ **M3: the cave lives.** The worker generates the grid out of the
 * game's own table (caveGen.js), scans it with the original's handlers
 * (caveScan.js) and steps its vertical blank every frame (caveFrame.js);
 * this model puts every frame on the screen the way the original does
 * (caveScreen.js): the tiles as drawn, the window's LMS and fine scroll,
 * the animated glyphs of set B, the status line, the background's flash.
 * All of it is checked against the running original by
 * tools/matchscan.mjs (grid, picture, set B, frame log) — the model draws
 * what the worker decided and decides nothing itself.
 */
export class GameModel extends AbstractModel {

  constructor(app) {
    super(app);
    this.id = 'GameModel';

    this.gameOver = false;
    this.controlsState = {left: false, right: false, up: false, down: false, fire: false};
    this.worker = null;
    this.screenEntity = null;
    this.screen = null;
    this.fpsEntity = null;
    this.inputEntity = null;
    this.fps = {frames: 0, workerFrames: 0, ticks: 0, since: false, lastFrame: false};
    this.heldTaps = {};
    this.needDraw = true;
    /** the luminance of COLBK, for the border's X */
    this.borderLuminance = 0;
    this.colorsApplied = false;
  } // constructor

  newBorderEntity() {
    return new BorderEntity(true, true);
  } // newBorderEntity

  init() {
    super.init();

    // the data files: at once from localStorage, or from the server when they
    // are missing there (R-062)
    this.loadDataFiles(['caves', 'charset', 'global', 'texts', 'demo'], (files, error) => this.initData(files, error));
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
    if (!this.initScreen()) {
      this.desktopEntity.bkColor = Atari8Color.color(0x00);
      this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.atari8Fonts8x8, 0, 8*8, this.desktopWidth, 8, 'BOULDER DASH', Atari8Color.color(0x0E), false, {align: 'center'}));
      this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.fonts5x5, 8, 8*8+16, this.desktopWidth-16, 40,
        'GAME DATA MISSING (data/caves, charset, global, texts). RUN tools/dump*.py.', Atari8Color.color(0xCA), false, {align: 'center', textWrap: true}));
      return;
    }

    if (this.app.devModeName !== false) {
      this.fpsEntity = new TextEntity(this.desktopEntity, this.app.fonts.fonts3x3, 20*8, 2, 10*8, 4, '', Atari8Color.color(0xCA), false, {align: 'right'});
      this.desktopEntity.addEntity(this.fpsEntity);
      this.inputEntity = new TextEntity(this.desktopEntity, this.app.fonts.fonts3x3, 20*8, 8, 10*8, 4, '', Atari8Color.color(0x9A), false, {align: 'right'});
      this.desktopEntity.addEntity(this.inputEntity);
    }

    this.showTouchIcons();

    this.worker = this.app.worker;
    this.app.inputEventsManager.sendEventsActiveKeys('Press');
    this.sendWorkerMessage({
      id: 'init',
      initData: {
        headless: false,
        // ★ the original's own menu choices (User's Guide)
        cave: this.app.cave,
        level: this.app.level,
        players: this.app.players,
        hiScore: this.app.hiScore,
        // ★ the seed of the game's randomness, from the first line of the
        // project (../STANDARDS.md)
        seed: this.app.gameSeed || 1,
        // ★ the 20 caves of the original (data/caves.json)
        caves: this.data.caves.caves,
        // ★ the demo: cave A on the first difficulty played from the script $3BC0 (data/demo.json, M5)
        demo: !!this.app.demo,
        demoScript: this.data.demo ? Array.from(CaveScreen.bytesOfHex(this.data.demo.raw)) : null,
        // ★ the title's tune $23A0 (M6): the table $2328 (data/global.json) and the page of notes = character set B $4400
        tune: TitleScreen.tuneData(this.data.global, this.data.charset)
      }
    });
    // ★ the chip (M6): the worker's writes go to the POKEY bus from the first frame; the bus is
    // opened here, behind the menu's gesture (R-024), and closed by the menu
    this.sendEvent(0, {id: 'openAudioBus', bus: 'pokey', options: {}});
  } // initData

  shutdown() {
    super.shutdown();
    this.sendWorkerMessage({id: 'reset'});
  } // shutdown

  /**
   * The machine's screen with the fixed part of the cave picture in it:
   * character sets, display list, margins, registers (caveScreen.js). The
   * cave itself arrives with the worker's first frame.
   * @returns {boolean} True when the screen was created.
   */
  initScreen() {
    this.data = {
      caves: this.loadDataFile('caves'),
      charset: this.loadDataFile('charset'),
      global: this.loadDataFile('global'),
      texts: this.loadDataFile('texts'),
      demo: this.loadDataFile('demo')
    };
    if (!this.data.caves || !this.data.charset || !this.data.global || !this.data.texts) {
      return false;
    }
    this.screenEntity = new Atari8ScreenEntity(this.desktopEntity, 0, 0, this.desktopWidth, this.desktopHeight);
    this.desktopEntity.addEntity(this.screenEntity);
    this.screen = this.screenEntity.screen;
    try {
      CaveScreen.build(this.screen, this.data.charset, this.data.global, this.data.texts);
    } catch (error) {
      console.error(error.message);
      return false;
    }
    this.applyBackground();
    return true;
  } // initScreen

  /**
   * ★ Puts the worker's frame on the screen as the original's code does:
   * the tiles as drawn ($0BDC, the cover $1852), the margin ($18BF), the
   * window's LMS and fine scroll ($1652), the glyph animation ($1A35,
   * $1986, $1B12, $192C, $159E), the status line ($080B / $081F, $111C)
   * and the five colours of the header with the background's luminance
   * ($1AA6). Nothing is drawn that the worker did not decide.
   * @param {Object} data - The worker's frame.
   */
  showFrame(data) {
    if (!this.screen) {
      return;
    }
    var panel = data.panel;
    // ★ $1E71: the colours of the header at every cave's setup (M5: they change with the cave)
    if (panel && panel.colors && (!this.colorsApplied || panel.colors.join() != this.colorsApplied)) {
      CaveScreen.applyColors(this.screen, panel.colors);
      this.colorsApplied = panel.colors.join();
    }
    if (data.statusB) {
      CaveScreen.statusBeforeBirthBytes(this.screen, this.data.global, data.statusB);
    }
    if (data.tiles) {
      CaveScreen.drawTiles(this.screen, data.tiles, this.data.charset, this.data.global);
    }
    if (data.margin !== undefined) {
      CaveScreen.drawMargin(this.screen, this.data.global, data.margin || 0, data.marginTop);
    }
    if (data.cover) {
      CaveScreen.coverChars(this.screen, data.cover, this.data.global);
    }
    if (data.window) {
      CaveScreen.setWindow(this.screen, data.window, this.data.global);
    }
    if (data.anim) {
      CaveScreen.animate(this.screen, this.data.charset, data.anim);
    }
    if (data.status) {
      CaveScreen.statusInGame(this.screen, this.data.global, data.status.bytes);
      CaveScreen.showStatus(this.screen, this.data.global, data.status.inGame, data.status.text, this.data.texts);
    }
    if (panel && panel.colors && data.bkLum !== undefined) {
      var colbk = (panel.colors[4] & 0xF0) | (data.bkLum & 0x0F);
      if (colbk != this.screen.colbk) {
        this.screen.setColor('colbk', colbk);
        this.applyBackground();
      }
    }
    this.screen.touch();
  } // showFrame

  /**
   * COLBK on the border and under the frame — one register, both places
   * (Atari8Platform).
   */
  applyBackground() {
    var color = Atari8Color.color(this.screen.colbk);
    this.borderLuminance = this.screen.colbk & 15;
    if (this.borderEntity != null) {
      this.borderEntity.bkColor = color;
    }
    this.desktopEntity.bkColor = color;
  } // applyBackground

  sendWorkerMessage(event) {
    if (this.worker) {
      this.worker.postMessage(event);
    }
  } // sendWorkerMessage

  /**
   * Sets one control and sends the whole state when it changed — the whole
   * state, because left and up held together are a diagonal, not a conflict.
   * @param {string} action - The control action.
   * @param {boolean} value - Pressed or released.
   */
  setControl(action, value) {
    if (!(action in this.controlsState) || this.controlsState[action] === value) {
      return;
    }
    this.controlsState[action] = value;
    this.sendWorkerMessage(Object.assign({id: 'controls'}, this.controlsState));
  } // setControl

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }

    switch (event.id) {

      case 'exitGame':
        this.app.setModel('MenuModel');
        return true;

      case 'blurWindow':
        this.pauseGame();
        return true;

      case 'continueGame':
        this.sendWorkerMessage({id: 'continue'});
        return true;

      case 'releaseTouchAction':
        if (this.heldTaps[event.action]) {
          this.heldTaps[event.action]--;
        }
        this.releaseTouchAction(event.action);
        return true;

      case 'keyPress':
        var key = event.key;
        if (key.length == 1) {
          key = key.toUpperCase();
        }
        // ★ $28CA: in the demo any press is the trigger that ends it (the
        // original's way out: the picture gets covered, then the title)
        if (this.app.demo && key != 'Touch') {
          this.setControl('fire', true);
          return true;
        }
        switch (key) {
          // ★ the original pauses on the spacebar; Escape is the remake's
          // (ZADANI chap. 10, deviation 2). SPACE is also the default fire
          // key of the remake, so the pause is on Escape and the gamepad's
          // exit; whoever binds fire elsewhere gets the spacebar pause back
          // through this branch
          case 'Escape':
          case 'GamepadExit':
            this.pauseGame();
            return true;
          case 'Touch':
            if (this.borderEntity.leftControlEntity && this.borderEntity.leftControlEntity.pointOnEntity(event)) {
              this.app.inputEventsManager.touchesMap[event.identifier] = this.borderEntity.leftControlEntity;
              this.touchStart(event, 'left', this.borderEntity.leftControlEntity);
              return true;
            }
            if (this.borderEntity.rightControlEntity && this.borderEntity.rightControlEntity.pointOnEntity(event)) {
              this.app.inputEventsManager.touchesMap[event.identifier] = this.borderEntity.rightControlEntity;
              this.touchStart(event, 'right', this.borderEntity.rightControlEntity);
              return true;
            }
            break;
          case 'RetryTouch':
            this.setControl(event.action, true);
            return true;
        }
        var action = this.controlAction(key);
        if (action !== false) {
          this.setControl(action, true);
          return true;
        }
        if (key == ' ') {
          this.pauseGame();
          return true;
        }
        break;

      case 'keyRelease':
        var releasedKey = event.key;
        if (releasedKey.length == 1) {
          releasedKey = releasedKey.toUpperCase();
        }
        if (releasedKey == 'Touch') {
          this.touchEnd(event);
          return true;
        }
        var releasedAction = this.controlAction(releasedKey);
        if (releasedAction !== false) {
          this.setControl(releasedAction, false);
          return true;
        }
        break;

      case 'keyMove':
        if (event.key == 'Touch') {
          this.touchMove(event);
          return true;
        }
        break;
    }

    return false;
  } // handleEvent

  /** pauses the worker and opens the pause menu */
  pauseGame() {
    if (this.desktopEntity.modalEntity || this.gameOver) {
      return;
    }
    if (this.app.demo) {
      this.setControl('fire', true);
      return;
    }
    this.sendWorkerMessage({id: 'pause'});
    this.desktopEntity.addModalEntity(new PauseGameEntity(this.desktopEntity, 84, Math.round((this.desktopHeight-60)/2), 153, 60, 'PAUSE GAME', 'MenuModel'));
  } // pauseGame

  handleWorkerMessage(event) {
    var data = event.data;
    switch (data.id) {
      case 'frame':
        this.fps.workerFrames++;
        if (this.fps.lastFrame !== false && data.frame > this.fps.lastFrame) {
          this.fps.ticks += data.frame-this.fps.lastFrame;
        }
        this.fps.lastFrame = data.frame;
        if (data.panel) {
          this.app.score = data.panel.score;
          this.app.score2 = data.panel.score2;
          this.app.hiScore = data.panel.hiScore;
          this.app.lives = data.panel.lives;
          this.app.player = data.panel.player;
        }
        // ★ the tiles come when they changed (a pass, the uncovering); the
        // window, the animation and the background come every frame
        this.showFrame(data);
        // ★ what went into POKEY this frame, with the line of each write (M6)
        if (data.pokey && this.app.audioManager) {
          this.app.audioManager.writeChip('pokey', {frame: data.frame, writes: data.pokey});
        }
        if (this.inputEntity && data.controls) {
          var held = Object.keys(data.controls).filter((key) => data.controls[key]);
          this.inputEntity.setText(held.length ? held.join(' ').toUpperCase() : '-');
        }
        // the picture follows the world: drawn on the frame, and the loop
        // then knows it need not (R-037)
        this.drawModel();
        this.needDraw = false;
        break;
      case 'gameOver':
        // ★ $28F8: the title after GAME OVER or the demo (MainModel)
        if (!this.gameOver) {
          this.gameOver = true;
          this.app.score = data.score;
          this.app.score2 = data.score2;
          this.app.hiScore = Math.max(this.app.hiScore || 0, data.hiScore || 0);
          this.app.demo = false;
          this.app.setModel('MainModel');
        }
        break;
      case 'error':
        console.error(data.message);
        break;
    }
  } // handleWorkerMessage

  /**
   * Maps a key or gamepad event onto a control action: **only** the
   * configured keys (SETTINGS) and the gamepad's fixed names.
   * @param {string} key - The event key.
   * @returns {string|false} The action, or false.
   */
  controlAction(key) {
    var kb = this.app.controls.keyboard;
    switch (key) {
      case kb.left: case 'GamepadLeft': return 'left';
      case kb.right: case 'GamepadRight': return 'right';
      case kb.up: case 'GamepadUp': return 'up';
      case kb.down: case 'GamepadDown': return 'down';
      case kb.fire: case 'GamepadFire': case 'GamepadOK': return 'fire';
    }
    return false;
  } // controlAction

  touchHalf(side) {
    var ts = this.app.controlsOptions.touchscreen;
    return ts.halves[ts.types[this.app.controls.touchscreen.type][side].half];
  } // touchHalf

  showTouchIcons() {
    if (!this.app.controls.touchscreen.supported || !this.borderEntity) {
      return;
    }
    var icons = this.app.controlsOptions.touchscreen.icons;
    this.borderEntity.setGameControlIcons(icons[this.touchHalf('left').icon],
                                          icons[this.touchHalf('right').icon]);
  } // showTouchIcons

  touchZone(event, side, entity) {
    var half = this.touchHalf(side);
    var width = Math.max(entity.width, 1), height = Math.max(entity.height, 1);
    var rx = (event.x-(entity.parentX+entity.x))/width;
    var ry = (event.y-(entity.parentY+entity.y))/height;
    for (var z = 0; z < half.zones.length; z++) {
      var r = half.zones[z].rect;
      if (rx >= r[0] && rx <= r[0]+r[2] && ry >= r[1] && ry <= r[1]+r[3]) {
        return half.zones[z];
      }
    }
    return false;
  } // touchZone

  touchStart(event, side, entity) {
    var zone = this.touchZone(event, side, entity);
    var control = {side: side, entity: entity, action: false,
                   type: zone === false ? 'none' : zone.type,
                   control: zone === false ? false : zone.control,
                   actions: zone === false ? false : zone.actions,
                   tap: zone !== false && zone.type == 'button' && !!zone.tap,
                   since: this.app.now,
                   origin: {x: event.x, y: event.y},
                   at: {x: event.x, y: event.y}};
    this.app.inputEventsManager.touchesGameControls[event.identifier] = control;
    if (zone !== false && zone.type == 'button') {
      control.action = zone.action;
      this.setControl(zone.action, true);
    }
  } // touchStart

  touchEnd(event) {
    var controls = this.app.inputEventsManager.touchesGameControls;
    var control = controls[event.identifier];
    if (control === undefined) {
      return;
    }
    delete controls[event.identifier];
    if (control.action === false) {
      return;
    }
    var rest = this.app.controlsOptions.touchscreen.tapHoldTime-(this.app.now-control.since);
    if (control.tap && rest > 0) {
      this.heldTaps[control.action] = (this.heldTaps[control.action] || 0)+1;
      this.sendEvent(rest, {id: 'releaseTouchAction', action: control.action});
      return;
    }
    [].concat(control.action).forEach((action) => this.releaseTouchAction(action));
  } // touchEnd

  releaseTouchAction(action) {
    if (this.heldTaps[action]) {
      return;
    }
    var controls = this.app.inputEventsManager.touchesGameControls;
    var held = Object.keys(controls).some((id) => controls[id].action !== false
                                                  && [].concat(controls[id].action).indexOf(action) !== -1);
    if (!held) {
      this.setControl(action, false);
    }
  } // releaseTouchAction

  /**
   * The stick is absolute: the direction is where the finger moved to from
   * where it landed, with a dead zone of `joystickStep`. ★ The original
   * walks in four directions; two held at once are sent as they are and the
   * worker (M3) will resolve them the way the program does.
   * @param {Object} event - The touch event.
   */
  touchMove(event) {
    var controls = this.app.inputEventsManager.touchesGameControls;
    var control = controls[event.identifier];
    if (control === undefined || control.type != 'joystick') {
      return;
    }
    control.at = {x: event.x, y: event.y};
    var step = this.app.controlsOptions.touchscreen.joystickStep;
    var axis = {x: false, y: false};
    if (event.x-control.origin.x < -step) { axis.x = control.actions.left; }
    if (event.x-control.origin.x > step) { axis.x = control.actions.right; }
    if (event.y-control.origin.y < -step) { axis.y = control.actions.up; }
    if (event.y-control.origin.y > step) { axis.y = control.actions.down; }
    var next = [axis.x, axis.y].filter((action) => action !== false);
    var previous = control.action === false ? [] : [].concat(control.action);
    if (previous.length == next.length && previous.every((action) => next.indexOf(action) !== -1)) {
      return;
    }
    control.action = next.length == 0 ? false : (next.length == 1 ? next[0] : next);
    previous.forEach((action) => {
      if (next.indexOf(action) === -1) {
        this.releaseTouchAction(action);
      }
    });
    next.forEach((action) => this.setControl(action, true));
  } // touchMove

  updateFps(timestamp) {
    if (!this.fpsEntity) {
      return;
    }
    this.fps.frames++;
    if (this.fps.since === false) {
      this.fps.since = timestamp;
      return;
    }
    var elapsed = timestamp-this.fps.since;
    if (elapsed >= 1000) {
      this.fpsEntity.setText(Math.round(this.fps.frames*1000/elapsed)+'/'+Math.round(this.fps.workerFrames*1000/elapsed)+'/'+Math.round(this.fps.ticks*1000/elapsed)+' FPS');
      this.fps.frames = 0;
      this.fps.workerFrames = 0;
      this.fps.ticks = 0;
      this.fps.since = timestamp;
    }
  } // updateFps

  loopModel(timestamp) {
    super.loopModel(timestamp);

    if (this.desktopEntity.modalEntity) {
      this.desktopEntity.modalEntity.loopEntity(timestamp);
    }
    this.updateFps(timestamp);
    // the frame handler drew and dropped the flag; when no frame came (a
    // pause, a modal), the loop draws instead (R-037)
    if (this.needDraw) {
      this.drawModel();
    }
    this.needDraw = true;
  } // loopModel

} // GameModel
