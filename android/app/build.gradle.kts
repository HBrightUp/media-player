import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

val apiBaseUrlProvider = providers.gradleProperty("apiBaseUrl").orElse("http://10.0.2.2:9000")
val releaseDateProvider = providers.gradleProperty("releaseDate").orElse("2026-07-18")
val releaseKeystorePropertiesFile = providers.gradleProperty("hmlReleaseKeystoreProperties")
    .map { file(it) }
    .orElse(
        providers.provider {
            file("${System.getProperty("user.home")}/.hml-media-player/keystore/keystore.properties")
        },
    )
val releaseKeystoreProperties = Properties()
val resolvedReleaseKeystorePropertiesFile = releaseKeystorePropertiesFile.get()
if (resolvedReleaseKeystorePropertiesFile.isFile) {
    resolvedReleaseKeystorePropertiesFile.inputStream().use(releaseKeystoreProperties::load)
}

fun releaseSigningProperty(name: String): String? {
    return providers.gradleProperty(name).orNull
        ?: providers.environmentVariable(name).orNull
        ?: releaseKeystoreProperties.getProperty(name)
}

val releaseSigningStoreFilePath = releaseSigningProperty("HML_RELEASE_STORE_FILE")
val releaseSigningConfigured =
    !releaseSigningStoreFilePath.isNullOrBlank() &&
        file(releaseSigningStoreFilePath).isFile &&
        !releaseSigningProperty("HML_RELEASE_STORE_PASSWORD").isNullOrBlank() &&
        !releaseSigningProperty("HML_RELEASE_KEY_ALIAS").isNullOrBlank() &&
        !releaseSigningProperty("HML_RELEASE_KEY_PASSWORD").isNullOrBlank()

android {
    namespace = "com.hml.mediaplayer"
    compileSdk {
        version = release(37) {
            minorApiLevel = 0
        }
    }

    defaultConfig {
        applicationId = "com.hml.mediaplayer"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"

        val apiBaseUrl = apiBaseUrlProvider.get()
            .trim()
            .trimEnd('/')
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
        buildConfigField("String", "API_BASE_URL", "\"$apiBaseUrl\"")
        buildConfigField("String", "RELEASE_DATE", "\"${releaseDateProvider.get()}\"")
    }

    signingConfigs {
        if (releaseSigningConfigured) {
            create("release") {
                storeFile = file(releaseSigningStoreFilePath!!)
                storePassword = releaseSigningProperty("HML_RELEASE_STORE_PASSWORD")!!
                keyAlias = releaseSigningProperty("HML_RELEASE_KEY_ALIAS")!!
                keyPassword = releaseSigningProperty("HML_RELEASE_KEY_PASSWORD")!!
            }
        }
    }

    buildTypes {
        release {
            if (releaseSigningConfigured) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    buildFeatures {
        buildConfig = true
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlin {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        }
    }
}

gradle.taskGraph.whenReady {
    val releaseApkRequested = allTasks.any { task ->
        task.name in setOf("assembleRelease", "bundleRelease", "packageRelease")
    }
    if (releaseApkRequested && !releaseSigningConfigured) {
        throw org.gradle.api.GradleException(
            "缺少 release 签名配置。请确认 ${resolvedReleaseKeystorePropertiesFile.absolutePath} 存在，" +
                "或通过 HML_RELEASE_STORE_FILE/HML_RELEASE_STORE_PASSWORD/HML_RELEASE_KEY_ALIAS/HML_RELEASE_KEY_PASSWORD 提供配置。",
        )
    }
}

dependencies {
    val activityVersion = "1.13.0"
    val lifecycleVersion = "2.11.0"
    val media3Version = "1.10.1"

    implementation(platform("androidx.compose:compose-bom:2026.06.00"))
    implementation("androidx.activity:activity-compose:$activityVersion")
    implementation("androidx.activity:activity-ktx:$activityVersion")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:$lifecycleVersion")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:$lifecycleVersion")
    implementation("androidx.media3:media3-common:$media3Version")
    implementation("androidx.media3:media3-datasource:$media3Version")
    implementation("androidx.media3:media3-exoplayer:$media3Version")
    implementation("androidx.media3:media3-session:$media3Version")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")

    debugImplementation("androidx.compose.ui:ui-tooling")
}
