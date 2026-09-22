/**
 * Minimal, injection-safe Markdown for assistant timeline text. The parser
 * emits a structured block/span tree; the renderer (app.js) builds DOM with
 * createElement/textContent only — raw HTML in the input stays literal text
 * by construction, and link hrefs are limited to http(s).
 *
 * Supported: fenced code blocks, headings, unordered/ordered lists, block
 * quotes, paragraphs; inline code, **bold**, *italic*, [label](https://url).
 * Everything else renders as plain text — an honest fallback, not a bug.
 */

const INLINE_TOKEN = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)\s]+\))/;
const LINK_SHAPE = /^\[([^\]]+)\]\(([^)\s]+)\)$/;

function safeHref(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Parse one line of inline markdown into spans.
 * @param {string} text
 * @returns {Array<{ kind: 'text'|'code'|'strong'|'em'|'link', text: string, href?: string }>}
 */
function parseInline(text) {
  const spans = [];
  let rest = String(text ?? '');
  while (rest) {
    const match = INLINE_TOKEN.exec(rest);
    if (!match) {
      spans.push({ kind: 'text', text: rest });
      break;
    }
    if (match.index > 0) {
      spans.push({ kind: 'text', text: rest.slice(0, match.index) });
    }
    const token = match[0];
    if (token.startsWith('`')) {
      spans.push({ kind: 'code', text: token.slice(1, -1) });
    } else if (token.startsWith('**')) {
      spans.push({ kind: 'strong', text: token.slice(2, -2) });
    } else if (token.startsWith('*')) {
      spans.push({ kind: 'em', text: token.slice(1, -1) });
    } else {
      const link = LINK_SHAPE.exec(token);
      const href = link ? safeHref(link[2]) : null;
      if (href) {
        spans.push({ kind: 'link', text: link[1], href });
      } else {
        // Unsafe scheme (javascript:, data:, …) or malformed → literal text.
        spans.push({ kind: 'text', text: token });
      }
    }
    rest = rest.slice(match.index + token.length);
  }
  return spans;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const UL_ITEM = /^\s*[-*]\s+(.*)$/;
const OL_ITEM = /^\s*\d+[.)]\s+(.*)$/;
const FENCE = /^```([\w+-]*)\s*$/;
const QUOTE = /^>\s?(.*)$/;

/**
 * Parse markdown text into renderable blocks.
 * @param {string} text
 * @returns {Array<object>} blocks: {kind:'code',lang,text} | {kind:'heading',level,spans}
 *   | {kind:'list',ordered,items:spans[][]} | {kind:'quote',spans} | {kind:'paragraph',spans}
 */
function parseMarkdown(text) {
  const lines = String(text ?? '').split('\n');
  const blocks = [];
  let paragraph = [];
  let list = null;
  let fence = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ kind: 'paragraph', spans: parseInline(paragraph.join('\n')) });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push(list);
      list = null;
    }
  };

  for (const line of lines) {
    if (fence) {
      if (/^```\s*$/.test(line)) {
        blocks.push({ kind: 'code', lang: fence.lang, text: fence.lines.join('\n') });
        fence = null;
      } else {
        fence.lines.push(line);
      }
      continue;
    }
    const fenceOpen = FENCE.exec(line);
    if (fenceOpen) {
      flushParagraph();
      flushList();
      fence = { lang: fenceOpen[1] || '', lines: [] };
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ kind: 'heading', level: heading[1].length, spans: parseInline(heading[2]) });
      continue;
    }
    const quote = QUOTE.exec(line);
    if (quote) {
      flushParagraph();
      flushList();
      const previous = blocks[blocks.length - 1];
      if (previous?.kind === 'quote') {
        previous.spans.push({ kind: 'text', text: '\n' }, ...parseInline(quote[1]));
      } else {
        blocks.push({ kind: 'quote', spans: parseInline(quote[1]) });
      }
      continue;
    }
    const ul = UL_ITEM.exec(line);
    const ol = ul ? null : OL_ITEM.exec(line);
    if (ul || ol) {
      flushParagraph();
      const ordered = Boolean(ol);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { kind: 'list', ordered, items: [] };
      }
      list.items.push(parseInline((ul || ol)[1]));
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  // An unterminated fence still renders as code — losing it would hide text.
  if (fence) {
    blocks.push({ kind: 'code', lang: fence.lang, text: fence.lines.join('\n') });
  }
  flushParagraph();
  flushList();
  return blocks;
}

export { parseInline, parseMarkdown };
