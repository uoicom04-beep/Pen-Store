#!/usr/bin/env bash
# สร้างโปรเจกต์ Android (Capacitor) จาก renderer/ แล้วใส่โค้ดเนทีฟจาก android-overlay/
set -euo pipefail
mkdir -p /tmp/penapk && cd /tmp/penapk && rm -rf ./* 
cp -r "$GITHUB_WORKSPACE/renderer" ./www
cat > package.json <<J
{"name":"pen-store-android","version":"1.0.0","private":true}
J
npm i @capacitor/core@6 @capacitor/cli@6 @capacitor/android@6
cat > capacitor.config.json <<J
{"appId":"me.thepen.penstore","appName":"Pen Store","webDir":"www","backgroundColor":"#000000","plugins":{"CapacitorHttp":{"enabled":true}}}
J
npx cap add android
P=android/app/src/main/java/me/thepen/penstore
mkdir -p $P && cp "$GITHUB_WORKSPACE"/android-overlay/*.java $P/
M=android/app/src/main/AndroidManifest.xml
sed -i 's#</application>#<activity android:name=".GameActivity" android:exported="false" android:configChanges="orientation|screenSize|keyboardHidden|smallestScreenSize|screenLayout" android:theme="@style/AppTheme.NoActionBar" /></application>#' $M
# ไอคอนแอป
for d in android/app/src/main/res/mipmap-*; do cp "$GITHUB_WORKSPACE/build/icon.png" $d/ic_launcher.png; cp "$GITHUB_WORKSPACE/build/icon.png" $d/ic_launcher_round.png; rm -f $d/ic_launcher_foreground.png; done
rm -rf android/app/src/main/res/mipmap-anydpi-v26
npx cap sync android
cd android && chmod +x gradlew && ./gradlew assembleDebug --no-daemon
cp app/build/outputs/apk/debug/app-debug.apk "$GITHUB_WORKSPACE/PenStore.apk"
