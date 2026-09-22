{
  lib,
  stdenv,
  buildNpmPackage,
  nodejs_22,
  python3,
  makeWrapper,
  copyDesktopItems,
  makeDesktopItem,
  electron,
  libuv,
  # Reuse the daemon's prebuilt npm-deps FOD. Same lockfile, same content —
  # without this, the desktop drv produces a separately-named store path
  # (`chisacode-desktop-<v>-npm-deps`) and refetches the entire registry. Override
  # the upstream hash via `chisacode.override { npmDepsHash = "..."; }`.
  chisacode,
}:

buildNpmPackage rec {
  pname = "chisacode-desktop";
  version = (builtins.fromJSON (builtins.readFile ../package.json)).version;

  src = lib.cleanSourceWith {
    src = ./..;
    filter =
      path: type:
      let
        baseName = builtins.baseNameOf path;
        relPath = lib.removePrefix (toString ./..) path;
      in
      # Exclude mobile-only platform code (we only need the web/electron build)
      !(lib.hasPrefix "/packages/app/android" relPath)
      && !(lib.hasPrefix "/packages/app/ios" relPath)
      # Test fixtures and build artifacts
      && !(lib.hasSuffix ".test.ts" baseName)
      && !(lib.hasSuffix ".e2e.test.ts" baseName)
      && baseName != "node_modules"
      && baseName != ".git"
      && baseName != ".chisacode"
      && baseName != ".DS_Store"
      && baseName != "release";
  };

  nodejs = nodejs_22;
  inherit (chisacode) npmDeps;

  # Prevent onnxruntime-node's install script from running during automatic
  # npm rebuild. We manually rebuild only node-pty in buildPhase.
  npmRebuildFlags = [ "--ignore-scripts" ];

  nativeBuildInputs = [
    python3 # for node-gyp (node-pty)
    makeWrapper
    copyDesktopItems
  ];

  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [ libuv ];

  dontNpmBuild = true;

  env = {
    EXPO_NO_TELEMETRY = "1";
    # Expo's web build pulls in some pre-bundled assets; ensure it doesn't try
    # to phone home during the build.
    CI = "1";
  };

  buildPhase = ''
    runHook preBuild

    # Native deps (terminal emulation; libuv-linked on Linux)
    npm rebuild node-pty

    # Server workspaces (highlight + relay + protocol + client + server + cli)
    npm run build:server

    # App workspace deps not covered by build:server
    npm run build --workspace=@chisacode/expo-two-way-audio

    # Expo web export for the Electron renderer
    ( cd packages/app && CHISACODE_WEB_PLATFORM=electron npx expo export --platform web )

    # Desktop main process (tsc only — NOT electron-builder)
    npm run build:main --workspace=@chisacode/desktop

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/share/chisacode-desktop $out/bin

    # Preserve the monorepo layout so main.js's dev-mode path resolution
    # (`__dirname/../../app/dist`, `__dirname/../assets/icon.png`) works
    # without patching: invoked unpackaged via `electron path/to/main.js`,
    # `app.isPackaged` is false, so these relative paths are used.
    #
    # Copy the entire packages/ tree (not just built artifacts) because npm
    # creates workspace symlinks from node_modules/@chisacode/* into packages/*.
    # Missing any workspace package leaves dangling symlinks and fails the
    # noBrokenSymlinks output check. The cleanSourceWith filter above already
    # drops the big platform-specific things (android/ios, tests).
    cp package.json $out/share/chisacode-desktop/
    cp -a packages $out/share/chisacode-desktop/
    cp -a node_modules $out/share/chisacode-desktop/

    # Skills directory referenced at runtime by some agents
    if [ -d skills ]; then
      cp -a skills $out/share/chisacode-desktop/
    fi

    # Hicolor icon for desktop environments
    install -Dm644 packages/desktop/assets/icon.png \
      $out/share/icons/hicolor/512x512/apps/chisacode-desktop.png

    # Launcher wraps nixpkgs electron.
    # --no-sandbox: Chromium's setuid sandbox can't live in /nix/store
    # (immutable, no setuid). Acceptable for v1; a follow-up can wire
    # `security.wrappers` via a NixOS module for users who want the sandbox.
    #
    # EXPO_DEV_URL: We run unpackaged via `electron path/to/main.js`, so
    # `app.isPackaged` is false. In that mode main.ts loads `DEV_SERVER_URL`
    # (defaults to http://localhost:8081 — the Expo dev server, which doesn't
    # exist here). Point it at the `chisacode://` protocol handler instead, which
    # serves from `__dirname/../../app/dist` (our install layout matches).
    makeWrapper ${electron}/bin/electron $out/bin/chisacode-desktop \
      --add-flags "$out/share/chisacode-desktop/packages/desktop/dist/main.js" \
      --add-flags "--no-sandbox" \
      --set EXPO_DEV_URL "chisacode://app/"

    copyDesktopItems

    runHook postInstall
  '';

  desktopItems = [
    (makeDesktopItem {
      name = "chisacode-desktop";
      desktopName = "ChisaCode";
      genericName = "AI Coding Agents";
      comment = "Self-hosted daemon for AI coding agents";
      exec = "chisacode-desktop";
      icon = "chisacode-desktop";
      categories = [ "Development" ];
      startupWMClass = "ChisaCode";
    })
  ];

  meta = {
    description = "ChisaCode desktop app (Electron wrapper)";
    homepage = "https://github.com/getchisacode/chisacode";
    license = lib.licenses.agpl3Plus;
    mainProgram = "chisacode-desktop";
    platforms = lib.platforms.linux;
  };
}
