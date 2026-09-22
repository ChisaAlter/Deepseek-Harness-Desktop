plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

val mobileWebAssets = layout.buildDirectory.dir("generated/mobileWebAssets")
val stageMobileWebAssets by tasks.registering(Exec::class) {
    val source = rootProject.file("../web")
    val tool = rootProject.file("../../tools/mobile-web-qa/runtime-assets.mjs")
    inputs.dir(source)
    inputs.file(tool)
    outputs.dir(mobileWebAssets)
    commandLine("node", tool.absolutePath, "stage", "--source", source.absolutePath,
        "--output", mobileWebAssets.get().asFile.absolutePath)
}

// AGP resolves source-set directories without retaining FileCollection builtBy.
tasks.named("preBuild") {
    dependsOn(stageMobileWebAssets)
}

android {
    namespace = "ai.deepseek.harness.mobile"
    compileSdk = 36
    defaultConfig {
        applicationId = "ai.deepseek.harness.mobile"
        minSdk = 26
        targetSdk = 36
        versionCode = 2
        versionName = "0.1.1"
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }
    sourceSets {
        getByName("main") {
            // Package the repaired mobile/web SPA as the single Android chat
            // implementation. WebViewAssetLoader serves these files from its
            // secure HTTPS origin, so sticky relay reconnect does not depend
            // on the desktop's LAN :3180 server after initial pairing.
            assets.srcDir(files(mobileWebAssets).builtBy(stageMobileWebAssets))
        }
    }
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation(project(":protocol"))
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("androidx.webkit:webkit:1.16.0")
    implementation("androidx.camera:camera-core:1.4.1")
    implementation("androidx.camera:camera-camera2:1.4.1")
    implementation("androidx.camera:camera-lifecycle:1.4.1")
    implementation("androidx.camera:camera-view:1.4.1")
    implementation("com.google.mlkit:barcode-scanning:17.3.0")
    debugImplementation("androidx.compose.ui:ui-tooling")
    testImplementation("junit:junit:4.13.2")
}
