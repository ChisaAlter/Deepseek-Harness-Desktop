export function getExpandableBadgeLayoutStyles() {
  return {
    container: {
      width: "100%",
      maxWidth: "100%",
      minWidth: 0,
    },
    detailWrapper: {
      width: "100%",
      maxWidth: "100%",
      minWidth: 0,
    },
  } as const;
}
