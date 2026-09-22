import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

interface WorkspaceFocusContextValue {
  workspaceKey: string | null;
}

export interface WorkspaceFocusRestoration {
  unfocus: () => void;
  restore: () => void;
}

const WorkspaceFocusContext = createContext<WorkspaceFocusContextValue | null>(null);

const noopFocusRestoration: WorkspaceFocusRestoration = {
  unfocus: () => {},
  restore: () => {},
};

export function WorkspaceFocusProvider({
  workspaceKey,
  children,
}: {
  workspaceKey: string | null;
  children: ReactNode;
}) {
  const value = useMemo<WorkspaceFocusContextValue>(() => ({ workspaceKey }), [workspaceKey]);

  return <WorkspaceFocusContext.Provider value={value}>{children}</WorkspaceFocusContext.Provider>;
}

export function useWorkspaceFocusRestoration(): WorkspaceFocusRestoration {
  const context = useContext(WorkspaceFocusContext);
  const tokenRef = useRef<boolean | null>(null);

  const restore = useCallback(() => {
    tokenRef.current = null;
  }, []);

  const unfocus = useCallback(() => {
    tokenRef.current = true;
  }, []);

  useEffect(() => restore, [restore]);

  return context ? { unfocus, restore } : noopFocusRestoration;
}
