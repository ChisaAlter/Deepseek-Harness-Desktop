const { Tray, Menu, nativeImage } = require('electron');
const { showMain, iconImage, openHarnessSettings, openMarketplace } = require('./window');
const { assetFile } = require('./paths');
const { trayMenuTemplate } = require('./tray-menu');

let tray = null;
let trayActions = null;

function createTray({ onShow, onOpenLauncher, onRestart, onQuit, onPetToggle, petEnabled }) {
  if (tray) {
    return tray;
  }

  let image = iconImage();
  if (!image || image.isEmpty()) {
    image = nativeImage.createFromPath(assetFile('icon.svg'));
  }
  if (process.platform === 'win32' && image && !image.isEmpty()) {
    image = image.resize({ width: 24, height: 24 });
  }

  trayActions = {
    show: onShow || (() => showMain()),
    openLauncher: onOpenLauncher || (() => {}),
    settings: () => { openHarnessSettings(); },
    marketplace: () => { openMarketplace(); },
    restart: onRestart,
    quit: onQuit,
    petToggle: onPetToggle || (() => {}),
  };
  tray = new Tray(image && !image.isEmpty() ? image : nativeImage.createEmpty());
  tray.setToolTip('Deepseek-Harness-Desktop');
  tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate({
    onShow: trayActions.show,
    onOpenLauncher: trayActions.openLauncher,
    onSettings: trayActions.settings,
    onMarketplace: trayActions.marketplace,
    onRestart,
    onQuit,
    onPetToggle: trayActions.petToggle,
    petEnabled,
  })));
  tray.on('click', () => trayActions.show());
  return tray;
}

function invokeTrayAction(name) {
  const action = trayActions && trayActions[name];
  if (typeof action !== 'function') {
    throw new Error(`Tray action is not registered: ${name}`);
  }
  return action();
}

module.exports = {
  createTray,
  showMain,
  trayMenuTemplate,
  invokeTrayAction,
};
