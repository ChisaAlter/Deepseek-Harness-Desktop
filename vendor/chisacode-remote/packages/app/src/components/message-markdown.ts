export function stripLeadingMarkdownHorizontalRule(text: string): string {
  return text.replace(/^\s*(?:-{3,}|\*{3,}|_{3,})[ \t]*(?:\r?\n|$)/, "");
}
