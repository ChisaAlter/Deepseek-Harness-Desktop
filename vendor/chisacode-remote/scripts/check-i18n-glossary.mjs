/**
 * check-i18n-glossary.mjs — CI gate for i18n terminology consistency.
 *
 * Scans i18n translation strings for forbidden terms defined in
 * i18n/glossary.json. Run with: npm run check:i18n-glossary
 *
 * Exit codes: 0 = clean, 1 = violations found, 2 = glossary invalid.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── Load glossary ──────────────────────────────────────────────────────────
let glossary;
try {
  glossary = JSON.parse(readFileSync(path.join(ROOT, "i18n/glossary.json"), "utf8"));
} catch (err) {
  console.error(`❌ Cannot read i18n/glossary.json: ${err.message}`);
  process.exit(2);
}

// Validate the glossary against the structural constraints of
// i18n/glossary.schema.json. We inline the check rather than pulling in ajv
// (a transitive dependency) so the gate is self-contained. A typo'd key
// (e.g. `forbiden`) or an empty forbidden entry would otherwise make the gate
// pass vacuously.
function validateTerm(term, i, errors) {
  const prefix = `terms[${i}]`;
  if (typeof term.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(term.id)) {
    errors.push(`${prefix}.id must match ^[a-z][a-z0-9-]*$`);
  }
  if (term.status !== "decided" && term.status !== "proposed") {
    errors.push(`${prefix}.status must be decided|proposed`);
  }
  if (typeof term.en !== "string" || term.en.length === 0) {
    errors.push(`${prefix}.en must be a non-empty string`);
  }
  if (typeof term.translations !== "object" || term.translations === null) {
    errors.push(`${prefix}.translations must be an object`);
  } else {
    for (const [locale, val] of Object.entries(term.translations)) {
      if (typeof val !== "string" || val.length === 0) {
        errors.push(`${prefix}.translations.${locale} must be a non-empty string`);
      }
    }
  }
  const allowedTermKeys = new Set(["id", "status", "en", "translations", "forbidden", "note"]);
  for (const k of Object.keys(term)) {
    if (!allowedTermKeys.has(k)) errors.push(`${prefix}: unknown key "${k}"`);
  }
  if (term.forbidden !== undefined) {
    validateForbidden(term.forbidden, prefix, errors);
  }
}

function validateForbidden(forbidden, prefix, errors) {
  if (typeof forbidden !== "object" || forbidden === null) {
    errors.push(`${prefix}.forbidden must be an object`);
    return;
  }
  for (const [locale, list] of Object.entries(forbidden)) {
    if (!Array.isArray(list)) {
      errors.push(`${prefix}.forbidden.${locale} must be an array`);
      continue;
    }
    const seen = new Set();
    for (const item of list) {
      if (typeof item !== "string" || item.length === 0) {
        errors.push(`${prefix}.forbidden.${locale} items must be non-empty strings`);
      } else if (seen.has(item)) {
        errors.push(`${prefix}.forbidden.${locale} duplicate entry "${item}"`);
      }
      seen.add(item);
    }
  }
}

function validateGlossary(g) {
  const errors = [];
  if (typeof g.version !== "number") errors.push("version must be an integer");
  if (typeof g.sourceLocale !== "string") errors.push("sourceLocale must be a string");
  if (!Array.isArray(g.locales) || g.locales.length === 0) {
    errors.push("locales must be a non-empty array");
  }
  if (!Array.isArray(g.terms)) {
    errors.push("terms must be an array");
    return errors;
  }
  const rootKeys = new Set(["version", "sourceLocale", "locales", "terms", "$schema"]);
  for (const k of Object.keys(g)) {
    if (!rootKeys.has(k)) errors.push(`glossary: unknown root key "${k}"`);
  }
  for (const [i, term] of g.terms.entries()) {
    validateTerm(term, i, errors);
  }
  return errors;
}

const glossaryErrors = validateGlossary(glossary);
if (glossaryErrors.length > 0) {
  console.error("❌ i18n/glossary.json failed schema validation:");
  for (const e of glossaryErrors) console.error(`  - ${e}`);
  process.exit(2);
}

// ── Collect translation strings from app i18n ──────────────────────────────
const I18N_FILE = path.join(ROOT, "packages/app/src/i18n/index.ts");
let i18nSource;
try {
  i18nSource = readFileSync(I18N_FILE, "utf8");
} catch {
  console.log("⚠️  packages/app/src/i18n/index.ts not found, skipping.");
  process.exit(0);
}

// Extract zh-CN string values from the inline resource object
const zhValues = [];
for (const m of i18nSource.matchAll(/:\s*"([^"]*)"/g)) {
  zhValues.push({ value: m[1], pos: m.index });
}

// ── Check forbidden terms ──────────────────────────────────────────────────
const violations = [];

for (const term of glossary.terms) {
  const forbidden = term.forbidden?.["zh-CN"];
  if (!Array.isArray(forbidden) || forbidden.length === 0) continue;

  for (const banned of forbidden) {
    for (const { value, pos } of zhValues) {
      if (value.includes(banned)) {
        // Find approximate line number
        const line = i18nSource.slice(0, pos).split("\n").length;
        violations.push({
          term: term.id,
          banned,
          approved: term.translations?.["zh-CN"] ?? term.en,
          found: value,
          line,
        });
      }
    }
  }
}

// ── Report ─────────────────────────────────────────────────────────────────
if (violations.length === 0) {
  console.log("✅ i18n glossary check passed — no forbidden terms found.");
  process.exit(0);
}

const reportOnly = process.argv.includes("--report");
const exitCode = reportOnly ? 0 : 1;
const icon = reportOnly ? "⚠️ " : "❌";

console.error(`${icon} Found ${violations.length} glossary violation(s):\n`);
for (const v of violations) {
  console.error(
    `  Line ${v.line}: "${v.found}" contains forbidden "${v.banned}" → use "${v.approved}" (term: ${v.term})`,
  );
}
console.error(`\nSee i18n/glossary.json for approved terminology.`);
process.exit(exitCode);
