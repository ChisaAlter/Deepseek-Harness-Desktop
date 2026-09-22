const testToastApi = {
  show() {},
  copied() {},
  error() {},
};
export function useToast() {
  return testToastApi;
}
export function ToastProvider({ children }) {
  return children ?? null;
}
