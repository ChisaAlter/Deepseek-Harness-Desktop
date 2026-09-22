export function resolveIdleGitButtonLabel(input: {
  branchLabel: string;
  fallback: string;
}): string {
  const branch = input.branchLabel.trim();
  return branch.length > 0 ? branch : input.fallback;
}
