const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseSimpleYaml,
  resolveTheme,
  officialShellBackground,
  usesOfficialShellChrome,
  windowBackgroundForShell,
  FAMILY_SEEDS,
  listThemes,
} = require('./themes');
const { clearDesktopDshHome } = require('./dsh-home');

test('parseSimpleYaml reads a ui-theme section with custom families', () => {
  const doc = parseSimpleYaml(`
ui-theme:
  preference: dark
  activeDarkThemeId: grove
  customThemes:
    - id: grove
      name: Grove
      origin: custom
      light:
        accent: "#0f766e"
        background: "#f3faf7"
        foreground: "#10211c"
        contrast: 44
      dark:
        accent: "#3dd6b5"
        background: "#071411"
        foreground: "#e7f6f1"
        contrast: 50
`);
  assert.equal(doc['ui-theme'].preference, 'dark');
  assert.equal(doc['ui-theme'].customThemes[0].id, 'grove');
  assert.equal(doc['ui-theme'].customThemes[0].dark.accent, '#3dd6b5');
});

test('resolveTheme uses the dark half of a named family', () => {
  const theme = resolveTheme({}, {
    harness: { preference: 'dark', activeDarkThemeId: 'celadon' },
    systemDark: false,
  });
  assert.equal(theme.id, 'celadon');
  assert.equal(theme.scheme, 'dark');
  assert.equal(theme.bg, FAMILY_SEEDS.celadon.dark.background);
  assert.equal(theme.accent, FAMILY_SEEDS.celadon.dark.accent);
});

test('resolveTheme follows system preference and lists builtin families', () => {
  const light = resolveTheme({}, { harness: { preference: 'system' }, systemDark: false });
  assert.equal(light.scheme, 'light');
  assert.equal(light.id, 'deepseek');
  const dark = resolveTheme({}, { harness: { preference: 'system' }, systemDark: true });
  assert.equal(dark.scheme, 'dark');
  assert.ok(listThemes().some((item) => item.id === 'paper'));
});

test('officialShellBackground follows the official dsh web canvas, not wallpaper seeds', () => {
  assert.equal(officialShellBackground({ scheme: 'light', bg: '#f3efe6' }), '#FFFFFF');
  assert.equal(officialShellBackground({ scheme: 'dark', bg: '#14100b' }), '#151517');
});

test('usesOfficialShellChrome is true for launcher and the floating file preview', () => {
  assert.equal(usesOfficialShellChrome('launcher', ''), true);
  assert.equal(usesOfficialShellChrome(undefined, 'file:///app/src/renderer/launcher.html'), true);
  assert.equal(usesOfficialShellChrome(undefined, 'file:///app/src/renderer/launcher.html?x=1'), true);
  assert.equal(usesOfficialShellChrome(undefined, 'file:///app/src/renderer/file-preview.html'), true);
  assert.equal(usesOfficialShellChrome(undefined, 'file:///app/src/renderer/boot.html'), false);
  assert.equal(usesOfficialShellChrome('main', 'https://127.0.0.1:8080/'), false);
});

test('windowBackgroundForShell uses official canvas on launcher, wallpaper seed elsewhere', () => {
  const paper = { scheme: 'light', bg: '#f3efe6' };
  const grove = { scheme: 'dark', bg: '#14100b' };
  assert.equal(windowBackgroundForShell(paper, { role: 'launcher' }), '#FFFFFF');
  assert.equal(windowBackgroundForShell(grove, { url: 'file:///x/launcher.html' }), '#151517');
  assert.equal(windowBackgroundForShell(paper, { url: 'file:///x/boot.html' }), '#f3efe6');
  assert.equal(windowBackgroundForShell(grove, { role: 'main' }), '#14100b');
});

test('resolveTheme without a desktop home does not require ~/.dsh', () => {
  delete process.env.DSHD_HOME;
  clearDesktopDshHome();
  const theme = resolveTheme({}, { systemDark: true });
  assert.equal(theme.id, 'deepseek');
  assert.equal(theme.scheme, 'dark');
});
