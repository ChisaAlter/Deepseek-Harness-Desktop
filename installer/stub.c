/*
 * Deepseek-Harness-Desktop installer stub (Windows).
 *
 * The shipped Setup.exe is `dsh-setup-stub.exe` + the electron-builder NSIS
 * installer appended as a payload plus a small JSON manifest tail:
 *
 *   [stub image][payload][manifest JSON][u32 manifestLen][magic "DSHSTUB\x01"]
 *
 * GUI mode hosts the WebView2-powered installer page (installer/ui/app.html,
 * embedded as the APP_HTML RCDATA resource) and runs the inner NSIS installer
 * with /S, reporting progress by polling bytes written into the target dir.
 * /S is passed through unchanged and never touches WebView2. When the
 * WebView2 runtime is missing the stub falls back to the classic inner NSIS
 * wizard so the machine can still install.
 */
/* -municode already defines these; guard so other toolchains stay warning-free. */
#ifndef UNICODE
#define UNICODE
#define _UNICODE
#endif
#define COBJMACROS
#define CINTERFACE
#define WIN32_LEAN_AND_MEAN
#define _WIN32_WINNT 0x0A00 /* GetDpiForWindow/GetDpiForSystem (Win10+) */

#include <windows.h>
#include <dwmapi.h>
#include <objbase.h>
#include <shlobj.h>
#include <shlwapi.h>
#include <shobjidl.h>
#include <shellapi.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

/* WebView2.h alone is enough: it forward-declares
 * ICoreWebView2EnvironmentOptions and CreateCoreWebView2EnvironmentWithOptions.
 * WebView2EnvironmentOptions.h is not included — it requires MSVC's WRL. */
#include "WebView2.h"

/* Win11 DWM corner rounding; absent from older dwmapi headers / runtimes. */
#ifndef DWMWA_WINDOW_CORNER_PREFERENCE
#define DWMWA_WINDOW_CORNER_PREFERENCE 33
#endif
#ifndef DWMWCP_ROUND
#define DWMWCP_ROUND 2
#endif

/* ------------------------------------------------------------------ */
/* Manifest tail                                                       */
/* ------------------------------------------------------------------ */

#define TAIL_MAGIC "DSHSTUB\x01"
#define TAIL_MAGIC_LEN 8
#define TAIL_LEN_SIZE 4
#define MAX_MANIFEST_LEN 8192

typedef struct {
  unsigned long long payloadOfs;
  unsigned long long payloadLen;
  unsigned long long installBytes;
  wchar_t version[64];
  wchar_t exeName[MAX_PATH];
  wchar_t productName[128];
} Manifest;

static const unsigned long long jsonGetU64(const char* json, const char* key) {
  char pat[64];
  snprintf(pat, sizeof(pat), "\"%s\":", key);
  const char* p = strstr(json, pat);
  if (!p) return 0;
  p += strlen(pat);
  while (*p == ' ') p++;
  return _strtoui64(p, NULL, 10);
}

static void jsonGetStr(const char* json, const char* key, wchar_t* out, int outLen) {
  char pat[64];
  snprintf(pat, sizeof(pat), "\"%s\":\"", key);
  const char* p = strstr(json, pat);
  out[0] = 0;
  if (!p) return;
  p += strlen(pat);
  const char* end = strchr(p, '"');
  if (!end) return;
  int len = (int)(end - p);
  char buf[512];
  if (len >= (int)sizeof(buf)) len = sizeof(buf) - 1;
  memcpy(buf, p, len);
  buf[len] = 0;
  MultiByteToWideChar(CP_UTF8, 0, buf, -1, out, outLen);
}

static BOOL readManifest(const wchar_t* selfPath, Manifest* m) {
  HANDLE f = CreateFileW(selfPath, GENERIC_READ, FILE_SHARE_READ, NULL,
                         OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
  if (f == INVALID_HANDLE_VALUE) return FALSE;
  LARGE_INTEGER size;
  BOOL ok = FALSE;
  char* json = NULL;
  do {
    if (!GetFileSizeEx(f, &size)) break;
    if (size.QuadPart < (LONGLONG)(TAIL_MAGIC_LEN + TAIL_LEN_SIZE)) break;
    LARGE_INTEGER pos;
    pos.QuadPart = size.QuadPart - TAIL_MAGIC_LEN;
    char magic[TAIL_MAGIC_LEN];
    DWORD read = 0;
    if (!SetFilePointerEx(f, pos, NULL, FILE_BEGIN)) break;
    if (!ReadFile(f, magic, TAIL_MAGIC_LEN, &read, NULL) || read != TAIL_MAGIC_LEN) break;
    if (memcmp(magic, TAIL_MAGIC, TAIL_MAGIC_LEN) != 0) break;
    pos.QuadPart = size.QuadPart - TAIL_MAGIC_LEN - TAIL_LEN_SIZE;
    unsigned long manifestLen = 0;
    if (!SetFilePointerEx(f, pos, NULL, FILE_BEGIN)) break;
    if (!ReadFile(f, &manifestLen, TAIL_LEN_SIZE, &read, NULL) || read != TAIL_LEN_SIZE) break;
    if (manifestLen == 0 || manifestLen > MAX_MANIFEST_LEN) break;
    if (size.QuadPart < (LONGLONG)(TAIL_MAGIC_LEN + TAIL_LEN_SIZE + manifestLen)) break;
    json = (char*)malloc(manifestLen + 1);
    if (!json) break;
    pos.QuadPart = size.QuadPart - TAIL_MAGIC_LEN - TAIL_LEN_SIZE - manifestLen;
    if (!SetFilePointerEx(f, pos, NULL, FILE_BEGIN)) break;
    if (!ReadFile(f, json, manifestLen, &read, NULL) || read != manifestLen) break;
    json[manifestLen] = 0;
    m->payloadLen = jsonGetU64(json, "payloadLen");
    m->installBytes = jsonGetU64(json, "installBytes");
    jsonGetStr(json, "version", m->version, (int)ARRAYSIZE(m->version));
    jsonGetStr(json, "exeName", m->exeName, (int)ARRAYSIZE(m->exeName));
    jsonGetStr(json, "productName", m->productName, (int)ARRAYSIZE(m->productName));
    if (m->payloadLen == 0) break;
    if (m->payloadLen > (unsigned long long)(size.QuadPart - TAIL_MAGIC_LEN - TAIL_LEN_SIZE - manifestLen)) break;
    m->payloadOfs = (unsigned long long)size.QuadPart - TAIL_MAGIC_LEN - TAIL_LEN_SIZE
                    - manifestLen - m->payloadLen;
    if (m->exeName[0] == 0) lstrcpyW(m->exeName, L"Deepseek-Harness-Desktop.exe");
    ok = TRUE;
  } while (0);
  free(json);
  CloseHandle(f);
  return ok;
}

/* ------------------------------------------------------------------ */
/* Embedded resources                                                  */
/* ------------------------------------------------------------------ */

static BOOL extractResource(LPCWSTR name, const wchar_t* dest) {
  HRSRC res = FindResourceW(NULL, name, RT_RCDATA);
  if (!res) return FALSE;
  HGLOBAL data = LoadResource(NULL, res);
  if (!data) return FALSE;
  DWORD size = SizeofResource(NULL, res);
  const void* bytes = LockResource(data);
  HANDLE f = CreateFileW(dest, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS,
                         FILE_ATTRIBUTE_NORMAL, NULL);
  if (f == INVALID_HANDLE_VALUE) return FALSE;
  DWORD written = 0;
  BOOL ok = WriteFile(f, bytes, size, &written, NULL) && written == size;
  CloseHandle(f);
  return ok;
}

static wchar_t* loadResourceText(LPCWSTR name) {
  HRSRC res = FindResourceW(NULL, name, RT_RCDATA);
  if (!res) return NULL;
  HGLOBAL data = LoadResource(NULL, res);
  DWORD size = SizeofResource(NULL, res);
  const char* bytes = (const char*)LockResource(data);
  int wideLen = MultiByteToWideChar(CP_UTF8, 0, bytes, (int)size, NULL, 0);
  if (wideLen <= 0) return NULL;
  wchar_t* out = (wchar_t*)malloc((wideLen + 1) * sizeof(wchar_t));
  MultiByteToWideChar(CP_UTF8, 0, bytes, (int)size, out, wideLen);
  out[wideLen] = 0;
  return out;
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

/* A stored install dir only counts when it is a real absolute path:
 * drive-relative ("C:foo") or otherwise mangled registry values must not
 * steer an upgrade into a phantom location. */
static BOOL isAbsoluteDirW(const wchar_t* p) {
  if (!p || !p[0]) return FALSE;
  if (p[0] == L'\\' && p[1] == L'\\') return TRUE; /* UNC */
  if (!((p[0] >= L'A' && p[0] <= L'Z') || (p[0] >= L'a' && p[0] <= L'z'))) {
    return FALSE;
  }
  return p[1] == L':' && (p[2] == L'\\' || p[2] == L'/');
}

static BOOL dirContainsApp(const wchar_t* dir) {
  if (!isAbsoluteDirW(dir)) return FALSE;
  wchar_t exe[MAX_PATH];
  swprintf(exe, ARRAYSIZE(exe), L"%s\\%s", dir, L"Deepseek-Harness-Desktop.exe");
  return GetFileAttributesW(exe) != INVALID_FILE_ATTRIBUTES;
}

/* Detect an existing install. electron-builder registers per-user installs
 * under HKCU\...\Uninstall\<appId-derived GUID> — the subkey name is NOT the
 * appId. The install dir comes from InstallLocation under
 * HKCU\Software\<subkey> first (the same value the inner NSIS upgrade path
 * prefers), then falls back to the UninstallString-derived dir:
 * `"<dir>\Uninstall Deepseek-Harness-Desktop.exe" ...`. Either way the
 * candidate must pass isAbsoluteDirW and actually contain the app exe —
 * a stale or malformed record is ignored so the wizard lands on a real
 * fresh-install directory instead of being hijacked by it. */
static BOOL isExistingInstall(wchar_t* dirOut, int dirLen, wchar_t* verOut, int verLen) {
  static const wchar_t* uname = L"Uninstall Deepseek-Harness-Desktop.exe";
  dirOut[0] = 0;
  if (verOut) verOut[0] = 0;
  HKEY root;
  if (RegOpenKeyExW(HKEY_CURRENT_USER,
                    L"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
                    0, KEY_ENUMERATE_SUB_KEYS | KEY_QUERY_VALUE, &root)
      != ERROR_SUCCESS) {
    return FALSE;
  }
  BOOL found = FALSE;
  for (DWORD i = 0; !found; i++) {
    wchar_t subName[256];
    DWORD subLen = ARRAYSIZE(subName);
    if (RegEnumKeyExW(root, i, subName, &subLen, NULL, NULL, NULL, NULL)
        != ERROR_SUCCESS) {
      break;
    }
    HKEY sub;
    if (RegOpenKeyExW(root, subName, 0, KEY_QUERY_VALUE, &sub) != ERROR_SUCCESS) {
      continue;
    }
    wchar_t ustr[MAX_PATH * 2];
    DWORD usz = sizeof(ustr);
    if (RegGetValueW(sub, NULL, L"UninstallString",
                     RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ, NULL, ustr, &usz)
        == ERROR_SUCCESS
        && wcsstr(ustr, uname)) {
      wchar_t dir[MAX_PATH];
      dir[0] = 0;
      {
        wchar_t locKey[320];
        HKEY loc;
        swprintf(locKey, ARRAYSIZE(locKey), L"Software\\%s", subName);
        if (RegOpenKeyExW(HKEY_CURRENT_USER, locKey, 0, KEY_QUERY_VALUE, &loc)
            == ERROR_SUCCESS) {
          DWORD dsz = sizeof(dir);
          RegGetValueW(loc, NULL, L"InstallLocation",
                       RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ, NULL, dir, &dsz);
          RegCloseKey(loc);
        }
      }
      if (!dirContainsApp(dir)) {
        dir[0] = 0;
        const wchar_t* hit = wcsstr(ustr, uname);
        const wchar_t* start = wcschr(ustr, L'"');
        start = start ? start + 1 : ustr;
        ptrdiff_t n = hit ? hit - start : 0;
        if (n > 0 && start[n - 1] == L'\\') n--;
        if (n > 0 && n < MAX_PATH) {
          memcpy(dir, start, (size_t)n * sizeof(wchar_t));
          dir[n] = 0;
        }
      }
      if (dirContainsApp(dir)) {
        lstrcpynW(dirOut, dir, dirLen);
        if (verOut) {
          DWORD vsz = (DWORD)(verLen * sizeof(wchar_t));
          RegGetValueW(sub, NULL, L"DisplayVersion", RRF_RT_REG_SZ, NULL,
                       verOut, &vsz);
        }
        found = TRUE;
      }
    }
    RegCloseKey(sub);
  }
  RegCloseKey(root);
  return found;
}

static void defaultInstallDir(wchar_t* out, int outLen) {
  PWSTR local = NULL;
  out[0] = 0;
  if (SUCCEEDED(SHGetKnownFolderPath(&FOLDERID_LocalAppData, 0, NULL, &local)) && local) {
    swprintf(out, outLen, L"%s\\Programs\\Deepseek-Harness-Desktop", local);
    CoTaskMemFree(local);
  }
}

static unsigned long long fileTimeU64(const FILETIME* ft) {
  ULARGE_INTEGER u;
  u.LowPart = ft->dwLowDateTime;
  u.HighPart = ft->dwHighDateTime;
  return u.QuadPart;
}

/* Sum sizes of files under `dir` whose last-write time is >= `since`.
 * Fresh install: every written file qualifies. Upgrade: replaced files
 * qualify, so the estimate still climbs. */
static unsigned long long dirBytesSince(const wchar_t* dir, unsigned long long since) {
  wchar_t pattern[MAX_PATH];
  swprintf(pattern, ARRAYSIZE(pattern), L"%s\\*", dir);
  WIN32_FIND_DATAW fd;
  HANDLE h = FindFirstFileExW(pattern, FindExInfoBasic, &fd, FindExSearchNameMatch,
                              NULL, FIND_FIRST_EX_LARGE_FETCH);
  if (h == INVALID_HANDLE_VALUE) return 0;
  unsigned long long total = 0;
  do {
    if (wcscmp(fd.cFileName, L".") == 0 || wcscmp(fd.cFileName, L"..") == 0) continue;
    wchar_t child[MAX_PATH];
    swprintf(child, ARRAYSIZE(child), L"%s\\%s", dir, fd.cFileName);
    if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
      total += dirBytesSince(child, since);
    } else if (fileTimeU64(&fd.ftLastWriteTime) >= since) {
      total += ((unsigned long long)fd.nFileSizeHigh << 32) | fd.nFileSizeLow;
    }
  } while (FindNextFileW(h, &fd));
  FindClose(h);
  return total;
}

static void removeDirTree(const wchar_t* dir) {
  wchar_t pattern[MAX_PATH];
  swprintf(pattern, ARRAYSIZE(pattern), L"%s\\*", dir);
  WIN32_FIND_DATAW fd;
  HANDLE h = FindFirstFileW(pattern, &fd);
  if (h != INVALID_HANDLE_VALUE) {
    do {
      if (wcscmp(fd.cFileName, L".") == 0 || wcscmp(fd.cFileName, L"..") == 0) continue;
      wchar_t child[MAX_PATH];
      swprintf(child, ARRAYSIZE(child), L"%s\\%s", dir, fd.cFileName);
      if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
        removeDirTree(child);
      } else {
        SetFileAttributesW(child, FILE_ATTRIBUTE_NORMAL);
        DeleteFileW(child);
      }
    } while (FindNextFileW(h, &fd));
    FindClose(h);
  }
  RemoveDirectoryW(dir);
}

/* Escape a wide string into a JSON string literal (no surrounding quotes). */
static void jsonEscape(const wchar_t* in, wchar_t* out, int outLen) {
  int o = 0;
  for (const wchar_t* p = in; *p && o < outLen - 2; p++) {
    if (*p == L'\\' || *p == L'"') {
      out[o++] = L'\\';
      out[o++] = *p;
    } else if (*p >= 0x20) {
      out[o++] = *p;
    }
  }
  out[o] = 0;
}

/* ------------------------------------------------------------------ */
/* App state                                                           */
/* ------------------------------------------------------------------ */

#define WIN_W 560
#define WIN_H 400
#define TIMER_PROGRESS 1
#define TIMER_READY 2
#define READY_TIMEOUT_MS 10000
#define INNER_EXE_NAME L"dsh-inner-setup.exe"
#define APP_ID L"ai.deepseek.harness.gui"

static wchar_t g_selfPath[MAX_PATH];
static wchar_t g_workDir[MAX_PATH];
static wchar_t g_innerPath[MAX_PATH];
static wchar_t g_targetDir[MAX_PATH];
static Manifest g_manifest;
static HWND g_hwnd;
static HANDLE g_innerProc;
static unsigned long long g_installStart;
static int g_lastPct = -1;
static int g_installing = 0;

static ICoreWebView2* g_wv;
static ICoreWebView2Controller* g_ctrl;
static BOOL g_wvReady;

typedef HRESULT(STDMETHODCALLTYPE* CreateEnvFn)(
    PCWSTR browserExecutableFolder, PCWSTR userDataFolder,
    ICoreWebView2EnvironmentOptions* options,
    ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler* handler);

/* Diagnostic trace — only when DSHD_SETUP_DEBUG is set in the environment.
 * Appends to %TEMP%\dshd-setup-debug.log so installer runs stay observable
 * without a console. */
static void dlog(const wchar_t* fmt, ...) {
  if (!GetEnvironmentVariableW(L"DSHD_SETUP_DEBUG", NULL, 0)) return;
  wchar_t line[2048];
  va_list ap;
  va_start(ap, fmt);
  vswprintf(line, ARRAYSIZE(line), fmt, ap);
  va_end(ap);
  wchar_t path[MAX_PATH];
  GetTempPathW((DWORD)ARRAYSIZE(path), path);
  lstrcatW(path, L"dshd-setup-debug.log");
  FILE* f = _wfopen(path, L"a, ccs=UTF-8");
  if (!f) return;
  fwprintf(f, L"[%lu] %s\n", (unsigned long)GetCurrentProcessId(), line);
  fclose(f);
}

static void postJson(const wchar_t* json) {
  if (g_wv) ICoreWebView2_PostWebMessageAsJson(g_wv, json);
}

static void postState(const wchar_t* fmt, const wchar_t* a) {
  wchar_t esc[1024];
  wchar_t msg[2048];
  jsonEscape(a ? a : L"", esc, (int)ARRAYSIZE(esc));
  swprintf(msg, ARRAYSIZE(msg), fmt, esc);
  postJson(msg);
}

/* ------------------------------------------------------------------ */
/* COM handlers (plain C vtables)                                      */
/* ------------------------------------------------------------------ */

/* Single-instance handlers: the object is a static, so refcount is a no-op. */
#define IMPL_IUNKNOWN(prefix, IFACE)                                              \
  static HRESULT STDMETHODCALLTYPE prefix##QI(IFACE* self, REFIID riid,           \
                                              void** out) {                       \
    (void)self; (void)riid; *out = self; return S_OK;                             \
  }                                                                               \
  static ULONG STDMETHODCALLTYPE prefix##AddRef(IFACE* self) {                    \
    (void)self; return 1;                                                         \
  }                                                                               \
  static ULONG STDMETHODCALLTYPE prefix##Release(IFACE* self) {                   \
    (void)self; return 1;                                                         \
  }

IMPL_IUNKNOWN(ctrl, ICoreWebView2CreateCoreWebView2ControllerCompletedHandler)
IMPL_IUNKNOWN(env, ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler)
IMPL_IUNKNOWN(msg, ICoreWebView2WebMessageReceivedEventHandler)
IMPL_IUNKNOWN(pf, ICoreWebView2ProcessFailedEventHandler)
IMPL_IUNKNOWN(nav, ICoreWebView2NavigationCompletedEventHandler)

static void onControllerReady(ICoreWebView2Controller* ctrl);
static void webview2Fallback(void);
static int runInnerGuiAndWait(const wchar_t* dir);

static HRESULT STDMETHODCALLTYPE pfInvoke(
    ICoreWebView2ProcessFailedEventHandler* self, ICoreWebView2* sender,
    ICoreWebView2ProcessFailedEventArgs* args) {
  (void)self; (void)sender;
  COREWEBVIEW2_PROCESS_FAILED_KIND kind = 0;
  ICoreWebView2ProcessFailedEventArgs_get_ProcessFailedKind(args, &kind);
  ICoreWebView2ProcessFailedEventArgs2* args2 = NULL;
  int reason = -1;
  if (SUCCEEDED(ICoreWebView2ProcessFailedEventArgs_QueryInterface(
          args, &IID_ICoreWebView2ProcessFailedEventArgs2, (void**)&args2)) && args2) {
    COREWEBVIEW2_PROCESS_FAILED_REASON r = 0;
    ICoreWebView2ProcessFailedEventArgs2_get_Reason(args2, &r);
    reason = (int)r;
    ICoreWebView2ProcessFailedEventArgs2_Release(args2);
  }
  dlog(L"ProcessFailed kind=%d reason=%d", (int)kind, reason);
  g_wv = NULL;
  if (!g_wvReady && !g_installing) {
    /* Browser process died before the page came up — fall back to the
     * classic wizard instead of showing a dead window. */
    DestroyWindow(g_hwnd);
    int code = runInnerGuiAndWait(NULL);
    removeDirTree(g_workDir);
    ExitProcess(code);
  }
  return S_OK;
}
static const ICoreWebView2ProcessFailedEventHandlerVtbl g_pfVtbl = {
  pfQI, pfAddRef, pfRelease, pfInvoke,
};
static ICoreWebView2ProcessFailedEventHandler g_pfHandler = {
  (ICoreWebView2ProcessFailedEventHandlerVtbl*)&g_pfVtbl,
};

static HRESULT STDMETHODCALLTYPE navInvoke(
    ICoreWebView2NavigationCompletedEventHandler* self, ICoreWebView2* sender,
    ICoreWebView2NavigationCompletedEventArgs* args) {
  (void)self; (void)sender;
  BOOL ok = FALSE;
  COREWEBVIEW2_WEB_ERROR_STATUS status = 0;
  ICoreWebView2NavigationCompletedEventArgs_get_IsSuccess(args, &ok);
  ICoreWebView2NavigationCompletedEventArgs_get_WebErrorStatus(args, &status);
  dlog(L"NavigationCompleted ok=%d status=%d", ok, (int)status);
  return S_OK;
}
static const ICoreWebView2NavigationCompletedEventHandlerVtbl g_navVtbl = {
  navQI, navAddRef, navRelease, navInvoke,
};
static ICoreWebView2NavigationCompletedEventHandler g_navHandler = {
  (ICoreWebView2NavigationCompletedEventHandlerVtbl*)&g_navVtbl,
};

static HRESULT STDMETHODCALLTYPE ctrlInvoke(
    ICoreWebView2CreateCoreWebView2ControllerCompletedHandler* self, HRESULT result,
    ICoreWebView2Controller* controller) {
  (void)self;
  dlog(L"ctrlInvoke result=0x%lx controller=%p", (unsigned long)result, controller);
  if (FAILED(result) || !controller) {
    webview2Fallback();
    return S_OK;
  }
  g_ctrl = controller;
  RECT rc;
  GetClientRect(g_hwnd, &rc);
  ICoreWebView2Controller_put_Bounds(g_ctrl, rc);
  ICoreWebView2Controller_put_IsVisible(g_ctrl, TRUE);
  onControllerReady(controller);
  return S_OK;
}

static const ICoreWebView2CreateCoreWebView2ControllerCompletedHandlerVtbl g_ctrlVtbl = {
  ctrlQI, ctrlAddRef, ctrlRelease, ctrlInvoke,
};
static ICoreWebView2CreateCoreWebView2ControllerCompletedHandler g_ctrlHandler = {
  (ICoreWebView2CreateCoreWebView2ControllerCompletedHandlerVtbl*)&g_ctrlVtbl,
};

static HRESULT STDMETHODCALLTYPE envInvoke(
    ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler* self, HRESULT result,
    ICoreWebView2Environment* env) {
  (void)self;
  dlog(L"envInvoke result=0x%lx env=%p", (unsigned long)result, env);
  if (FAILED(result) || !env) {
    webview2Fallback();
    return S_OK;
  }
  HRESULT hr = ICoreWebView2Environment_CreateCoreWebView2Controller(
      env, g_hwnd, &g_ctrlHandler);
  dlog(L"CreateCoreWebView2Controller hr=0x%lx", (unsigned long)hr);
  if (FAILED(hr)) webview2Fallback();
  return S_OK;
}

static const ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandlerVtbl g_envVtbl = {
  envQI, envAddRef, envRelease, envInvoke,
};
static ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler g_envHandler = {
  (ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandlerVtbl*)&g_envVtbl,
};

/* ------------------------------------------------------------------ */
/* Inner NSIS process                                                  */
/* ------------------------------------------------------------------ */

static HANDLE runInner(BOOL silent, const wchar_t* dir) {
  /* /D must be the last argument and must NOT be quoted (NSIS semantics). */
  wchar_t cmd[4096];
  if (silent) {
    swprintf(cmd, ARRAYSIZE(cmd), L"\"%s\" /S", g_innerPath);
  } else {
    swprintf(cmd, ARRAYSIZE(cmd), L"\"%s\"", g_innerPath);
  }
  if (dir && dir[0]) {
    size_t len = wcslen(cmd);
    swprintf(cmd + len, ARRAYSIZE(cmd) - len, L" /D=%s", dir);
  }
  STARTUPINFOW si;
  PROCESS_INFORMATION pi;
  ZeroMemory(&si, sizeof(si));
  si.cb = sizeof(si);
  ZeroMemory(&pi, sizeof(pi));
  if (!CreateProcessW(NULL, cmd, NULL, NULL, FALSE, 0, NULL, NULL, &si, &pi)) {
    return NULL;
  }
  CloseHandle(pi.hThread);
  return pi.hProcess;
}

/* Blocking fallback: run the classic NSIS wizard (also used when WebView2
 * is unavailable). Returns the inner exit code. */
static int runInnerGuiAndWait(const wchar_t* dir) {
  HANDLE proc = runInner(FALSE, dir);
  if (!proc) return 1201;
  WaitForSingleObject(proc, INFINITE);
  DWORD code = 1;
  GetExitCodeProcess(proc, &code);
  CloseHandle(proc);
  return (int)code;
}

/* Called when the WebView2 environment/controller could not be created:
 * hand the install back to the classic wizard. */
static void webview2Fallback(void) {
  if (g_hwnd) DestroyWindow(g_hwnd);
  wchar_t dir[MAX_PATH] = {0};
  wchar_t ver[64];
  if (!isExistingInstall(dir, (int)ARRAYSIZE(dir), ver, (int)ARRAYSIZE(ver))) {
    dir[0] = 0;
  }
  int code = runInnerGuiAndWait(dir[0] ? dir : NULL);
  removeDirTree(g_workDir);
  ExitProcess(code);
}

static void startInstall(const wchar_t* dir) {
  wchar_t existing[MAX_PATH];
  wchar_t ver[64];
  BOOL upgrade = isExistingInstall(existing, (int)ARRAYSIZE(existing), ver, (int)ARRAYSIZE(ver));
  /* Upgrade: inner NSIS resolves the stored InstallLocation itself — passing
   * /D would fork a second install. Fresh: honor the user's choice. */
  const wchar_t* target = upgrade ? existing : dir;
  lstrcpynW(g_targetDir, target, (int)ARRAYSIZE(g_targetDir));
  FILETIME now;
  GetSystemTimeAsFileTime(&now);
  /* 2s slack so files stamped a moment before the child starts still count. */
  g_installStart = fileTimeU64(&now) - 20000000ULL;
  g_innerProc = runInner(TRUE, upgrade ? NULL : dir);
  if (!g_innerProc) {
    postState(L"{\"t\":\"error\",\"msg\":\"%s\"}", L"无法启动安装程序 / failed to launch installer");
    return;
  }
  g_installing = 1;
  g_lastPct = -1;
  SetTimer(g_hwnd, TIMER_PROGRESS, 200, NULL);
}

static void pollInstall(void) {
  if (!g_innerProc) return;
  DWORD wait = WaitForSingleObject(g_innerProc, 0);
  if (wait == WAIT_TIMEOUT) {
    unsigned long long done = dirBytesSince(g_targetDir, g_installStart);
    unsigned long long expected = g_manifest.installBytes;
    int pct = expected ? (int)(done * 99 / expected) : 0;
    if (pct > 99) pct = 99;
    if (pct != g_lastPct) {
      g_lastPct = pct;
      wchar_t msg[64];
      swprintf(msg, ARRAYSIZE(msg), L"{\"t\":\"progress\",\"pct\":%d}", pct);
      postJson(msg);
    }
    return;
  }
  KillTimer(g_hwnd, TIMER_PROGRESS);
  DWORD code = 1;
  GetExitCodeProcess(g_innerProc, &code);
  CloseHandle(g_innerProc);
  g_innerProc = NULL;
  g_installing = 0;
  if (code == 0) {
    /* The inner installer may have resolved a different directory (upgrade
     * or a /D it chose to ignore) — re-read the registry for the truth. */
    wchar_t dir[MAX_PATH];
    wchar_t ver[64];
    if (isExistingInstall(dir, (int)ARRAYSIZE(dir), ver, (int)ARRAYSIZE(ver))) {
      lstrcpynW(g_targetDir, dir, (int)ARRAYSIZE(g_targetDir));
    }
    postState(L"{\"t\":\"done\",\"dir\":\"%s\"}", g_targetDir);
  } else {
    wchar_t msg[64];
    swprintf(msg, ARRAYSIZE(msg), L"exit %lu", (unsigned long)code);
    postState(L"{\"t\":\"error\",\"msg\":\"%s\"}", msg);
  }
}

static void launchApp(void) {
  wchar_t dir[MAX_PATH];
  wchar_t ver[64];
  if (!isExistingInstall(dir, (int)ARRAYSIZE(dir), ver, (int)ARRAYSIZE(ver))) {
    lstrcpynW(dir, g_targetDir, (int)ARRAYSIZE(dir));
  }
  wchar_t exe[MAX_PATH];
  swprintf(exe, ARRAYSIZE(exe), L"%s\\%s", dir,
           g_manifest.exeName[0] ? g_manifest.exeName : L"Deepseek-Harness-Desktop.exe");
  if (GetFileAttributesW(exe) == INVALID_FILE_ATTRIBUTES) {
    postState(L"{\"t\":\"error\",\"msg\":\"%s\"}",
              L"未找到已安装的程序 / installed app not found");
    return;
  }
  ShellExecuteW(NULL, L"open", exe, NULL, dir, SW_SHOW);
}

static void pickFolder(void) {
  IFileOpenDialog* dlg = NULL;
  HRESULT hr = CoCreateInstance(&CLSID_FileOpenDialog, NULL, CLSCTX_ALL,
                                &IID_IFileOpenDialog, (void**)&dlg);
  if (FAILED(hr) || !dlg) return;
  DWORD opts = 0;
  IFileOpenDialog_GetOptions(dlg, &opts);
  IFileOpenDialog_SetOptions(dlg, opts | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM);
  if (SUCCEEDED(IFileOpenDialog_Show(dlg, g_hwnd))) {
    IShellItem* item = NULL;
    if (SUCCEEDED(IFileOpenDialog_GetResult(dlg, &item)) && item) {
      PWSTR path = NULL;
      if (SUCCEEDED(IShellItem_GetDisplayName(item, SIGDN_FILESYSPATH, &path)) && path) {
        postState(L"{\"t\":\"dir\",\"path\":\"%s\"}", path);
        CoTaskMemFree(path);
      }
      IShellItem_Release(item);
    }
  }
  IFileOpenDialog_Release(dlg);
}

/* ------------------------------------------------------------------ */
/* JS -> native messages                                               */
/* ------------------------------------------------------------------ */

static void msgGetStr(const wchar_t* json, const wchar_t* key, wchar_t* out, int outLen) {
  wchar_t pat[64];
  swprintf(pat, ARRAYSIZE(pat), L"\"%s\":\"", key);
  const wchar_t* p = wcsstr(json, pat);
  out[0] = 0;
  if (!p) return;
  p += wcslen(pat);
  int o = 0;
  while (*p && *p != L'"' && o < outLen - 1) {
    if (*p == L'\\' && p[1]) p++;
    out[o++] = *p++;
  }
  out[o] = 0;
}

static void sendInit(void) {
  wchar_t existing[MAX_PATH];
  wchar_t ver[64];
  BOOL upgrade = isExistingInstall(existing, (int)ARRAYSIZE(existing), ver, (int)ARRAYSIZE(ver));
  wchar_t dir[MAX_PATH];
  if (upgrade) {
    lstrcpynW(dir, existing, (int)ARRAYSIZE(dir));
  } else {
    defaultInstallDir(dir, (int)ARRAYSIZE(dir));
  }
  LANGID lang = GetUserDefaultUILanguage();
  const wchar_t* langTag = PRIMARYLANGID(lang) == LANG_CHINESE ? L"zh" : L"en";
  wchar_t escDir[MAX_PATH * 2], escVer[128];
  jsonEscape(dir, escDir, (int)ARRAYSIZE(escDir));
  jsonEscape(upgrade ? ver : L"", escVer, (int)ARRAYSIZE(escVer));
  wchar_t msg[4096];
  swprintf(msg, ARRAYSIZE(msg),
           L"{\"t\":\"init\",\"lang\":\"%s\",\"version\":\"%s\",\"mode\":\"%s\","
           L"\"dir\":\"%s\",\"installedVersion\":\"%s\"}",
           langTag, g_manifest.version, upgrade ? L"upgrade" : L"install",
           escDir, escVer);
  postJson(msg);
}

static HRESULT STDMETHODCALLTYPE msgInvoke(
    ICoreWebView2WebMessageReceivedEventHandler* self, ICoreWebView2* sender,
    ICoreWebView2WebMessageReceivedEventArgs* args) {
  (void)self; (void)sender;
  LPWSTR json = NULL;
  if (FAILED(ICoreWebView2WebMessageReceivedEventArgs_get_WebMessageAsJson(args, &json)) || !json) {
    return S_OK;
  }
  dlog(L"msg %s", json);
  if (wcsstr(json, L"\"ready\"")) {
    g_wvReady = TRUE;
    sendInit();
  } else if (wcsstr(json, L"\"browse\"")) {
    pickFolder();
  } else if (wcsstr(json, L"\"install\"")) {
    if (g_installing) {
      CoTaskMemFree(json);
      return S_OK;
    }
    wchar_t dir[MAX_PATH];
    msgGetStr(json, L"dir", dir, (int)ARRAYSIZE(dir));
    if (dir[0] == 0) defaultInstallDir(dir, (int)ARRAYSIZE(dir));
    startInstall(dir);
  } else if (wcsstr(json, L"\"compat\"")) {
    /* "Use classic wizard": run the inner NSIS GUI. On upgrade the stored
     * InstallLocation wins, so only forward a fresh-install /D. */
    wchar_t dir[MAX_PATH];
    wchar_t existing[MAX_PATH];
    wchar_t ver[64];
    msgGetStr(json, L"dir", dir, (int)ARRAYSIZE(dir));
    if (isExistingInstall(existing, (int)ARRAYSIZE(existing), ver, (int)ARRAYSIZE(ver))) {
      dir[0] = 0;
    }
    DestroyWindow(g_hwnd);
    int code = runInnerGuiAndWait(dir[0] ? dir : NULL);
    removeDirTree(g_workDir);
    ExitProcess(code);
  } else if (wcsstr(json, L"\"launch\"")) {
    launchApp();
  } else if (wcsstr(json, L"\"min\"")) {
    ShowWindow(g_hwnd, SW_MINIMIZE);
  } else if (wcsstr(json, L"\"drag\"")) {
    /* HTML caption strip pressed: enter the native move loop. */
    ReleaseCapture();
    SendMessageW(g_hwnd, WM_NCLBUTTONDOWN, HTCAPTION, 0);
  } else if (wcsstr(json, L"\"close\"")) {
    /* Route through WM_CLOSE so the no-cancel-mid-install guard applies. */
    PostMessageW(g_hwnd, WM_CLOSE, 0, 0);
  }
  CoTaskMemFree(json);
  return S_OK;
}

static const ICoreWebView2WebMessageReceivedEventHandlerVtbl g_msgVtbl = {
  msgQI, msgAddRef, msgRelease, msgInvoke,
};
static ICoreWebView2WebMessageReceivedEventHandler g_msgHandler = {
  (ICoreWebView2WebMessageReceivedEventHandlerVtbl*)&g_msgVtbl,
};

static void onControllerReady(ICoreWebView2Controller* ctrl) {
  (void)ctrl;
  HRESULT hr0 = ICoreWebView2Controller_get_CoreWebView2(g_ctrl, &g_wv);
  dlog(L"get_CoreWebView2 hr=0x%lx wv=%p", (unsigned long)hr0, g_wv);
  if (FAILED(hr0) || !g_wv) {
    webview2Fallback();
    return;
  }
  ICoreWebView2Settings* settings = NULL;
  if (SUCCEEDED(ICoreWebView2_get_Settings(g_wv, &settings)) && settings) {
    ICoreWebView2Settings_put_AreDefaultContextMenusEnabled(settings, FALSE);
    ICoreWebView2Settings_put_AreDevToolsEnabled(settings, FALSE);
    ICoreWebView2Settings_put_IsStatusBarEnabled(settings, FALSE);
    ICoreWebView2Settings_put_AreDefaultScriptDialogsEnabled(settings, FALSE);
    ICoreWebView2Settings_Release(settings);
  }
  EventRegistrationToken token;
  ICoreWebView2_add_WebMessageReceived(
      g_wv, &g_msgHandler, &token);
  ICoreWebView2_add_ProcessFailed(g_wv, &g_pfHandler, &token);
  ICoreWebView2_add_NavigationCompleted(g_wv, &g_navHandler, &token);
  wchar_t* html = loadResourceText(L"APP_HTML");
  dlog(L"html=%p", html);
  if (html) {
    HRESULT hr = ICoreWebView2_NavigateToString(g_wv, html);
    dlog(L"NavigateToString hr=0x%lx", (unsigned long)hr);
    free(html);
  }
  /* If the page never posts "ready" (browser process killed by AV, renderer
   * unavailable, etc.) the ready watchdog hands off to the classic wizard. */
  SetTimer(g_hwnd, TIMER_READY, READY_TIMEOUT_MS, NULL);
}

/* ------------------------------------------------------------------ */
/* Window                                                              */
/* ------------------------------------------------------------------ */

static LRESULT CALLBACK wndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
  switch (msg) {
    case WM_NCCALCSIZE:
      /* Frameless-but-shadowed: WS_THICKFRAME stays for the resize border,
       * DWM shadow and Aero snap; zeroing the non-client area removes the
       * caption so the HTML caption strip owns the top of the window. */
      if (wp) return 0;
      break;
    case WM_SIZE:
      if (g_ctrl) {
        RECT rc;
        GetClientRect(hwnd, &rc);
        ICoreWebView2Controller_put_Bounds(g_ctrl, rc);
      }
      break;
    case WM_TIMER:
      if (wp == TIMER_PROGRESS) {
        pollInstall();
      } else if (wp == TIMER_READY) {
        /* The page never signalled ready — WebView2 created its controller
         * but the browser process died or never rendered (some AV/endpoint
         * tools kill the spawned msedgewebview2). Hand off to the classic
         * NSIS wizard rather than leaving a dead blank window. */
        KillTimer(hwnd, TIMER_READY);
        if (!g_wvReady) {
          dlog(L"ready timeout - falling back to inner GUI");
          DestroyWindow(hwnd);
          int code = runInnerGuiAndWait(NULL);
          removeDirTree(g_workDir);
          ExitProcess(code);
        }
      }
      break;
    case WM_CLOSE:
      if (g_installing) return 0; /* no cancel mid-install */
      DestroyWindow(hwnd);
      return 0;
    case WM_DESTROY:
      /* Never call ICoreWebView2Controller_Close here: when the browser
       * process died, Close on the dead controller can crash inside
       * EmbeddedBrowserWebView.dll. The process exits right after anyway. */
      g_ctrl = NULL;
      g_wv = NULL;
      PostQuitMessage(0);
      return 0;
  }
  return DefWindowProcW(hwnd, msg, wp, lp);
}

static int runGui(void) {
  /* Test hook: force the classic-wizard path without a broken WebView2
   * (CI/manual QA coverage for the same degradation users hit when the
   * runtime is missing). */
  if (GetEnvironmentVariableW(L"DSHD_SETUP_FORCE_FALLBACK", NULL, 0)) {
    dlog(L"DSHD_SETUP_FORCE_FALLBACK set - skipping WebView2");
    return runInnerGuiAndWait(NULL);
  }
  /* Extract the loader + page before showing anything; if the WebView2
   * loader or runtime is missing we hand off to the classic wizard. */
  wchar_t loaderPath[MAX_PATH];
  swprintf(loaderPath, ARRAYSIZE(loaderPath), L"%s\\WebView2Loader.dll", g_workDir);
  if (!extractResource(L"WV2LOADER", loaderPath)) return runInnerGuiAndWait(NULL);
  HMODULE loader = LoadLibraryExW(loaderPath, NULL, LOAD_WITH_ALTERED_SEARCH_PATH);
  CreateEnvFn createEnv = NULL;
  if (loader) {
    createEnv = (CreateEnvFn)GetProcAddress(loader, "CreateCoreWebView2EnvironmentWithOptions");
  }
  dlog(L"loader=%p createEnv=%p", loader, createEnv);
  if (!createEnv) return runInnerGuiAndWait(NULL);

  int dpi = (int)GetDpiForSystem();
  int w = MulDiv(WIN_W, dpi, 96);
  int h = MulDiv(WIN_H, dpi, 96);
  int x = (GetSystemMetrics(SM_CXSCREEN) - w) / 2;
  int y = (GetSystemMetrics(SM_CYSCREEN) - h) / 2;

  WNDCLASSW wc;
  ZeroMemory(&wc, sizeof(wc));
  wc.style = CS_HREDRAW | CS_VREDRAW;
  wc.lpfnWndProc = wndProc;
  wc.hInstance = GetModuleHandleW(NULL);
  wc.hIcon = LoadIconW(wc.hInstance, MAKEINTRESOURCEW(1));
  wc.hCursor = LoadCursorW(NULL, IDC_ARROW);
  wc.lpszClassName = L"DshdSetupStub";
  wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
  RegisterClassW(&wc);

  /* Frameless installer window: THICKFRAME keeps the DWM shadow + invisible
   * resize edges, WM_NCCALCSIZE removes the caption, and the HTML page draws
   * the merged title strip. No maximize (fixed dialog semantics). */
  g_hwnd = CreateWindowExW(0, wc.lpszClassName, L"Deepseek-Harness-Desktop",
                         WS_OVERLAPPEDWINDOW & ~WS_MAXIMIZEBOX | WS_CLIPCHILDREN,
                         x < 0 ? 0 : x, y < 0 ? 0 : y, w, h,
                         NULL, NULL, wc.hInstance, NULL);
  if (!g_hwnd) return runInnerGuiAndWait(NULL);
  {
    DWORD cornerPref = DWMWCP_ROUND;
    DwmSetWindowAttribute(g_hwnd, DWMWA_WINDOW_CORNER_PREFERENCE,
                          &cornerPref, sizeof(cornerPref));
  }
  ShowWindow(g_hwnd, SW_SHOW);

  wchar_t udDir[MAX_PATH];
  swprintf(udDir, ARRAYSIZE(udDir), L"%s\\wv2ud", g_workDir);
  HRESULT hr = createEnv(NULL, udDir, NULL, &g_envHandler);
  dlog(L"createEnv hr=0x%lx", (unsigned long)hr);
  if (FAILED(hr)) {
    DestroyWindow(g_hwnd);
    return runInnerGuiAndWait(NULL);
  }

  MSG msg;
  while (GetMessageW(&msg, NULL, 0, 0) > 0) {
    TranslateMessage(&msg);
    DispatchMessageW(&msg);
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* Entry                                                               */
/* ------------------------------------------------------------------ */

static int fail(const wchar_t* text) {
  MessageBoxW(NULL, text, L"Deepseek-Harness-Desktop", MB_OK | MB_ICONERROR);
  return 2;
}

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE prev, PWSTR cmd, int show) {
  (void)prev; (void)show;
  CoInitializeEx(NULL, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
  GetModuleFileNameW(inst, g_selfPath, (DWORD)ARRAYSIZE(g_selfPath));

  LPWSTR cmdline = GetCommandLineW();
  /* Match /S and /D= as whole tokens: a space or quote must precede the flag
   * so an exe path containing "/S" cannot false-positive. */
  BOOL silent = FALSE;
  wchar_t dArg[MAX_PATH] = {0};
  for (const wchar_t* p = cmdline; *p; p++) {
    if (*p != L'/' || (p != cmdline && p[-1] != L' ' && p[-1] != L'"')) continue;
    wchar_t c = p[1];
    wchar_t end = p[2];
    if ((c == L'S' || c == L's') && (end == 0 || end == L' ' || end == L'"')) {
      silent = TRUE;
    } else if ((c == L'D' || c == L'd') && p[2] == L'=') {
      /* /D=<path> pass-through for scripted silent installs (NSIS rule:
       * unquoted, runs to end of command line). */
      lstrcpynW(dArg, p + 3, (int)ARRAYSIZE(dArg));
      size_t len = wcslen(dArg);
      while (len && (dArg[len - 1] == L' ' || dArg[len - 1] == L'"')) dArg[--len] = 0;
    }
  }

  if (!readManifest(g_selfPath, &g_manifest)) {
    return fail(L"This is not a complete Deepseek-Harness-Desktop installer package.");
  }

  /* Work dir: %TEMP%\dshd-setup-<pid> */
  wchar_t temp[MAX_PATH];
  GetTempPathW((DWORD)ARRAYSIZE(temp), temp);
  swprintf(g_workDir, ARRAYSIZE(g_workDir), L"%sdshd-setup-%lu", temp,
           (unsigned long)GetCurrentProcessId());
  if (!CreateDirectoryW(g_workDir, NULL)
      && GetLastError() != ERROR_ALREADY_EXISTS) {
    return fail(L"Cannot create a working directory in %TEMP%.");
  }

  /* Stream the appended payload out to the inner NSIS installer. */
  swprintf(g_innerPath, ARRAYSIZE(g_innerPath), L"%s\\%s", g_workDir, INNER_EXE_NAME);
  HANDLE in = CreateFileW(g_selfPath, GENERIC_READ, FILE_SHARE_READ, NULL,
                          OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
  HANDLE out = CreateFileW(g_innerPath, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS,
                           FILE_ATTRIBUTE_NORMAL, NULL);
  if (in == INVALID_HANDLE_VALUE || out == INVALID_HANDLE_VALUE) {
    if (in != INVALID_HANDLE_VALUE) CloseHandle(in);
    if (out != INVALID_HANDLE_VALUE) CloseHandle(out);
    return fail(L"Cannot unpack the installer payload.");
  }
  LARGE_INTEGER ofs;
  ofs.QuadPart = (LONGLONG)g_manifest.payloadOfs;
  SetFilePointerEx(in, ofs, NULL, FILE_BEGIN);
  unsigned char buf[256 * 1024];
  unsigned long long left = g_manifest.payloadLen;
  BOOL copyOk = TRUE;
  while (left) {
    DWORD want = left > sizeof(buf) ? (DWORD)sizeof(buf) : (DWORD)left;
    DWORD got = 0, put = 0;
    if (!ReadFile(in, buf, want, &got, NULL) || got != want) { copyOk = FALSE; break; }
    if (!WriteFile(out, buf, got, &put, NULL) || put != got) { copyOk = FALSE; break; }
    left -= got;
  }
  CloseHandle(in);
  CloseHandle(out);
  if (!copyOk) {
    removeDirTree(g_workDir);
    return fail(L"Cannot unpack the installer payload.");
  }

  int code;
  if (silent) {
    HANDLE proc = runInner(TRUE, dArg[0] ? dArg : NULL);
    if (!proc) {
      code = 1201;
    } else {
      WaitForSingleObject(proc, INFINITE);
      DWORD c = 1;
      GetExitCodeProcess(proc, &c);
      CloseHandle(proc);
      code = (int)c;
    }
  } else {
    code = runGui();
  }
  removeDirTree(g_workDir);
  CoUninitialize();
  return code;
}
