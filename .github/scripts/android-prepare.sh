#!/usr/bin/env bash
# Generates the Android project and adds this app's own Android code to it.
set -euo pipefail
npx tauri android init --ci
npx tauri icon app-icon.png
GEN=src-tauri/gen/android/app
# Our Kotlin files go next to the generated MainActivity.
cp android-src/*.kt "$(dirname "$(find "$GEN/src/main" -name MainActivity.kt)")/"
# Background checks use Android's WorkManager.
printf '\ndependencies {\n    implementation("androidx.work:work-runtime:2.9.1")\n}\n' >> "$GEN/build.gradle.kts"
# Allow plain http:// feeds and podcast audio.
sed -i 's/manifestPlaceholders\["usesCleartextTraffic"\] = "false"/manifestPlaceholders["usesCleartextTraffic"] = "true"/' "$GEN/build.gradle.kts"
grep -n "usesCleartextTraffic\|work-runtime\|minify" "$GEN/build.gradle.kts" || true
