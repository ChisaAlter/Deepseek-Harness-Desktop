# Decision: Declare Windows taskbar identity and isolate source notification registration

Status: implemented

[中文](2026-10-01-windows-taskbar-identity.md) | English

## Problem

The user repeatedly reports the Electron atom in the taskbar. Removing a source Electron shortcut with the same AppUserModelID restored the icon on 2026-09-29. At recurrence on 2026-10-01, all three real WM_GETICON images showed the whale. A same-process control using the real factories confirms that undeclared Shell ID, relaunch icon, command and name properties are empty; this host's cross-process null readings are not evidence. The Start Menu again contained Electron.lnk targeting source Electron, with empty arguments, the EXE icon, the production AppID and a ToastActivatorCLSID.

Electron 43.4.0 initializes a notification activator with its system presenter and generates a shortcut using the EXE PE product name. Source electron.exe is named Electron; `app.setName` does not change that. `Notification.isSupported` also initializes the presenter. Browser notification permission provides another entry. Removing the shortcut once cannot prevent recreation, and WM_GETICON does not declare the taskbar relaunch icon.

After installing original CI candidate `36804159162` on the same day, the user again saw the atom. The installed EXE embeds the whale, and the visible window declares the production ID, installed EXE relaunch icon and Whale Isle name; however, the Start Menu still contains an old Electron.lnk sharing the production ID with the new Whale Isle.lnk. The earlier change prevents future registration but omitted existing entries. Recovery must cover existing generated entries as well as future registration.

## Decision

- Before first display, main and launcher windows call `setAppDetails` with the existing AppUserModelID, shared icon and paired product name / relaunch command. Source runs use the disk ICO and commands contain only Electron EXE and the absolute application entry; installed runs use the installed EXE's embedded icon (index 0) and its command, without session, authentication, debugging or QA arguments. Windows Shell cannot read virtual ASAR icon paths.
- Raw Electron development on Windows short-circuits system notifications before any `Notification.isSupported` or constructor call, and denies browser notification permission. Installed builds and other platforms retain notifications; source runs retain existing in-app update confirmation, attention feedback and unread state.
- Before creating or showing any window or initializing notifications, installed Windows desktop startup checks only the fixed current-user Start Menu `Electron.lnk`. Move its original bytes to a unique recovery backup under userData only when it is a regular file with the production GUI AppID, absolute Electron EXE target, empty arguments, default icon and index 0. Leave the entry untouched on read, identity or backup failure. Only after the move completes, asynchronously send a Shell `SHCNE_RENAMEITEM` notification from that old path to its backup, using `SHCNF_PATHW | SHCNF_FLUSHNOWAIT` without waiting for every Shell component to finish processing; wait at most 500ms for the native callback, then retain the backup and continue startup on failure or timeout. Handle only the old notification-generated entry, without scanning the Start Menu or pins or changing Whale Isle shortcuts.
- Preserve appId, icon design and user-data paths. Do not modify user pins, other application shortcuts, global icon caches, Explorer or Electron PE resources; recovery and the registration boundary jointly cover existing and future launches.

## Alternatives considered

- Removing Electron.lnk again can temporarily help, but notification initialization recreates it.
- A separate development AppID or edited Electron EXE separates grouping but adds installation / instance identity or dependency binary maintenance, without supplying a correct relaunch command.
- Window icons alone do not cover Shell taskbar properties; suppressing only Node notifications misses the browser notification path.

## Consequences

Windows development runs no longer display system toasts; installed notifications remain available. Automation must prove source mode never calls the presenter and other modes still notify, plus strict recovery matching, preserved backup bytes, idempotence and failure boundaries. Shell notifications cover only a completed exact move, and unmatched or failed paths must not load the native bridge. Read real HWND properties and inspect the visible taskbar separately, rather than infer Pass from correct window properties. Manual backup, the exact rename notification and a cold launch produced a valid whale sample on the original candidate, but this does not prove that candidate automatically recovers existing entries or certify an old pin's offline icon or full production installation acceptance.

Retain [shared brand assets](../product/2026-09-18-whale-brand-assets.en.md) and [product naming](../product/2026-09-25-whale-isle-application-name.en.md), without replacing them. The [Electron window API](https://www.electronjs.org/docs/latest/api/browser-window#winsetappdetailsoptions-windows), [pinned notification registration implementation](https://github.com/electron/electron/blob/v43.4.0/shell/browser/notifications/win/windows_toast_activator.cc) and [Microsoft taskbar relaunch icon rules](https://learn.microsoft.com/en-us/windows/win32/properties/props-system-appusermodel-relaunchiconresource) describe the system behavior above.
