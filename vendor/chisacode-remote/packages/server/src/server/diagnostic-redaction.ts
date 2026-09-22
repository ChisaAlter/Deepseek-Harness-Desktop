const REDACTED_VALUE = "[redacted]";

const SECRET_NAME_PATTERN =
  "(?:api[_-]?key|access[_-]?key|access[_-]?token|auth(?:orization)?|bearer|client[_-]?secret|cookie|password|private[_-]?key|refresh[_-]?token|secret|token)";

const ASSIGNMENT_PATTERN = new RegExp(
  `((?:[A-Za-z0-9_.-]*${SECRET_NAME_PATTERN})["']?\\s*[:=]\\s*)(?:"[^"]*"|'[^']*'|[^\\s,;&#]+)`,
  "gi",
);
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const URL_CREDENTIAL_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi;
const SECRET_QUERY_PATTERN = new RegExp(`([?&]${SECRET_NAME_PATTERN}=)[^&#\\s]+`, "gi");
const SECRET_FLAG_PATTERN = new RegExp(`^--?${SECRET_NAME_PATTERN}$`, "i");
const SECRET_FLAG_ASSIGNMENT_PATTERN = new RegExp(`^(--?${SECRET_NAME_PATTERN}=).+$`, "i");

export interface DiagnosticPathRedaction {
  value: string;
  replacement: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactConfiguredPaths(text: string, paths: readonly DiagnosticPathRedaction[]): string {
  const ordered = paths
    .filter((entry) => entry.value.trim().length > 0)
    .slice()
    .sort((left, right) => right.value.length - left.value.length);
  let redacted = text;
  for (const entry of ordered) {
    const variants = new Set([entry.value, entry.value.replaceAll("\\", "/")]);
    for (const variant of variants) {
      redacted = redacted.replace(new RegExp(escapeRegExp(variant), "gi"), entry.replacement);
    }
  }
  return redacted;
}

/** Redacts common credential shapes from user-copyable diagnostics and log excerpts. */
export function redactDiagnosticText(
  value: string,
  options?: { paths?: readonly DiagnosticPathRedaction[] },
): string {
  let redacted = value
    .replace(BEARER_PATTERN, `Bearer ${REDACTED_VALUE}`)
    .replace(URL_CREDENTIAL_PATTERN, `$1${REDACTED_VALUE}@`)
    .replace(SECRET_QUERY_PATTERN, `$1${REDACTED_VALUE}`)
    .replace(ASSIGNMENT_PATTERN, `$1${REDACTED_VALUE}`);
  if (options?.paths) {
    redacted = redactConfiguredPaths(redacted, options.paths);
  }
  return redacted;
}

/** Redacts secret-bearing command arguments while preserving the command shape. */
export function redactDiagnosticArgv(argv: readonly string[]): string[] {
  const redacted: string[] = [];
  let redactNext = false;
  for (const argument of argv) {
    if (redactNext) {
      redacted.push(REDACTED_VALUE);
      redactNext = false;
      continue;
    }
    if (SECRET_FLAG_PATTERN.test(argument)) {
      redacted.push(argument);
      redactNext = true;
      continue;
    }
    const assigned = argument.match(SECRET_FLAG_ASSIGNMENT_PATTERN);
    if (assigned?.[1]) {
      redacted.push(`${assigned[1]}${REDACTED_VALUE}`);
      continue;
    }
    redacted.push(redactDiagnosticText(argument));
  }
  return redacted;
}
