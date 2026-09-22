/** Single key token used when formatting a keyboard shortcut */
export type ShortcutKey = string;

/** Platform style used when rendering shortcut modifiers */
export type ShortcutOs = "mac" | "non-mac";

const KEY_DISPLAY: Record<string, string> = {
  Backspace: "⌫",
  Enter: "⏎",
  Esc: "Esc",
  Space: "␣",
  Left: "←",
  Right: "→",
  Up: "↑",
  Down: "↓",
};

function normalizeKey(key: string): string {
  if (!key) return "";
  if (KEY_DISPLAY[key]) return KEY_DISPLAY[key];
  if (key.length === 1) return key.toUpperCase();
  return key;
}

/**
 * Formats a key chord for display on Mac or non-Mac platforms
 * @param keys Modifier and key tokens such as `mod`, `shift`, and letter keys
 * @param os Platform style that selects symbols versus Ctrl/Alt labels
 * @returns Display string for the shortcut
 */
export function formatShortcut(keys: ShortcutKey[], os: ShortcutOs): string {
  const normalized = keys.map((k) => (typeof k === "string" ? k : String(k)));

  if (os === "mac") {
    const order = ["ctrl", "alt", "shift", "mod", "meta"];
    const symbols: Record<string, string> = {
      mod: "⌘",
      shift: "⇧",
      alt: "⌥",
      ctrl: "⌃",
      meta: "⌘",
    };

    const modifierSet = new Set(normalized);
    const mods = order.filter((k) => modifierSet.has(k)).map((k) => symbols[k] ?? "");
    const main = normalized
      .filter((k) => !order.includes(k))
      .map(normalizeKey)
      .join("");
    return `${mods.join("")}${main}`;
  }

  const labels: Record<string, string> = {
    mod: "Ctrl",
    shift: "Shift",
    alt: "Alt",
    ctrl: "Ctrl",
    meta: "Win",
  };
  return normalized
    .map((k) => labels[k] ?? normalizeKey(k))
    .filter(Boolean)
    .join("+");
}
