import type { Logger } from "pino";
import { QRCode } from "../share/QRCode.js";

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return undefined;
}

function shouldPrintPairingQr(): boolean {
  const env = parseBooleanEnv(process.env.CHISACODE_PAIRING_QR);
  if (env !== undefined) return env;
  return process.stdout.isTTY ?? false;
}

export async function renderPairingQr(url: string): Promise<string> {
  const qr = new QRCode(url);

  try {
    // Try terminal format first (best for TTY output)
    return await qr.toString({ type: "terminal", small: true });
  } catch {
    // Fall back to UTF-8 format if terminal rendering fails
    return await qr.toString({ type: "utf8" });
  }
}

export async function printPairingQrIfEnabled(args: {
  url: string;
  logger?: Logger;
}): Promise<void> {
  if (!shouldPrintPairingQr()) return;

  const qr = await renderPairingQr(args.url);
  const out = `\nScan to pair:\n${qr}\n${args.url}\n`;

  try {
    process.stdout.write(out);
  } catch (error) {
    args.logger?.debug({ error }, "Failed to print pairing QR");
  }
}
