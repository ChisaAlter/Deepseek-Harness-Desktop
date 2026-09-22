import { describe, expect, it } from "vitest";

import { buildLiquidNeonBackdropStyle } from "./liquid-neon-backdrop-style";

describe("buildLiquidNeonBackdropStyle", () => {
  it("keeps the Liquid Glass CSS gradient on web", () => {
    expect(
      buildLiquidNeonBackdropStyle({
        isWeb: true,
        surface0: "#06111f",
        backgroundCss: "linear-gradient(150deg, #06111f, #0a0820)",
      }),
    ).toEqual({
      backgroundColor: "#06111f",
      backgroundImage: "linear-gradient(150deg, #06111f, #0a0820)",
    });
  });

  it("keeps native rendering free of CSS-only properties", () => {
    expect(
      buildLiquidNeonBackdropStyle({
        isWeb: false,
        surface0: "#06111f",
        backgroundCss: "linear-gradient(150deg, #06111f, #0a0820)",
      }),
    ).toEqual({
      backgroundColor: "#06111f",
    });
  });
});
