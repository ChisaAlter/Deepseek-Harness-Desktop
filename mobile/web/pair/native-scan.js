export function isNativeAndroidApp(userAgent) {
  return /\bDshAndroid\/\d+\b/.test(String(userAgent || ''));
}

export function runScanAction({ userAgent, navigate, startBrowserScan }) {
  if (isNativeAndroidApp(userAgent)) {
    navigate('dshd://scan');
    return 'native';
  }
  startBrowserScan();
  return 'browser';
}
