import { describe, expect, it } from "vitest";
import { createMarkdownStyles, createWorkbenchMarkdownStyles } from "./markdown-styles";
import { darkTheme } from "./theme";

describe("createMarkdownStyles", () => {
  it("matches the current Soft chat prose typography", () => {
    const styles = createMarkdownStyles(darkTheme);

    expect(styles.body).toMatchObject({
      fontSize: 14.5,
      lineHeight: 24,
      color: darkTheme.colors.foreground,
    });
    expect(styles.paragraph).toMatchObject({
      marginBottom: darkTheme.spacing[3],
      flexWrap: "wrap",
      flexDirection: "row",
    });
    expect(styles.code_inline).toMatchObject({
      fontSize: darkTheme.fontSize.code,
      // Soft quiet wash: shell canvas, not elevated surface2.
      backgroundColor: darkTheme.colors.surfaceWorkspace,
    });
  });

  it("createWorkbenchMarkdownStyles aligns AI prose to T3 text-sm / leading-relaxed / foreground@80%", () => {
    const workbench = createWorkbenchMarkdownStyles(darkTheme);
    // T3 ChatMarkdown: text-sm (14) / leading-relaxed (1.625 → 23) / text-foreground/80.
    expect(workbench.body).toMatchObject({
      fontSize: 14,
      lineHeight: Math.round(14 * 1.625),
      color: darkTheme.colors.foregroundSoft,
    });
    // Text leaves must also carry soft color / scale (markdown-display uses both).
    expect(workbench.text).toMatchObject({
      fontSize: 14,
      lineHeight: Math.round(14 * 1.625),
      color: darkTheme.colors.foregroundSoft,
    });
    // T3 paragraph margin ~0.65rem ≈ 10px.
    expect(workbench.paragraph).toMatchObject({
      marginBottom: 10,
    });
    // T3 heading ladder: h1 20 / h2 18 / h3 16 / h4 14 (full foreground, not soft).
    expect(workbench.heading1).toMatchObject({
      fontSize: 20,
      lineHeight: Math.round(20 * 1.3),
      color: darkTheme.colors.foreground,
    });
    expect(workbench.heading2).toMatchObject({
      fontSize: 18,
      lineHeight: Math.round(18 * 1.3),
      color: darkTheme.colors.foreground,
    });
    expect(workbench.heading3).toMatchObject({
      fontSize: 16,
      lineHeight: Math.round(16 * 1.3),
      color: darkTheme.colors.foreground,
    });
    expect(workbench.heading4).toMatchObject({
      fontSize: 14,
      lineHeight: Math.round(14 * 1.3),
      color: darkTheme.colors.foreground,
    });
  });

  it("applies shrink-and-wrap constraints to long markdown text and links", () => {
    const styles = createMarkdownStyles(darkTheme);

    expect(styles.body).toMatchObject({
      flexShrink: 1,
      minWidth: 0,
      width: "100%",
    });

    expect(styles.paragraph).toMatchObject({
      flexShrink: 1,
      minWidth: 0,
      width: "100%",
      flexWrap: "wrap",
    });

    expect(styles.text).toMatchObject({
      flexShrink: 1,
      minWidth: 0,
      overflowWrap: "anywhere",
    });

    expect(styles.link).toMatchObject({
      flexShrink: 1,
      minWidth: 0,
      overflowWrap: "anywhere",
    });
  });
});
