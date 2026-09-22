/** Copied from the external desktop `apps/web/src/lib/utils.ts`. */

export function isMacPlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}
