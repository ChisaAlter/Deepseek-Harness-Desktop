const fs = require("node:fs");
const path = require("node:path");
const pkg = require("./package.json");
const appVariant = process.env.APP_VARIANT ?? "production";

// Android versionCode must be a monotonically increasing integer and must be
// unique per uploaded APK/AAB. Google Play rejects uploads whose versionCode
// is not greater than every previously uploaded build.
//
// Derive it from the semver as `major*10000 + minor*100 + patch` so that any
// version bump produces a strictly larger code (e.g. 1.0.1 -> 10001,
// 1.2.3 -> 10203, 2.5.1 -> 20501). The 10000/100 multipliers leave headroom
// for up to 99 minors per major and 99 patches per minor, which is well
// beyond any realistic release cadence.
//
// EAS Build's `autoIncrement: versionCode` (see eas.json) still works on top
// of this baseline: it increments the remote value by 1 each build, so the
// final uploaded code is always >= this computed floor.
const versionParts = pkg.version.split(".");
const major = Number.parseInt(versionParts[0] ?? "0", 10) || 0;
const minor = Number.parseInt(versionParts[1] ?? "0", 10) || 0;
const patch = Number.parseInt(versionParts[2] ?? "0", 10) || 0;
const androidVersionCode = major * 10000 + minor * 100 + patch;

function resolveSecretFile(params) {
  const fromEnv = process.env[params.envKey];
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }

  const fallbackAbsolutePath = path.resolve(__dirname, params.fallbackRelativePath);
  if (fs.existsSync(fallbackAbsolutePath)) {
    return params.fallbackRelativePath;
  }

  return undefined;
}

const variants = {
  production: {
    name: "ChisaCode",
    packageId: "sh.chisacode",
    googleServicesFile: resolveSecretFile({
      envKey: "GOOGLE_SERVICES_FILE_PROD",
      fallbackRelativePath: "./.secrets/google-services.prod.json",
    }),
    googleServiceInfoPlist: resolveSecretFile({
      envKey: "GOOGLE_SERVICE_INFO_PLIST_PROD",
      fallbackRelativePath: "./.secrets/GoogleService-Info.prod.plist",
    }),
  },
  development: {
    name: "ChisaCode Debug",
    packageId: "sh.chisacode.debug",
    googleServicesFile: resolveSecretFile({
      envKey: "GOOGLE_SERVICES_FILE_DEBUG",
      fallbackRelativePath: "./.secrets/google-services.debug.json",
    }),
    googleServiceInfoPlist: resolveSecretFile({
      envKey: "GOOGLE_SERVICE_INFO_PLIST_DEBUG",
      fallbackRelativePath: "./.secrets/GoogleService-Info.debug.plist",
    }),
  },
};

const variant = variants[appVariant] ?? variants.production;

export default {
  expo: {
    name: variant.name,
    slug: "chisacode",
    version: pkg.version,
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "chisacode",
    userInterfaceStyle: "automatic",
    runtimeVersion: {
      policy: "appVersion",
    },
    updates: {
      url: "https://u.expo.dev/0e7f65ce-0367-46c8-a238-2b65963d235a",
    },
    ios: {
      supportsTablet: true,
      infoPlist: {
        NSMicrophoneUsageDescription: "ChisaCode需要使用麦克风来进行语音命令。",
        ITSAppUsesNonExemptEncryption: false,
      },
      bundleIdentifier: variant.packageId,
      ...(variant.googleServiceInfoPlist
        ? { googleServicesFile: variant.googleServiceInfoPlist }
        : {}),
    },
    android: {
      adaptiveIcon: {
        backgroundColor: "#160709",
        foregroundImage: "./assets/images/android-icon-foreground.png",
      },
      predictiveBackGestureEnabled: true,
      softwareKeyboardLayoutMode: "resize",
      // Allow HTTP connections for local network hosts (required for release builds)
      usesCleartextTraffic: true,
      permissions: [
        "RECORD_AUDIO",
        "android.permission.RECORD_AUDIO",
        "android.permission.MODIFY_AUDIO_SETTINGS",
        "CAMERA",
        "android.permission.CAMERA",
        "android.permission.FOREGROUND_SERVICE",
        "android.permission.FOREGROUND_SERVICE_DATA_SYNC",
        "android.permission.POST_NOTIFICATIONS",
      ],
      package: variant.packageId,
      versionCode: androidVersionCode,
      ...(variant.googleServicesFile ? { googleServicesFile: variant.googleServicesFile } : {}),
    },
    web: {
      output: "single",
      favicon: "./assets/images/favicon.png",
    },
    autolinking: {
      searchPaths: ["../../node_modules", "./node_modules", "./modules"],
    },
    plugins: [
      "./plugins/with-android-export-embed-cli",
      "expo-asset",
      "expo-secure-store",
      "expo-router",
      [
        "expo-camera",
        {
          cameraPermission: "允许 $(PRODUCT_NAME) 使用相机扫描配对二维码。",
        },
      ],
      [
        "expo-splash-screen",
        {
          image: "./assets/images/splash-icon.png",
          imageWidth: 200,
          resizeMode: "contain",
          backgroundColor: "#ffffff",
          dark: {
            backgroundColor: "#000000",
          },
        },
      ],
      [
        "expo-notifications",
        {
          icon: "./assets/images/notification-icon.png",
          color: "#ff5365",
        },
      ],
      "expo-audio",
      [
        "expo-build-properties",
        {
          android: {
            minSdkVersion: 29,
            kotlinVersion: "2.1.20",
            // Allow HTTP connections for local network hosts in release builds
            usesCleartextTraffic: true,
          },
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
      autolinkingModuleResolution: process.env.CHISACODE_WEB_PLATFORM !== "electron",
    },
    extra: {
      router: {},
      eas: {
        projectId: "0e7f65ce-0367-46c8-a238-2b65963d235a",
      },
    },
    owner: "getchisacode",
  },
};
