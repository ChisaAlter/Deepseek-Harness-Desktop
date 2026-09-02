/** Browser plugin owning the right-panel surfaces shell. */

export { apply, desktopListingAvailable, ensureBaseOpenPath, inject } from './apply.ts'
export type {
  FileOwnerProps, FilesOwnerProps, OpenableKind, Surface, SurfaceKind, SurfacesKey, SurfacesRootInjected, SurfacesRootProps, SurfacesState,
} from './apply.ts'
export { createSurfacesStore } from './apply.ts'
