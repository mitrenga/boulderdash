const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { BorderEntity } = await import('./borderEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { ButtonEntity } = await import('./svision/js/platform/canvas2D/buttonEntity.js?ver='+window.srcVersion);
const { MenuEntity } = await import('./svision/js/platform/canvas2D/menuEntity.js?ver='+window.srcVersion);
const { Atari8SettingsEntity } = await import('./svision/js/platform/canvas2D/atari8/atari8SettingsEntity.js?ver='+window.srcVersion);
const { DialogEntity } = await import('./svision/js/platform/canvas2D/dialogs/dialogEntity.js?ver='+window.srcVersion);
const { Atari8DialogProperties } = await import('./svision/js/platform/canvas2D/atari8/atari8DialogProperties.js?ver='+window.srcVersion);
const { Atari8VolumeEntity } = await import('./svision/js/platform/canvas2D/atari8/atari8VolumeEntity.js?ver='+window.srcVersion);
const { ZXWaitForAudioEventEntity } = await import('./svision/js/platform/canvas2D/zx/zxWaitForAudioEventEntity.js?ver='+window.srcVersion);
const { Atari8ScreenEntity } = await import('./svision/js/platform/canvas2D/atari8/atari8ScreenEntity.js?ver='+window.srcVersion);
const { Atari8Color } = await import('./svision/js/platform/canvas2D/atari8/atari8Color.js?ver='+window.srcVersion);
const { CaveScreen } = await import('./caveScreen.js?ver='+window.srcVersion);
await import('./caveGen.js?ver='+window.srcVersion);   // a classic script (the worker's), published as self.CaveGen
// begin code

/**
 * Main menu, the structure the sibling remakes share, with the four choices
 * the original's own menu screen offers (★ sources/docs/display_list.md,
 * manual_transcript.md):
 *
 * - **CAVE** — A, E, I or M (the stick left/right on the original)
 * - **LEVEL** — 1 to 5 (the stick up/down); ★ on 4 and 5 the game starts
 *   in cave A, so choosing them sets the cave back
 * - **PLAYERS** — 1 or 2, alternating (OPTION on the original)
 * - START GAME — ★ the title (MainModel), where the trigger starts the game
 *
 * SOUNDS (the one slider of the POKEY bus, M6), SETTINGS (the controls, in
 * the dialog entities of the library with the machine's colours) and ABOUT
 * GAME. No hall of fame: the project is internal (ZADANI chap. 0). The menu
 * is silent and closes every bus (R-024); START GAME asks for the gesture
 * the browser wants before a sound.
 *
 * The menu sits on the game's own picture: the machine's memory drawn
 * through the original's display list, as in the game.
 */
export class MenuModel extends AbstractModel {

  constructor(app, selectionItem) {
    super(app);
    this.id = 'MenuModel';

    var game = Atari8Color.color(0x1E), choice = Atari8Color.color(0x9E), about = Atari8Color.color(0x0E);
    this.menuItems = [
      {t1: 'START GAME', event: {id: 'startGame'}, penColor: game},
      {t1: 'CAVE', event: {id: 'cycle', key: 'cave'}, penColor: game},
      {t1: 'LEVEL', event: {id: 'cycle', key: 'level'}, penColor: game},
      {t1: 'PLAYERS', event: {id: 'cycle', key: 'players'}, penColor: game},
      {t1: 'SOUNDS', event: {id: 'setSounds'}, penColor: choice},
      {t1: 'SETTINGS', event: {id: 'setSettings'}, penColor: choice},
      {t1: 'ABOUT GAME', event: {id: 'showAbout'}, penColor: about}
    ];
    this.menuOptions = {
      fonts: this.app.fonts.atari8Fonts8x8,
      leftMargin: 4,
      rightMargin: 4,
      topMargin: 8,
      itemHeight: 12,
      t1LeftMargin: 3,
      t1TopMargin: 2,
      t2Width: 96,
      t2RightMargin: 3,
      t2TopMargin: 2,
      textColor: about,
      selectionTextColor: Atari8Color.color(0x00),
      selectionBarColor: false,
      hoverColor: '#333333ff',
      selectionHoverColor: false,
      clickColor: '#444444ff',
      selectionClickColor: false,
      selection: selectionItem || 0
    };
    // the dialogs of the menu: a black window with the title in the hue of
    // the diamonds, the contents of the library coloured in the machine's
    // colours; laid out for 200 x 124 px
    this.dialogProperties = Atari8DialogProperties.merge({
      x: 56,
      y: 48,
      width: 208,
      height: 138,
      frameWidth: 0,
      titleColor: Atari8Color.color(0x9E),
      bkColor: Atari8Color.color(0x00),
      theme: {
        penColor: about,
        valueColor: choice,
        selectionColor: game,
        selectionPenColor: Atari8Color.color(0x00),
        hoverColor: '#333333ff',
        clickColor: '#444444ff',
        separatorColor: about,
        iconColor: choice,
        buttonColor: Atari8Color.color(0x84),
        buttonHoverColor: Atari8Color.color(0x88),
        closeButtonColor: Atari8Color.color(0x74),
        okButtonColor: Atari8Color.color(0xC4),
        dangerButtonColor: Atari8Color.color(0x34),
        sliderColor: about
      },
      clipsChildren: false,
      remapKeys: {
        x: 0,
        y: -9,
        width: 208,
        height: 138,
        frameWidth: 0,
        titleColor: Atari8Color.color(0x9E),
        bkColor: Atari8Color.color(0x00),
        theme: {
          penColor: about,
          valueColor: choice,
          selectionColor: Atari8Color.color(0x94),
          selectionPenColor: Atari8Color.color(0x00)
        }
      }
    });

    this.titleEntity = null;
    this.versionEntity = null;
    this.menuEntity = null;
    this.noticeEntity = null;
    this.newVersionAvailable = false;
    this.dialogEntity = null;
    this.screenEntity = null;
  } // constructor

  newBorderEntity() {
    return new BorderEntity(false, false);
  } // newBorderEntity

  /** ★ $07B7 out of the menu's letter, $07B8 out of its level */
  showCave() {
    var caveNumber = {A: 1, E: 5, I: 9, M: 13}[this.app.cave] || 1;
    CaveScreen.present(this.screenEntity.screen, this.caveData, self.CaveGen, caveNumber, this.app.level-1);
    var bk = Atari8Color.color(this.screenEntity.screen.colbk);
    this.borderEntity.bkColor = bk;
    this.desktopEntity.bkColor = bk;
  } // showCave

  init() {
    super.init();

    // the data files: at once from localStorage, or from the server when they
    // are missing there (R-062)
    this.loadDataFiles(['caves', 'charset', 'global', 'texts'], (files, error) => this.initData(files, error));
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
    var bk = 0x00;
    // ★ the chosen cave and level as the original builds them (caveGen.js,
    // caveScreen.js) — the menu sits on the cave the game would start in
    this.caveData = CaveScreen.loadData((key) => this.loadDataFile(key));
    if (this.caveData && self.CaveGen) {
      this.screenEntity = new Atari8ScreenEntity(this.desktopEntity, 0, 0, this.desktopWidth, this.desktopHeight);
      this.desktopEntity.addEntity(this.screenEntity);
      try {
        this.showCave();
        bk = this.screenEntity.screen.colbk;
      } catch (error) {
        console.error(error.message);
      }
    } else {
      this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.fonts5x5, 8, 8, this.desktopWidth-16, 20,
        'GAME DATA MISSING (data/caves, charset, global, texts). RUN tools/dump*.py.', Atari8Color.color(0xCA), false, {align: 'center', textWrap: true}));
    }
    // COLBK on the border and under the frame, as the game sets it
    this.borderEntity.bkColor = Atari8Color.color(bk);
    this.desktopEntity.bkColor = Atari8Color.color(bk);

    // the menu window over the cave, under the status line
    this.menuEntity = new MenuEntity(this.desktopEntity, 68, 16, 184, 8+6*12+8, Atari8Color.color(0x00), this.menuOptions, this, this.getMenuData);
    this.desktopEntity.addEntity(this.menuEntity);

    var versionText = 'v'+this.app.version;
    var versionWidth = 16*8;
    this.versionEntity = new ButtonEntity(this.desktopEntity, this.app.fonts.atari8Fonts8x8, (this.desktopWidth-versionWidth)/2, this.desktopHeight-8, versionWidth, 8, versionText, {id: 'upgradeApp'}, [], Atari8Color.color(0x0E), Atari8Color.color(0x00), {align: 'center'});
    this.desktopEntity.addEntity(this.versionEntity);
    this.versionEntity.hoverColor = false;
    this.versionEntity.clickColor = false;
    this.checkServerVersion();

    // the blink clock the remap dialog's cursor reads (330 ms, as the siblings)
    this.app.stack.flashState = false;
    this.sendEvent(330, {id: 'changeFlashState'});
    // R-024: the menu is silent — no bus stays open under it
    this.sendEvent(0, {id: 'closeAllAudioBuses'});
  } // initData

  checkServerVersion() {
    var receiver = {
      id: this.id+'Version',
      fetchDataId: '',
      setData: (data) => {
        if (data.data.version && data.data.version !== 'unknown' && data.data.version !== this.app.version) {
          this.newVersionAvailable = true;
          if (this.dialogEntity === null) {
            this.showVersion();
          }
        }
      },
      errorData: () => {}
    };
    receiver.fetchDataId = this.app.fetchData('version.db', false, {}, receiver);
  } // checkServerVersion

  getMenuData(self, key, row) {
    switch (key) {
      case 'numberOfItems':
        return self.menuItems.length;
      case 't2':
        switch (row) {
          case 1: return String(self.app.cave);
          case 2: return String(self.app.level);
          case 3: return String(self.app.players);
          case 4: return self.app.audioManager ? Atari8VolumeEntity.levelText(self.app.audioManager.volume.pokey) : '';
        }
        break;
      default:
        if (key in self.menuItems[row]) {
          return self.menuItems[row][key];
        }
        break;
    }
    return '';
  } // getMenuData

  openDialog(title, contentFactory) {
    var p = this.dialogProperties;
    this.dialogEntity = new DialogEntity(this.desktopEntity, p.x, p.y, p.width, p.height, title, p, contentFactory);
    this.desktopEntity.addModalEntity(this.dialogEntity);
    this.versionEntity.setText('© 1984  FIRST STAR');
  } // openDialog

  showVersion() {
    if (this.newVersionAvailable) {
      this.versionEntity.setText('UPGRADE !');
      this.versionEntity.setPenColor(Atari8Color.color(0x3E));
    } else {
      this.versionEntity.setText('v'+this.app.version);
      this.versionEntity.setPenColor(Atari8Color.color(0x0E));
    }
  } // showVersion

  /**
   * A line of notice under the menu (the app's error messages).
   * @param {string} message - The text.
   */
  showNotice(message) {
    if (this.noticeEntity) {
      this.noticeEntity.setText(message.toUpperCase());
      return;
    }
    this.noticeEntity = new TextEntity(this.desktopEntity, this.app.fonts.fonts5x5, 8, 210, this.desktopWidth-16, 7, message.toUpperCase(), Atari8Color.color(0x3E), false, {align: 'center'});
    this.desktopEntity.addEntity(this.noticeEntity);
  } // showNotice

  handleEvent(event) {
    if (event.id == 'destroy' && event.entity === this.dialogEntity) {
      this.dialogEntity = null;
      this.showVersion();
    }
    if (super.handleEvent(event)) {
      return true;
    }

    switch (event.id) {
      case 'startGame':
        // the browser plays a sound only after a gesture (R-024): the game
        // opens the POKEY bus, so the gesture comes first when it is missing
        if (this.app.inputEventsManager.needEventForAudio()) {
          var p = this.dialogProperties.waitForAudioEvent || this.dialogProperties;
          this.desktopEntity.addModalEntity(new DialogEntity(this.desktopEntity, p.x, p.y, p.width, p.height, false, p,
            (dialog) => new ZXWaitForAudioEventEntity(dialog, dialog.innerX, dialog.innerY, dialog.innerWidth, dialog.innerHeight, 'startGame2', p)));
          return true;
        }
      case 'startGame2':
        // ★ the title first (with its tune — that is why the gesture comes here), the trigger there
        this.app.setModel('MainModel');
        return true;

      case 'setSounds':
        this.openDialog('SOUNDS', (dialog) => new Atari8VolumeEntity(dialog, dialog.innerX, dialog.innerY, dialog.innerWidth, dialog.innerHeight, 'pokey', 'audioBusSoundsLevel', 'exampleSound', this.dialogProperties));
        return true;

      case 'cycle':
        // ★ CAVE A/E/I/M, LEVEL 1-5, PLAYERS 1/2 — the original's own choices,
        // cycled rather than dialogs, as the original cycles them on one key
        this.app.cycleChoice(event.key);
        if (this.screenEntity && (event.key == 'cave' || event.key == 'level')) {
          this.showCave();
        }
        this.sendEvent(0, {id: 'refreshMenu'});
        return true;

      case 'setSettings':
        this.openDialog('SETTINGS', (dialog) => new Atari8SettingsEntity(dialog, dialog.innerX, dialog.innerY, dialog.innerWidth, dialog.innerHeight, this.app.controlsOptions, this.dialogProperties));
        return true;

      case 'showAbout':
        this.app.setModel('AboutModel');
        return true;

      case 'upgradeApp':
        if (this.newVersionAvailable) {
          this.app.upgradeApp();
        }
        return true;

      case 'changeFlashState':
        this.app.stack.flashState = !this.app.stack.flashState;
        this.sendEvent(330, {id: 'changeFlashState'});
        return true;
    }
    return false;
  } // handleEvent

  loopModel(timestamp) {
    super.loopModel(timestamp);
    if (this.desktopEntity.modalEntity) {
      this.desktopEntity.modalEntity.loopEntity(timestamp);
    } else if (this.menuEntity) {
      this.menuEntity.loopEntity(timestamp);
    }
    // ★ the demo is the title's business (MainModel: the tune played twice, $23FD)
    this.drawModel();
  } // loopModel

} // MenuModel
