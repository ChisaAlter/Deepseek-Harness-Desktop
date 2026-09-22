import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface AnimatedStyleBoundary {
  file: string;
  variables: string[];
}

const boundaries: AnimatedStyleBoundary[] = [
  {
    file: "../components/ui/agent-status-indicator.tsx",
    variables: ["outerStyle"],
  },
  {
    file: "../components/ui/switch.tsx",
    variables: ["trackStyle", "thumbStyle"],
  },
  {
    file: "../components/volume-meter.tsx",
    variables: ["line1OuterStyle", "line2OuterStyle", "line3OuterStyle"],
  },
  {
    file: "../components/file-drop-zone.tsx",
    variables: ["overlayStyle"],
  },
  {
    file: "../components/archived-agent-callout.tsx",
    variables: ["containerStyle"],
  },
  {
    file: "../composer/index.tsx",
    variables: ["composerContainerStyle"],
  },
  {
    file: "../composer/input/input.tsx",
    variables: ["overlayContainerStyle"],
  },
  {
    file: "../composer/draft/workspace-tab.tsx",
    variables: ["inputAreaWrapperStyle"],
  },
  {
    file: "../panels/agent-panel.tsx",
    variables: ["animatedContentStyle", "inputAreaStyle"],
  },
  {
    file: "../components/terminal-pane.tsx",
    variables: ["containerStyle"],
  },
  {
    file: "../components/expandable-badge.tsx",
    variables: ["nativeShimmerPeakCombinedStyle"],
  },
  {
    file: "../components/ui/autocomplete-popover.tsx",
    variables: ["baseStyle"],
  },
  {
    file: "../components/ui/floating.tsx",
    variables: ["inlineFrameStyle"],
  },
];

function readSource(file: string): string {
  return readFileSync(new URL(file, import.meta.url), "utf8");
}

function readVariableInitializer(source: string, variable: string): string {
  const start = source.indexOf(`const ${variable} =`);
  expect(start, `Expected ${variable} to exist`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(";\n", start);
  expect(end, `Expected ${variable} initializer to end with a semicolon`).toBeGreaterThan(start);
  return source.slice(start, end + 1);
}

describe("Reanimated and Unistyles style boundaries", () => {
  for (const boundary of boundaries) {
    for (const variable of boundary.variables) {
      it(`${boundary.file} keeps ${variable} free of Unistyles registered styles`, () => {
        const initializer = readVariableInitializer(readSource(boundary.file), variable);

        expect(initializer).not.toMatch(
          /\b(?:styles|stylesheet|permissionStyles|expandableBadgeStylesheet)\./,
        );
        expect(initializer).not.toContain("inlineUnistylesStyle");
      });
    }
  }

  it("keeps the stream scroll indicator on a React Native static style", () => {
    const source = readSource("../agent-stream/view.tsx");

    expect(source).not.toContain("style={stylesheet.scrollToBottomContainer}");
    expect(source).toContain("style={staticStyles.scrollToBottomContainer}");
  });

  it("keeps the composer input surface on a plain View inside the animated opacity wrapper", () => {
    const source = readSource("../composer/input/input.tsx");

    expect(source).toContain("<Animated.View style={inputAnimatedStyle}>");
    expect(source).toContain("<View ref={inputWrapperRef} style={inputWrapperSurfaceStyle}>");
  });
});
