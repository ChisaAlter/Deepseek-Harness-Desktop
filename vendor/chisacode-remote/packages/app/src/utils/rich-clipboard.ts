import MarkdownIt from "markdown-it";

const markdownRenderer = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
});

type ClipboardMimeType = "text/plain" | "text/html";

/** The plain-text and HTML representations of a markdown document prepared for the clipboard */
export interface MarkdownClipboardContent {
  plainText: string;
  html: string;
}

/** A clipboard writer capable of accepting rich (HTML) clipboard payloads */
export interface RichClipboardWriter {
  supportsHtml: () => boolean;
  write: (data: Record<ClipboardMimeType, Blob>) => Promise<void>;
}

/** The clipboard facilities available to {@link writeMarkdownToRichClipboard}, including a plain-text fallback */
export interface MarkdownClipboardEnvironment {
  richWriter?: RichClipboardWriter | null;
  writePlainText: (text: string) => Promise<unknown>;
}

/**
 * Renders markdown into the plain-text and HTML pair used for rich clipboard writes
 * @param markdown The markdown source to render
 * @returns The clipboard content with the raw markdown as plain text and rendered HTML
 */
export function createMarkdownClipboardContent(markdown: string): MarkdownClipboardContent {
  return {
    plainText: markdown,
    html: `<meta charset="utf-8">${markdownRenderer.render(markdown)}`,
  };
}

/**
 * Copies markdown to the clipboard as rich HTML when supported, falling back to plain text when the rich
 * writer is unavailable or rejects the write
 * @param markdown The markdown source to copy
 * @param environment The clipboard facilities to write through
 */
export async function writeMarkdownToRichClipboard(
  markdown: string,
  environment: MarkdownClipboardEnvironment,
): Promise<void> {
  if (environment.richWriter?.supportsHtml()) {
    const content = createMarkdownClipboardContent(markdown);
    try {
      await environment.richWriter.write({
        "text/plain": new Blob([content.plainText], { type: "text/plain" }),
        "text/html": new Blob([content.html], { type: "text/html" }),
      });
      return;
    } catch {
      // Fall through to the plain-text path. Some webviews expose rich clipboard
      // APIs but deny writes depending on focus, permissions, or browser policy.
    }
  }

  await environment.writePlainText(markdown);
}
