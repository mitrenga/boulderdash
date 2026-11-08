const { AbstractEntity } = await import('./svision/js/abstractEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { MenuEntity } = await import('./svision/js/platform/canvas2D/menuEntity.js?ver='+window.srcVersion);
const { Atari8Color } = await import('./svision/js/platform/canvas2D/atari8/atari8Color.js?ver='+window.srcVersion);
// begin code

/**
 * The pause panel. ★ The original pauses on the spacebar and puts a prompt
 * on the top of the screen (User's Guide: "SPACEBAR TO RESUME" is in the
 * program's texts at $0AFF); RESUME / EXIT under a panel is the remake's,
 * as is Escape opening it — a browser tab that loses focus has to stop
 * somewhere (ZADANI chap. 10, deviation 2). ★ ESC in the original leaves
 * the cave, not the game; the remake's EXIT here leaves the game.
 */
export class PauseGameEntity extends AbstractEntity {

  constructor(parentEntity, x, y, width, height, title, exitModel) {
    super(parentEntity, x, y, width, height, false, false);
    this.id = 'PauseGameEntity';

    this.title = title;
    this.exitModel = exitModel;
    this.menuItems = [
      {t1: 'RESUME GAME', event: {id: 'closePauseGame'}},
      {t1: 'EXIT GAME', event: {id: 'exitGame'}}
    ];
    this.menuOptions = {
      fonts: this.app.fonts.atari8Fonts8x8,
      leftMargin: 9,
      rightMargin: 9,
      topMargin: 8,
      itemHeight: 12,
      t1LeftMargin: 3,
      t1TopMargin: 2,
      t2Width: 40,
      t2RightMargin: 3,
      t2TopMargin: 2,
      textColor: Atari8Color.color(0x00),
      selectionTextColor: Atari8Color.color(0x00),
      selectionBarColor: Atari8Color.color(0x0C),
      hoverColor: '#0000001e',
      selectionHoverColor: Atari8Color.color(0x0E),
      clickColor: '#0000002e',
      selectionClickColor: '#ffffffff'
    };
  } // constructor

  init() {
    super.init();
    this.addEntity(new AbstractEntity(this, 0, 0, this.width, this.height, false, Atari8Color.color(0x0E)));
    this.addEntity(new TextEntity(this, this.app.fonts.fonts5x5, 0, 0, this.width, 9, this.title, Atari8Color.color(0x04), false, {align: 'center', margin: 2}));
    this.addEntity(new MenuEntity(this, 1, 8, this.width-2, this.height-9, Atari8Color.color(0x1A), this.menuOptions, this, this.getMenuData));
  } // init

  getMenuData(self, key, row) {
    switch (key) {
      case 'numberOfItems':
        return self.menuItems.length;
      default:
        if (key in self.menuItems[row]) {
          return self.menuItems[row][key];
        }
        break;
    }
    return '';
  } // getMenuData

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }
    switch (event.id) {
      case 'keyPress':
        switch (event.key) {
          case 'Escape':
          case ' ':
            this.sendEvent(-1, 1, {id: 'continueGame'});
            this.destroy();
            return true;
        }
        break;
      case 'closePauseGame':
        this.sendEvent(-1, 1, {id: 'continueGame'});
        this.destroy();
        return true;
      case 'exitGame':
        this.app.setModel(this.exitModel);
        return true;
    }
    return false;
  } // handleEvent

} // PauseGameEntity
