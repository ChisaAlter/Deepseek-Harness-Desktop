import { $ } from "zx";
installZxWindowsPathCompat();

/**
 * zx quotes arguments containing backslashes with bash `$'...'` ANSI-C
 * quoting, which corrupts Windows paths (`\4` is parsed as an octal escape
 * and `\cX` as a control character). Normalize Windows paths to forward
 * slashes so they match zx's unquoted safe character class; Node's fs/path
 * APIs accept forward slashes on Windows.
 *
 * Call this once at the top of any test file that passes paths through zx
 * template expressions.
 */
export function installZxWindowsPathCompat(): void {
  if (process.platform !== "win32") {
    return;
  }
  const baseQuote = $.quote;
  $.quote = (arg: string) => baseQuote(arg.replaceAll("\\", "/"));
}
