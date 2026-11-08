const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { AbstractEntity } = await import('./svision/js/abstractEntity.js?ver='+window.srcVersion);
const { BorderEntity } = await import('./borderEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { ButtonEntity } = await import('./svision/js/platform/canvas2D/buttonEntity.js?ver='+window.srcVersion);
const { Atari8ScreenEntity } = await import('./svision/js/platform/canvas2D/atari8/atari8ScreenEntity.js?ver='+window.srcVersion);
const { Atari8Color } = await import('./svision/js/platform/canvas2D/atari8/atari8Color.js?ver='+window.srcVersion);
const { CaveScreen } = await import('./caveScreen.js?ver='+window.srcVersion);
await import('./caveGen.js?ver='+window.srcVersion);   // a classic script (the worker's), published as self.CaveGen
// begin code

/**
 * ABOUT GAME as a screen of its own: the original's cave under a panel with
 * the text, the version and the copyright. Internal project (ZADANI chap. 0)
 * — the text says so. CLOSE (Escape, GamepadExit) goes back to the menu.
 */
export class AboutModel extends AbstractModel {

  constructor(app) {
    super(app);
    this.id = 'AboutModel';

    this.panelX = 24;
    this.panelWidth = 272;
    this.panelHeight = 176;
    this.panelY = Math.round((this.desktopHeight-this.panelHeight)/2);
    this.aboutText = 'BOULDER DASH IS AN INTERNAL REMAKE OF THE 1984 ATARI 8-BIT GAME BY PETER LIEPA AND CHRIS GRAY, PUBLISHED BY FIRST STAR SOFTWARE.\n' +
                     'BOULDER DASH AND ROCKFORD ARE TRADEMARKS OF BBG ENTERTAINMENT GMBH. THIS BUILD IS NOT DISTRIBUTED: IT EXISTS TO DEVELOP AND TEST THE ATARI 8-BIT PLATFORM OF THE SVISION LIBRARY.\n' +
                     'THE PICTURE BEHIND THIS PANEL IS THE ORIGINAL\'S OWN MEMORY, DRAWN THROUGH ITS OWN DISPLAY LIST.';
  } // constructor

  newBorderEntity() {
    return new BorderEntity(false, false);
  } // newBorderEntity

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
    var data = CaveScreen.loadData((key) => this.loadDataFile(key));
    var bk = 0x00;
    if (data && self.CaveGen) {
      var screenEntity = new Atari8ScreenEntity(this.desktopEntity, 0, 0, this.desktopWidth, this.desktopHeight);
      this.desktopEntity.addEntity(screenEntity);
      // ★ cave A, level 1 — the cave the original's title sits above, too
      CaveScreen.present(screenEntity.screen, data, self.CaveGen, 1, 0);
      bk = screenEntity.screen.colbk;
    }
    this.borderEntity.bkColor = Atari8Color.color(bk);
    this.desktopEntity.bkColor = Atari8Color.color(bk);

    var panel = new AbstractEntity(this.desktopEntity, this.panelX, this.panelY, this.panelWidth, this.panelHeight, false, Atari8Color.color(0x00));
    this.desktopEntity.addEntity(panel);
    panel.addEntity(new TextEntity(panel, this.app.fonts.atari8Fonts8x8, 0, 4, this.panelWidth, 8, 'ABOUT GAME', Atari8Color.color(0x2E), false, {align: 'center'}));
    panel.addEntity(new TextEntity(panel, this.app.fonts.fonts5x5, 8, 20, this.panelWidth-16, 110, this.aboutText, Atari8Color.color(0x0E), false, {align: 'left', textWrap: true, lineSpacing: 2}));
    panel.addEntity(new TextEntity(panel, this.app.fonts.fonts5x5, 8, this.panelHeight-30, this.panelWidth-16, 7, 'V'+this.app.version+'  '+this.app.copyright, Atari8Color.color(0x9A), false, {align: 'center'}));
    panel.addEntity(new ButtonEntity(panel, this.app.fonts.fonts5x5, this.panelWidth/2-20, this.panelHeight-18, 40, 13, 'CLOSE', {id: 'closeAbout'}, ['Escape', 'GamepadExit', 'Enter', 'GamepadOK'], Atari8Color.color(0x0E), Atari8Color.color(0x84), {align: 'center', margin: 4}));
  } // initData

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }
    switch (event.id) {
      case 'closeAbout':
        this.app.setModel('MenuModel');
        return true;
    }
    return false;
  } // handleEvent

  loopModel(timestamp) {
    super.loopModel(timestamp);
    this.drawModel();
  } // loopModel

} // AboutModel
