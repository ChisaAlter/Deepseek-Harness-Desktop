export const OPENCODE_BUILD_MODE_ID = "build";
export const OPENCODE_LEGACY_FULL_ACCESS_MODE_ID = "full-access";
export const OPENCODE_AUTO_ACCEPT_FEATURE_ID = "auto_accept";
export const OPENCODE_PERSISTED_SESSION_LIMIT = 200;
export const OPENCODE_PENDING_ABORT_START_TIMEOUT_MS = 10_000;
export const OPENCODE_PERMISSION_ACTION_ALLOW_ONCE = "allow_once";
export const OPENCODE_PERMISSION_ACTION_ALLOW_ALWAYS = "allow_always";
export const MCP_ALREADY_PRESENT_ERROR_TOKENS = ["already", "exists", "connected"] as const;
export const OPENCODE_PROVIDER_LIST_TIMEOUT_MS = 30_000;
export const OPENCODE_HEADERS_TIMEOUT_TOKENS = [
  "headers timeout",
  "headers timeout error",
  "headers_timeout",
  "und_err_headers_timeout",
] as const;
export const OPENCODE_AGENT_HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
