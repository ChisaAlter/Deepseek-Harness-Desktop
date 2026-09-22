/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { useOpenProjectPicker } from "./use-open-project-picker";

const { pickDirectory, openProject, localDaemonState } = vi.hoisted(() => ({
  pickDirectory: vi.fn(),
  openProject: vi.fn(),
  localDaemonState: { value: true },
}));

vi.mock("@/desktop/pick-directory", () => ({
  pickDirectory,
}));

vi.mock("./use-is-local-daemon", () => ({
  useIsLocalDaemon: () => localDaemonState.value,
}));

vi.mock("./use-open-project", () => ({
  useOpenProject: () => openProject,
}));

describe("useOpenProjectPicker", () => {
  afterEach(() => {
    vi.clearAllMocks();
    localDaemonState.value = true;
    useKeyboardShortcutsStore.setState({ projectPickerOpen: false });
  });

  it("opens the project picker for local daemons instead of launching the system folder picker", async () => {
    const { result } = renderHook(() => useOpenProjectPicker("server-1"));

    await act(async () => {
      await result.current();
    });

    expect(useKeyboardShortcutsStore.getState().projectPickerOpen).toBe(true);
    expect(pickDirectory).not.toHaveBeenCalled();
    expect(openProject).not.toHaveBeenCalled();
  });

  it("opens the project picker for remote daemons", async () => {
    localDaemonState.value = false;
    const { result } = renderHook(() => useOpenProjectPicker("server-1"));

    await act(async () => {
      await result.current();
    });

    expect(useKeyboardShortcutsStore.getState().projectPickerOpen).toBe(true);
    expect(pickDirectory).not.toHaveBeenCalled();
    expect(openProject).not.toHaveBeenCalled();
  });

  it("does nothing without a server id", async () => {
    const { result } = renderHook(() => useOpenProjectPicker(null));

    await act(async () => {
      await result.current();
    });

    expect(useKeyboardShortcutsStore.getState().projectPickerOpen).toBe(false);
    expect(pickDirectory).not.toHaveBeenCalled();
    expect(openProject).not.toHaveBeenCalled();
  });
});
