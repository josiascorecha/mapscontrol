import java.io.File

plugins {
    id("com.android.application")
}

fun prop(name: String): String = providers.gradleProperty(name).get()
val host = prop("mapscontrol.host")

android {
    namespace = "br.com.j2bot.mapscontrol"
    compileSdk = 36

    defaultConfig {
        applicationId = prop("mapscontrol.applicationId")
        minSdk = 23
        targetSdk = 36 // Google Play: API 36 obrigatória para novos apps desde 31/08/2026
        versionCode = prop("mapscontrol.versionCode").toInt()
        versionName = prop("mapscontrol.versionName")

        manifestPlaceholders["hostName"] = host
        manifestPlaceholders["defaultUrl"] = "https://$host/?source=android"
        manifestPlaceholders["launcherName"] = "MapsControl"
        resValue("string", "asset_statements",
            """[{ "relation": ["delegate_permission/common.handle_all_urls"], "target": { "namespace": "web", "site": "https://$host" } }]""")
    }

    // Assinatura: lida SOMENTE de variáveis de ambiente (nunca do repositório).
    //   MC_KEYSTORE_PATH, MC_KEYSTORE_PASSWORD, MC_KEY_ALIAS, MC_KEY_PASSWORD
    val ksPath = System.getenv("MC_KEYSTORE_PATH")
    signingConfigs {
        if (ksPath != null && File(ksPath).exists()) {
            create("upload") {
                storeFile = File(ksPath)
                storePassword = System.getenv("MC_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("MC_KEY_ALIAS")
                keyPassword = System.getenv("MC_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfigs.findByName("upload")?.let { signingConfig = it }
        }
    }

    buildFeatures {
        resValues = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.7.3")
}
