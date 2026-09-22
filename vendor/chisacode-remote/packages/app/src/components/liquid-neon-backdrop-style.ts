interface LiquidNeonBackdropStyleInput {
  isWeb: boolean;
  surface0: string;
  backgroundCss: string;
}

export function buildLiquidNeonBackdropStyle(input: LiquidNeonBackdropStyleInput): object {
  if (!input.isWeb) {
    return { backgroundColor: input.surface0 };
  }

  return {
    backgroundColor: input.surface0,
    backgroundImage: input.backgroundCss,
  };
}
