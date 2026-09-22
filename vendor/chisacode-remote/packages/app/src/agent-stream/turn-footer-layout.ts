export function getTurnFooterStreamItemWrapperStyle(paddingHorizontal: number) {
  return {
    width: "100%",
    alignSelf: "stretch",
    paddingHorizontal,
  } as const;
}
