#!/usr/bin/env bash
# Runs inside the emulator job: install, open, exercise, collect the log.
set -x
PKG=com.straycat.rssreader
adb install -r test.apk
adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS || true
adb logcat -c
adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1
sleep 45
adb shell dumpsys activity activities | grep -i "$PKG" | head -5
# Press back a few times, then reopen.
adb shell input keyevent KEYCODE_BACK; sleep 2
adb shell input keyevent KEYCODE_BACK; sleep 2
adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1
sleep 15
adb logcat -d -v time > logcat-full.txt
grep -E "AndroidRuntime|FATAL|DEBUG|libc|straycat|Tauri|tauri|RustStdoutStderr|panicked|WM-|chromium|Console" logcat-full.txt > logcat-app.txt || true
echo "---- crash lines ----"
grep -E -A 30 "FATAL EXCEPTION|panicked|Fatal signal" logcat-full.txt | head -120 || true
exit 0
