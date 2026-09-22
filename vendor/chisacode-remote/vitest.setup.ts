// Expose __DEV__ as a runtime global for packages whose source references it
// (e.g. expo-modules-core). Mirrors the convention used by packages/app; keep
// this in sync if any package deviates from `__DEV__ === false`.
(globalThis as Record<string, unknown>).__DEV__ = false;
