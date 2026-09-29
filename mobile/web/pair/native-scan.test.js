import assert from 'node:assert/strict';
import test from 'node:test';
import { isNativeAndroidApp, runScanAction } from './native-scan.js';

test('native Android UA routes the scan button to the controlled app URL', () => {
  let navigated = '';
  let browserStarts = 0;
  const result = runScanAction({
    userAgent: 'Mozilla/5.0 DshAndroid/2',
    navigate: (url) => { navigated = url; },
    startBrowserScan: () => { browserStarts += 1; },
  });

  assert.equal(isNativeAndroidApp('Mozilla/5.0 DshAndroid/2'), true);
  assert.equal(result, 'native');
  assert.equal(navigated, 'dshd://scan');
  assert.equal(browserStarts, 0);
});

test('generic browsers keep the Web camera scanner path', () => {
  let navigations = 0;
  let browserStarts = 0;
  const result = runScanAction({
    userAgent: 'Mozilla/5.0 Chrome/141',
    navigate: () => { navigations += 1; },
    startBrowserScan: () => { browserStarts += 1; },
  });

  assert.equal(isNativeAndroidApp('Mozilla/5.0 Chrome/141'), false);
  assert.equal(result, 'browser');
  assert.equal(navigations, 0);
  assert.equal(browserStarts, 1);
});
