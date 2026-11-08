const { AbstractEntity } = await import('./svision/js/abstractEntity.js?ver='+window.srcVersion);
const { ButtonEntity } = await import('./svision/js/platform/canvas2D/buttonEntity.js?ver='+window.srcVersion);
const { SpriteEntity } = await import('./svision/js/platform/canvas2D/spriteEntity.js?ver='+window.srcVersion);
const { SpriteTool } = await import('./svision/js/spriteTool.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { Atari8Color } = await import('./svision/js/platform/canvas2D/atari8/atari8Color.js?ver='+window.srcVersion);
// begin code

/**
 * The border of the television around the 320x240 frame: the optional exit
 * (X) button, the two halves used by the touch controls with their icons,
 * and the developer-mode banner. Its colour is COLBK — the same register
 * that colours the background inside the frame, so the model that sets one
 * sets the other (Atari8Platform).
 *
 * The shape is the sibling remakes' BorderEntity without the tape stripes:
 * an Atari boots from disk in silence.
 */
export class BorderEntity extends AbstractEntity {

  constructor(enableExit, enableGameControls) {
    super(null, 0, 0, 0, 0, false, false);
    this.id = 'BorderEntity';

    this.enableExit = enableExit;
    this.enableGameControls = enableGameControls;

    this.escapeEntity = null;
    this.escapeScale = 2;

    this.leftControlEntity = null;
    this.rightControlEntity = null;
    this.leftIconEntity = null;
    this.rightIconEntity = null;
    this.gameControlIcons = false;
    this.devModeNameEntity = null;
  } // constructor

  init() {
    super.init();

    if (this.enableExit) {
      if (this.app.layout.ratio > 2) {
        this.escapeScale = 1;
      }
      this.escapeEntity = new ButtonEntity(this, this.app.fonts.atari8Fonts8x8, 0, 0, this.escapeScale*8, this.escapeScale*8, 'X', {id: 'keyPress', key: 'Escape'}, [], false, false, {scale: this.escapeScale, clickColor: '#7a7a7aff'});
      this.addEntity(this.escapeEntity);
    }

    if (this.enableGameControls) {
      this.leftControlEntity = new AbstractEntity(this, 0, 0, 0, 0, false, false);
      this.addEntity(this.leftControlEntity);
      this.rightControlEntity = new AbstractEntity(this, 0, 0, 0, 0, false, false);
      this.addEntity(this.rightControlEntity);

      this.leftIconEntity = new SpriteEntity(this, 0, 0, Atari8Color.color(0x0C), false, 0, 0);
      this.leftIconEntity.hide = true;
      this.addEntity(this.leftIconEntity);
      this.rightIconEntity = new SpriteEntity(this, 0, 0, Atari8Color.color(0x0C), false, 0, 0);
      this.rightIconEntity.hide = true;
      this.addEntity(this.rightIconEntity);
    }

    if (this.app.devModeName !== false) {
      this.devModeNameEntity = new TextEntity(this, this.app.fonts.fonts5x5, 0, -7, 100, 7, '', false, false, {margin: 1});
      var cfgLen = this.app.devModeName.indexOf('}');
      this.devModeNameEntity.setText(this.app.devModeName.substring(cfgLen+1));
      var cfg = null;
      try {
        cfg = JSON.parse(this.app.devModeName.substring(1, cfgLen+1));
        Object.keys(cfg).forEach((item) => {
          this.devModeNameEntity[item] = cfg[item];
        });
      } catch (error) {
        console.error(error.message);
      }
      if (!cfg || !('width' in cfg)) {
        this.devModeNameEntity.width = this.devModeNameEntity.lineWidth(this.devModeNameEntity.text)+2;
      }
      this.addEntity(this.devModeNameEntity);
    }
  } // init

  /**
   * The icons of the touch controls for both halves of the screen.
   * @param {Object|false} left - The icon of the left half (`controlsOptions.touchscreen.icons`).
   * @param {Object|false} right - The icon of the right half.
   */
  setGameControlIcons(left, right) {
    if (!this.enableGameControls) {
      return;
    }
    this.gameControlIcons = !!(left && right);
    [{entity: this.leftIconEntity, icon: left},
     {entity: this.rightIconEntity, icon: right}].forEach((item) => {
      if (item.icon) {
        item.entity.setGraphicsData('compressedSpriteData' in item.icon
                                    ? SpriteTool.decode(item.icon.compressedSpriteData)
                                    : item.icon);
      }
    });
    this.layoutGameControlIcons();
  } // setGameControlIcons

  /**
   * Puts the icons into the border: beside the frame when the side border is
   * wide enough (a phone on its side), under it when the bottom one is tall
   * enough (upright); never over the picture.
   */
  layoutGameControlIcons() {
    if (!this.enableGameControls || !this.leftIconEntity || this.model == null) {
      return;
    }
    var icons = [this.leftIconEntity, this.rightIconEntity];
    if (!this.gameControlIcons || icons.some((icon) => icon.width == 0)) {
      icons.forEach((icon) => { icon.hide = true; });
      return;
    }
    var margin = 2;
    var beside = Math.max(...icons.map((icon) => icon.width))+2*margin;
    var below = Math.max(...icons.map((icon) => icon.height))+2*margin;
    if (this.model.borderWidth >= beside) {
      icons.forEach((icon, i) => {
        icon.x = (i == 0 ? 0 : this.width-this.model.borderWidth)
                 +Math.floor((this.model.borderWidth-icon.width)/2);
        icon.y = Math.floor((this.height-icon.height)/2);
        icon.hide = false;
      });
    } else if (this.model.borderHeight >= below) {
      var top = this.height-this.model.borderHeight;
      icons.forEach((icon, i) => {
        icon.x = Math.floor(this.width*(1+2*i)/4-icon.width/2);
        icon.y = top+Math.floor((this.model.borderHeight-icon.height)/2);
        icon.hide = false;
      });
    } else {
      icons.forEach((icon) => { icon.hide = true; });
    }
  } // layoutGameControlIcons

  drawEntity() {
    super.drawEntity();
    if (this.escapeEntity) {
      // white on a dark border, black on a light one: the luminance of COLBK
      var penColor = Atari8Color.color(0x0E);
      if (this.model && this.model.borderLuminance >= 8) {
        penColor = Atari8Color.color(0x00);
      }
      if (this.escapeEntity.penColor !== penColor) {
        this.escapeEntity.setPenColor(penColor);
      }
    }
    this.drawSubEntities();
  } // drawEntity

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }
    switch (event.id) {
      case 'resizeModel':
        if (this.escapeEntity) {
          if (this.model.borderHeight < this.escapeScale*8) {
            this.escapeEntity.x = this.model.borderWidth+this.model.desktopEntity.width;
            this.escapeEntity.y = this.model.borderHeight;
          } else {
            this.escapeEntity.x = this.model.borderWidth+this.model.desktopEntity.width-this.escapeScale*8;
            this.escapeEntity.y = this.model.borderHeight-this.escapeScale*8;
          }
        }
        if (this.enableGameControls) {
          var w = Math.floor(this.width/2);
          this.leftControlEntity.x = 0;
          this.leftControlEntity.y = 0;
          this.leftControlEntity.width = w;
          this.leftControlEntity.height = this.height;
          this.rightControlEntity.x = this.width-w;
          this.rightControlEntity.y = 0;
          this.rightControlEntity.width = w;
          this.rightControlEntity.height = this.height;
          this.layoutGameControlIcons();
        }
        if (this.devModeNameEntity) {
          this.devModeNameEntity.x = Math.floor((this.width-this.devModeNameEntity.width)/2);
          this.devModeNameEntity.y = Math.max(Math.floor((this.app.model.borderHeight-this.devModeNameEntity.height)/2), 0);
        }
        break;
    }
    return false;
  } // handleEvent

} // BorderEntity
