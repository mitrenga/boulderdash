const { Version } = await import('./version.js?ver='+window.srcVersion);
const { AbstractApp } = await import('./svision/js/abstractApp.js?ver='+window.srcVersion);
const { Atari8Fonts8x8 } = await import('./svision/js/platform/canvas2D/atari8/atari8Fonts8x8.js?ver='+window.srcVersion);
const { Atari8BootModel } = await import('./svision/js/platform/canvas2D/atari8/atari8BootModel.js?ver='+window.srcVersion);
const { Fonts5x5 } = await import('./svision/js/platform/canvas2D/fonts5x5.js?ver='+window.srcVersion);
const { Fonts3x3 } = await import('./svision/js/platform/canvas2D/fonts3x3.js?ver='+window.srcVersion);
const { MainModel } = await import('./mainModel.js?ver='+window.srcVersion);
const { MenuModel } = await import('./menuModel.js?ver='+window.srcVersion);
const { AboutModel } = await import('./aboutModel.js?ver='+window.srcVersion);
const { GameModel } = await import('./gameModel.js?ver='+window.srcVersion);
const { Tool } = await import('./svision/js/tool.js?ver='+window.srcVersion);
const { AudioManager } = await import('./audioManager.js?ver='+window.srcVersion);
// begin code

/**
 * Boulder Dash application shell (M1 skeleton), on Atari8Platform — the
 * first game on it (R-039). **Internal project**: Boulder Dash and Rockford
 * are trademarks of BBG Entertainment GmbH; this remake is never deployed
 * anywhere public (ZADANI chap. 0). It exists to be the first real consumer
 * of the Atari 8-bit platform in svision.
 *
 * BootModel (the 800XL powering up, booting the disk — ★ a game disk never
 * shows READY, User's Guide: "Game will load and run automatically") ->
 * MenuModel -> (START GAME) MainModel (★ the title with the tune, as the
 * machine shows it) -> (fire) GameModel -> (GAME OVER, the end of the
 * demo) MainModel; Escape leaves the title or the game for the menu, as
 * in Manic Miner. AboutModel off the menu. ★ The original goes title ->
 * START -> menu -> trigger -> game -> title.
 *
 * What the original's own menu offers is ★ measured (sources/docs/
 * display_list.md, manual_transcript.md): `1 PLAYER 1 JOYSTICK` cycled by
 * OPTION, `CAVE: A` by the stick left/right (A, E, I, M), `LEVEL: 1` by the
 * stick up/down (1-5; on 4 and 5 only cave A), the trigger starts. The
 * remake's menu carries those four choices and what a browser game needs.
 *
 * ★ The original reads the joystick (STICK0/STRIG0), the console keys
 * (START, OPTION) and the keyboard (CH) — spacebar pauses, ESC leaves the
 * cave. The remake's defaults are the arrows and SPACE, and **every key
 * comes from SETTINGS**.
 *
 * The sound is the machine's POKEY driven by the original's own register
 * writes (audioManager.js, M6): one bus, opened by the game model behind
 * the user's gesture, silent in the menu (R-024).
 */
export class GameApp extends AbstractApp {

  /** ★ the caves a game may start in, in the original's order */
  static get CAVES() { return ['A', 'E', 'I', 'M']; }
  /** ★ five difficulty levels */
  static get LEVELS() { return [1, 2, 3, 4, 5]; }
  /** ★ 1 or 2 players, alternating */
  static get PLAYERS() { return [1, 2]; }

  constructor(platform, importPath, wsURL, devModeName, appIconSprite) {
    super(platform, 'bodyApp', importPath, wsURL);

    this.worker = new Worker(this.importPath+'/gameWorker.js?ver='+window.srcVersion);
    this.worker.onmessage = (event) => {
      if (this.model) {
        this.model.handleWorkerMessage(event);
      }
    };

    this.version = Version;
    this.copyright = '© 2026␣Libor␣Mitrenga,▭INTERNAL';
    this.devModeName = devModeName;
    this.appIconSprite = appIconSprite;

    this.audioManager = new AudioManager(this);
    this.muted = {pokey: false};

    // ★ The remake's fonts: the machine's own OS character set (XL rev. 2)
    // for the menu and the panels, svision's 5x5 and 3x3 for the dialogs.
    // The game's screen uses none of them — it is the original's own
    // character sets through its own display list (caveScreen.js).
    this.fonts = {
      atari8Fonts8x8: new Atari8Fonts8x8(this, false),
      fonts5x5: new Fonts5x5(this),
      fonts3x3: new Fonts3x3(this)
    };
    this.fonts.fonts5x5.addGlyphs({
      '←': {width: 6, data: [[0,2,6,1], [1,1,1,3], [2,0,1,5]]},
      '↓': {width: 5, data: [[2,0,1,5], [1,3,3,1], [0,2,5,1]]},
      '↑': {width: 5, data: [[2,0,1,5], [1,1,3,1], [0,2,5,1]]},
      '→': {width: 6, data: [[0,2,6,1], [4,1,1,3], [3,0,1,5]]},
      '█': {width: 4, data: [[0,0,4,5]]},
      '◢': {width: 4, data: [[4,0,1,1], [3,1,2,1], [2,2,3,1], [1,3,4,1], [0,4,5,1]]},
      '◤': {width: 4, data: [[0,0,5,1], [0,1,4,1], [0,2,3,1], [0,3,2,1], [0,4,1,1]]}
    });
    this.fonts.fonts5x5.addSpace('␣', {width: 2, breaking: false, stretch: true});

    // ★ The original is played with a joystick: four directions and the
    // trigger. With the trigger held, the stick acts on the neighbouring
    // cell without moving (User's Guide). The keyboard defaults are the
    // remake's; the original's own keys are the console keys and the
    // spacebar, not a walking scheme.
    this.controlsOptions = {
      keyboard: {
        device: 'keyboard',
        keys: [
          {action: 'left', label: 'LEFT'},
          {action: 'right', label: 'RIGHT'},
          {action: 'up', label: 'UP'},
          {action: 'down', label: 'DOWN'},
          {action: 'fire', label: 'BUTTON'}
        ]
      },
      gamepads: {
        device: 'gamepads',
        keys: [
          {action: 'left', label: 'LEFT', eventKey: 'GamepadLeft'},
          {action: 'right', label: 'RIGHT', eventKey: 'GamepadRight'},
          {action: 'up', label: 'UP', eventKey: 'GamepadUp'},
          {action: 'down', label: 'DOWN', eventKey: 'GamepadDown'},
          {action: 'fire', label: 'BUTTON', eventKey: 'GamepadFire'},
          {action: 'ok', label: 'OK', eventKey: 'GamepadOK'},
          {action: 'exit', label: 'EXIT', eventKey: 'GamepadExit'}
        ]
      },
      // ★ Touch controls are part of M1 (the lesson of Underwurlde). One
      // half of the screen is the **stick** — four directions, the original
      // walks in four — the other the **button**. Which half is which is the
      // left-handed / right-handed choice in SETTINGS.
      touchscreen: {
        device: 'touchscreen',
        types: {
          keys: ['leftButton', 'rightButton'],
          rightButton: {
            left: {half: 'stick', sprite: 'stick'},
            right: {half: 'button', sprite: 'button'}
          },
          leftButton: {
            left: {half: 'button', sprite: 'button'},
            right: {half: 'stick', sprite: 'stick'}
          }
        },
        halves: {
          stick: {
            icon: 'stick',
            zones: [
              {rect: [0, 0, 1, 1], type: 'joystick', control: 'both',
               actions: {left: 'left', right: 'right', up: 'up', down: 'down'}}
            ]
          },
          button: {
            icon: 'button',
            zones: [
              {rect: [0, 0, 1, 1], type: 'button', action: 'fire'}
            ]
          }
        },
        // the worker reads the controls once per frame (50 Hz); a tap is held
        // at least this long so that it is seen
        tapHoldTime: 120,
        joystickStep: 10,
        icons: {
          stick: {
            compressedSpriteData: 'lP101300N0E2P0111030Z051012320B0P020N0601234561718191AB9BCDB1BDCB9BA19181716543210'
          },
          // ? a plain disc: the original's own sprites are M2 (the tiles of the
          // set at $4400); when they are read, a diamond takes this place
          button: {
            width: 39, height: 23, frames: 1, directions: 1,
            sprite: [[
              '---------------------------------------',
              '---------------------------------------',
              '---------------------------------------',
              '---------------##########--------------',
              '-------------##############------------',
              '------------################-----------',
              '-----------##################----------',
              '----------####################---------',
              '----------####################---------',
              '---------######################--------',
              '---------######################--------',
              '---------######################--------',
              '---------######################--------',
              '---------######################--------',
              '----------####################---------',
              '----------####################---------',
              '-----------##################----------',
              '------------################-----------',
              '-------------##############------------',
              '---------------##########--------------',
              '---------------------------------------',
              '---------------------------------------',
              '---------------------------------------'
            ]]
          }
        }
      }
    };

    this.controls = {
      keyboard: this.getControls('keyboard'),
      touchscreen: this.getControls('touchscreen'),
      gamepads: this.getControls('gamepads')
    };

    // ★ the original's own choices (User's Guide, the menu screen); kept in
    // cookies like the siblings keep the player's name
    this.players = this.readChoice('players', GameApp.PLAYERS, 1);
    this.cave = this.readChoice('cave', GameApp.CAVES, 'A');
    this.level = this.readChoice('level', GameApp.LEVELS, 1);
    this.lives = 3;
    this.score = 0;
    this.score2 = 0;
    this.hiScore = 0;
    this.player = 1;
    /** ★ $07AB: the demo is running (GameModel with the script's stick) */
    this.demo = false;
    // ★ the seed of the game's randomness, settled before the worker starts
    // so that a run can be repeated (../METHODOLOGY.md); a field rather than
    // a constant because tools/runworker.mjs passes its own
    this.gameSeed = 1;
    this.dataError = false;
    this.globalData = false;
    /** the model asked for before the data arrived (setModel) */
    this.pendingModel = false;
    this.id = 'GameApp';
    this.fetchDataId = '';
    this.setModel('BootModel');
    this.loadAppData();
  } // constructor

  /**
   * A choice of the original's menu out of a cookie, or the default.
   * @param {string} key - The cookie.
   * @param {Array} values - The allowed values.
   * @param {*} fallback - The default.
   * @returns {*} The value.
   */
  readChoice(key, values, fallback) {
    var raw = Tool.readCookie(key, '');
    var value = typeof fallback === 'number' ? parseInt(raw, 10) : raw;
    return values.indexOf(value) >= 0 ? value : fallback;
  } // readChoice

  getControls(device) {
    var result = {};

    switch (device) {
      case 'keyboard':
        result = {left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', fire: ' '};
        break;
      case 'touchscreen':
        result = {supported: false, type: 'rightButton'};
        break;
      case 'gamepads':
        result = {supported: false, devices: {}};
        break;
    }

    switch (device) {
      case 'keyboard':
      case 'touchscreen':
        var cfgString = Tool.readCookie(device, false);
        if (cfgString !== false) {
          try {
            var cfg = JSON.parse(cfgString);
            Object.keys(cfg).forEach((item) => {
              result[item] = cfg[item];
              if (device == 'touchscreen' && !(result[item] in this.controlsOptions.touchscreen.types)) {
                result[item] = this.controlsOptions.touchscreen.types.keys[0];
              }
            });
          } catch (error) {
            console.error(error.message);
          }
        }
        break;
      case 'gamepads':
        var devicesString = Tool.readCookie('gamepads', false);
        if (devicesString !== false) {
          try {
            var devices = JSON.parse(devicesString);
          } catch (error) {
            console.error(error.message);
          } finally {
            if (Array.isArray(devices)) {
              devices.forEach((id) => {
                var deviceString = Tool.readCookie(id, false);
                if (deviceString !== false) {
                  try {
                    var device = JSON.parse(deviceString);
                  } catch (error) {
                    console.error(error.message);
                  } finally {
                    result.devices[id] = device;
                  }
                }
              });
            }
          }
        }
        break;
    }
    return result;
  } // getControls

  setModel(model) {
    if ((model == 'MenuModel' || model == 'MainModel') && this.globalData === false) {
      // the boot is shorter than the fetch: the menu opens when the data
      // arrives (setData / errorData), the boot screen stays until then
      if (!this.loadGlobalDataFromStorage()) {
        this.pendingModel = model;
        return;
      }
    }
    this.pendingModel = false;
    var needResizeApp = false;
    var selectionItem = 0;
    if (this.model) {
      if (this.model.id == 'AboutModel') {
        selectionItem = 5;
      }
      this.model.shutdown();
      needResizeApp = true;
    }
    switch (model) {
      case 'BootModel':
        // ★ a boot from disk shows no READY and types nothing: the OS goes
        // from the power-on straight to the game (User's Guide, disasm
        // notes §1: the stub warm-starts through DOSVEC)
        this.model = new Atari8BootModel(this, {
          nextModel: 'MenuModel',
          commands: [],
          timing: {readyPauseMs: 900, launchMs: 400}
        });
        break;
      case 'MainModel':
        this.model = new MainModel(this);
        break;
      case 'MenuModel':
        this.model = new MenuModel(this, selectionItem);
        break;
      case 'AboutModel':
        this.model = new AboutModel(this);
        break;
      case 'GameModel':
        this.model = new GameModel(this);
        break;
    } // switch
    this.model.init();
    if (needResizeApp) {
      this.resizeApp();
    }
  } // setModel

  /**
   * Cycles one of the original's choices and keeps it.
   * @param {string} key - 'players', 'cave' or 'level'.
   * @returns {*} The new value.
   */
  cycleChoice(key) {
    var values = {players: GameApp.PLAYERS, cave: GameApp.CAVES, level: GameApp.LEVELS}[key];
    this[key] = values[(values.indexOf(this[key])+1)%values.length];
    // ★ on levels 4 and 5 the game starts in cave A (User's Guide)
    if (this.level >= 4) {
      this.cave = 'A';
      Tool.writeCookie('cave', this.cave);
    }
    Tool.writeCookie(key, String(this[key]));
    return this[key];
  } // cycleChoice

  /**
   * Starts a new game with the menu's choices.
   */
  startGame() {
    this.score = 0;
    this.score2 = 0;
    this.player = 1;
    this.lives = 3;
    // a fresh seed per game, so two runs differ — but a recorded one can be
    // replayed exactly (WORKER-PROTOCOL.md)
    this.gameSeed = (Date.now() & 0x7FFFFFFF) || 1;
    this.demo = false;
    this.setModel('GameModel');
  } // startGame

  /**
   * ★ $2896: the demo — cave A on the first difficulty played from the
   * script $3BC0, after the menu has been idle (the original's title turns
   * into it after ~1 200 frames without input, M0); any press ends it.
   */
  startDemo() {
    this.startGame();
    this.demo = true;
  } // startDemo

  applyGlobalData(global) {
    // ★ data/global.json (tools/dumpglobal.py): the grid, the generator, the
    // display list template and the order of the caves — tables of the
    // original, not its live variables (those are M5)
    this.globalData = global || {};
  } // applyGlobalData

  setGlobalData(data) {
    this.applyGlobalData(data.data.global);
    var files = {};
    Object.keys(data.data).forEach((key) => {
      if (key == 'hiScore') {
        this.hiScore = Math.max(this.hiScore || 0, data.data[key] || 0);
      } else if (key != 'global') {
        files[key] = data.data[key];
      }
    });
    // global goes last; a full localStorage is cleared and tried once more
    // (R-062)
    this.saveAppDataToStorage(files, data.data.global || {});
  } // setGlobalData

  loadAppData() {
    if (navigator.onLine) {
      this.fetchDataId = this.fetchData('appData.db', false, {}, this, 2000);
    } else {
      this.loadGlobalDataFromStorage();
    }
  } // loadAppData

  loadGlobalDataFromStorage() {
    var stored = localStorage.getItem(window.appPrefix+'.global');
    if (stored !== null) {
      try {
        this.applyGlobalData(JSON.parse(stored));
        return true;
      } catch (error) {
        console.error(error.message);
      }
    }
    return false;
  } // loadGlobalDataFromStorage

  setData(data) {
    this.setGlobalData(data);
    this.openPendingModel();
  } // setData

  errorData(error) {
    console.error(error.message ? error.message : error);
    if (!this.loadGlobalDataFromStorage()) {
      // no server and nothing cached: the menu still opens and says what is
      // missing (data/screen.json is loaded from the cache the fetch fills)
      this.globalData = {};
      this.dataError = 'GAME DATA COULD NOT BE LOADED FROM THE SERVER';
    }
    this.openPendingModel();
  } // errorData

  /**
   * Opens the model the boot asked for while the data was still on its way.
   */
  openPendingModel() {
    if (this.pendingModel) {
      var model = this.pendingModel;
      this.pendingModel = false;
      this.setModel(model);
      if (this.dataError) {
        this.showErrorMessage(this.dataError);
      }
    }
  } // openPendingModel

  showErrorMessage(message, action) {
    // no dialog of the platform yet: the console and the menu's notice line
    console.error(message);
    if (this.model && this.model.showNotice) {
      this.model.showNotice(message, action);
    }
  } // showErrorMessage

} // GameApp
