#!/usr/bin/env bash
# Strict test of the Android app's automatic backup, on the "pstest" Android emulator.
# Everything happens without touching the app after sign-in: screen off + deep sleep,
# bursts, duplicates, reinstall, app killed, restart, offline, a big video cut mid-way.
# Ends with a full check: every photo/video on the phone is on the PC byte for byte
# (MD5), and the PC has no duplicates. Uses only "zz-test" files and removes them after.
#
# Needs: the emulator running (booted with -writable-system, hosts file mapping the
# Tailscale name), the app built (android/dist/PuneetStudios.apk), the PC app running.
# Usage (Git Bash):  bash scripts/test-android-sync.sh
set -uo pipefail
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ADB="$LOCALAPPDATA/PuneetStudiosBuild/sdk/platform-tools/adb.exe"
MEDIA="$USERPROFILE/Desktop/Phone Media"
MEDIA="${MEDIA//\\//}"
APK="$(cygpath -w "$ROOT/android/dist/PuneetStudios.apk")"
CAM=/sdcard/DCIM/Camera
WA=/sdcard/Android/media/com.whatsapp/WhatsApp/Media/WhatsApp\ Images
TMPD="$(mktemp -d)"
ROOTW="$(cygpath -m "$ROOT")"
TMPW="$(cygpath -m "$TMPD")"
FAILS=0
pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; FAILS=$((FAILS + 1)); }
check() { if eval "$2"; then pass "$1"; else fail "$1 ${3:-}"; fi; }
sh() { "$ADB" shell "$@" | tr -d '\r'; }

# A unique small JPEG (random bytes after the image keep every file different).
mkphoto() { # mkphoto <phone path>
  node -e "const s=require('$ROOTW/node_modules/sharp'),c=require('crypto');s({create:{width:640,height:480,channels:3,background:'#'+c.randomBytes(3).toString('hex')}}).jpeg().toBuffer().then(b=>require('fs').writeFileSync(process.argv[1],Buffer.concat([b,c.randomBytes(2048)])))" "$TMPW/p.jpg"
  "$ADB" push "$(cygpath -w "$TMPD/p.jpg")" "$1" >/dev/null
  scan "$1"
}
scan() { sh am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file://${1// /%20}" >/dev/null; }
on_pc() { find "$MEDIA" -name "$1" -not -path "*/.trash/*" -not -path "*/.uploads/*" 2>/dev/null | head -1; }
wait_pc() { # wait_pc <name> <seconds>
  local t=0; while [ $t -lt "$2" ]; do [ -n "$(on_pc "$1")" ] && return 0; sleep 2; t=$((t + 2)); done; return 1
}
count_pc() { find "$MEDIA" -name 'zz-test-*' -not -path '*/.trash/*' -not -path '*/.uploads/*' -type f | wc -l; }
tap_text() { # tap a button by its text (system dialogs)
  sh uiautomator dump /sdcard/ui.xml >/dev/null
  local b; b=$(sh cat /sdcard/ui.xml | grep -o "text=\"$1\"[^>]*" | grep -o 'bounds="[^"]*"' | head -1)
  [ -z "$b" ] && return 1
  read -r x1 y1 x2 y2 <<<"$(echo "$b" | grep -o '[0-9]\+' | tr '\n' ' ')"
  sh input tap $(((x1 + x2) / 2)) $(((y1 + y2) / 2)); sleep 1.5
}
# Deep sleep only happens on battery, so unplug the (virtual) charger first.
screen_off() { sh dumpsys battery unplug; sh input keyevent 223; sleep 1; sh dumpsys deviceidle force-idle >/dev/null; }
wake() { sh dumpsys deviceidle unforce >/dev/null; sh dumpsys battery reset; sh input keyevent 224; sleep 1; sh wm dismiss-keyguard >/dev/null 2>&1; }

cleanup_pc() {
  find "$MEDIA" -name 'zz-test-*' -not -path '*/.trash/*' -type f -delete 2>/dev/null
  find "$MEDIA/Phone Sync" -type d -empty -delete 2>/dev/null
  node -e "const fs=require('fs');const f=process.argv[1];try{const d=JSON.parse(fs.readFileSync(f,'utf8'));for(const k of Object.keys(d))if(k.startsWith('zz-test'))delete d[k];fs.writeFileSync(f,JSON.stringify(d))}catch{}
const h=process.argv[2];try{fs.writeFileSync(h,fs.readFileSync(h,'utf8').split('\n').filter(l=>l&&!l.includes('zz-test')).map(l=>l+'\n').join(''))}catch{}" "$MEDIA/.meta/phone-sync.json" "$MEDIA/.meta/sync-history.jsonl"
}
cleanup_phone() { sh "rm -rf $CAM/zz-test-* '$WA'" ; sh "rm -rf /sdcard/Download/Puneet\\ Studios"; sh content delete --uri content://media/external/images/media --where "\"_display_name LIKE 'zz-test-%'\"" >/dev/null 2>&1; sh content delete --uri content://media/external/video/media --where "\"_display_name LIKE 'zz-test-%'\"" >/dev/null 2>&1; }

# The login comes from .env.local (never written in the code).
env_val() { grep -E "^$1=" "$ROOT/.env.local" | head -1 | cut -d= -f2- | tr -d '"'; }
sign_in() {
  sh am start -n com.puneetstudios.app/.MainActivity >/dev/null; sleep 12
  sh input tap 540 1286; sleep 1; sh input text "$(env_val APP_USERNAME)"
  sh input tap 540 1465; sleep 1; sh input text "$(env_val APP_PASSWORD)"; sh input keyevent 66; sleep 6
  # Android asks in its own order: notifications, photos & videos, run in background.
  for _ in 1 2 3 4 5; do tap_text "ALLOW ALL" || tap_text "Allow all" || tap_text "ALLOW" || tap_text "Allow" || break; done
}

echo "== Setup =="
"$ADB" wait-for-device
sh settings put global device_name zz-test-Emulator
sh settings put global stay_on_while_plugged_in 0
cleanup_pc; cleanup_phone
"$ADB" uninstall com.puneetstudios.app >/dev/null 2>&1
sh mkdir -p "$CAM" "'$WA'"
for i in 1 2 3; do mkphoto "$CAM/zz-test-OLD$i.jpg"; done     # already on the phone before the app
"$ADB" install "$APK" | tail -1
sign_in
check "Signed in, all permissions granted" '[ "$(sh dumpsys package com.puneetstudios.app | grep -c "MEDIA.*granted=true")" -ge 3 ]'
check "Allowed to run in the background (unrestricted)" 'sh dumpsys deviceidle whitelist | grep -q com.puneetstudios.app'

echo "== First sign-in backs up what's already on the phone =="
ok=1; for i in 1 2 3; do wait_pc "zz-test-OLD$i.jpg" 60 || ok=0; done
check "3 photos already on the phone were backed up" '[ $ok = 1 ]'
check "Always-on backup service is running" '[ "$(sh dumpsys activity services com.puneetstudios.app | grep -c "SyncService")" -gt 0 ]'
check "Its notification is showing" '[ "$(sh dumpsys notification --noredact | grep -c "com.puneetstudios.app")" -gt 0 ]'

echo "== Screen off + deep sleep: photo, video, WhatsApp image, app closed =="
sh input keyevent 3; sleep 1; screen_off
check "Phone is in deep sleep" '[ "$(sh dumpsys deviceidle get deep)" = "IDLE" ]'
mkphoto "$CAM/zz-test-SLEEP.jpg"
sh "dd if=/dev/urandom of=$CAM/zz-test-SLEEPVID.mp4 bs=1048576 count=12 2>/dev/null"; scan "$CAM/zz-test-SLEEPVID.mp4"
mkphoto "$WA/zz-test-WHATSAPP.jpg"
T0=$(date +%s)
wait_pc zz-test-SLEEP.jpg 90; a=$?; wait_pc zz-test-SLEEPVID.mp4 90; b=$?; wait_pc zz-test-WHATSAPP.jpg 90; c=$?
check "Photo arrived while asleep" '[ $a = 0 ]'; check "Video arrived while asleep" '[ $b = 0 ]'; check "WhatsApp image arrived while asleep" '[ $c = 0 ]'
echo "      (all three in $(( $(date +%s) - T0 ))s; still asleep: $(sh dumpsys deviceidle get deep))"

echo "== Burst of 25 photos, screen off =="
for i in $(seq -w 1 25); do mkphoto "$CAM/zz-test-BURST$i.jpg"; done
T0=$(date +%s); for i in $(seq 1 60); do [ "$(find "$MEDIA" -name 'zz-test-BURST*' -not -path '*/.trash/*' | wc -l)" -ge 25 ] && break; sleep 2; done
n=$(find "$MEDIA" -name 'zz-test-BURST*' -not -path '*/.trash/*' | wc -l)
check "All 25 arrived (in $(( $(date +%s) - T0 ))s)" '[ "$n" -eq 25 ]' "($n)"
wake

echo "== Same photo under another name is not uploaded again =="
before=$(count_pc)
sh cp "$CAM/zz-test-SLEEP.jpg" "$CAM/zz-test-COPYOFSLEEP.jpg"; scan "$CAM/zz-test-COPYOFSLEEP.jpg"; sleep 25
check "Exact copy skipped (no duplicate on the PC)" '[ "$(count_pc)" = "$before" ] && [ -z "$(on_pc zz-test-COPYOFSLEEP.jpg)" ]'

echo "== Reinstall the app: nothing is uploaded twice =="
before=$(count_pc)
"$ADB" uninstall com.puneetstudios.app >/dev/null; "$ADB" install "$APK" | tail -1
sign_in; sleep 45
check "After reinstall, zero new files on the PC" '[ "$(count_pc)" = "$before" ]' "(before $before, now $(count_pc))"

echo "== App killed: backup comes back by itself =="
sh input keyevent 3
pid=$(sh pidof com.puneetstudios.app); "$ADB" root >/dev/null 2>&1; sleep 2; sh kill -9 "$pid"; sleep 8
mkphoto "$CAM/zz-test-AFTERKILL.jpg"
check "Photo after the app was killed arrived" 'wait_pc zz-test-AFTERKILL.jpg 90'

echo "== Phone restarted, screen off, app never opened =="
"$ADB" reboot; sleep 15; "$ADB" wait-for-device
for i in $(seq 1 60); do [ "$(sh getprop sys.boot_completed)" = "1" ] && break; sleep 3; done; sleep 20
screen_off
mkphoto "$CAM/zz-test-AFTERREBOOT.jpg"
check "Photo after restart arrived" 'wait_pc zz-test-AFTERREBOOT.jpg 120'
wake

echo "== Offline, then back online =="
sh svc wifi disable; sh svc data disable; sleep 3
mkphoto "$CAM/zz-test-OFFLINE1.jpg"; mkphoto "$CAM/zz-test-OFFLINE2.jpg"; sleep 15
check "Nothing sent while offline" '[ -z "$(on_pc zz-test-OFFLINE1.jpg)" ]'
sh svc wifi enable; sh svc data enable
ok=1; wait_pc zz-test-OFFLINE1.jpg 90 || ok=0; wait_pc zz-test-OFFLINE2.jpg 60 || ok=0
check "Both arrived when back online" '[ $ok = 1 ]'

echo "== Big video on a slow network, cut half-way, finishes by itself =="
"$ADB" emu network speed hsdpa >/dev/null
sh "dd if=/dev/urandom of=$CAM/zz-test-BIGVID.mp4 bs=1048576 count=40 2>/dev/null"; scan "$CAM/zz-test-BIGVID.mp4"
for i in $(seq 1 60); do s=$(find "$MEDIA/.uploads" -name '*.part' -size +5M 2>/dev/null | head -1); [ -n "$s" ] && break; sleep 1; done
sh svc wifi disable; sh svc data disable; sleep 8
part=$(find "$MEDIA/.uploads" -name '*.part' -printf '%s\n' 2>/dev/null | sort -n | tail -1)
echo "      cut with $(( ${part:-0} / 1048576 )) MB of 40 on the PC"
"$ADB" emu network speed full >/dev/null; sh svc wifi enable; sh svc data enable
check "Big video finished after the cut" 'wait_pc zz-test-BIGVID.mp4 240'
check "…and it is byte-for-byte identical" '[ "$(sh md5sum $CAM/zz-test-BIGVID.mp4 | cut -d" " -f1)" = "$(md5sum "$(on_pc zz-test-BIGVID.mp4)" | cut -d" " -f1)" ]'

echo "== Final check: everything on the phone is on the PC, no duplicates =="
sleep 20
sh "cd $CAM && md5sum zz-test-*" > "$TMPD/phone.txt"; sh "cd '$WA' && md5sum zz-test-*" >> "$TMPD/phone.txt"
find "$MEDIA" -name 'zz-test-*' -not -path '*/.trash/*' -not -path '*/.uploads/*' -type f -exec md5sum {} + > "$TMPD/pc.txt"
missing=0; while read -r sum name; do grep -q "^$sum " "$TMPD/pc.txt" || { missing=$((missing + 1)); echo "      missing: $name"; }; done < "$TMPD/phone.txt"
dups=$(cut -d' ' -f1 "$TMPD/pc.txt" | sort | uniq -d | wc -l)
check "Every one of $(wc -l < "$TMPD/phone.txt") phone files is on the PC, identical" '[ $missing = 0 ]'
check "No duplicates on the PC ($(wc -l < "$TMPD/pc.txt") files)" '[ "$dups" = 0 ]'
hist=$(node -e "const fs=require('fs');let t='';try{t=fs.readFileSync(process.argv[1],'utf8')}catch{};const l=t.split('\n').filter(x=>x.includes('zz-test-Emulator'));const c={};for(const x of l){const e=JSON.parse(x);c[e.status]=(c[e.status]||0)+1}console.log(JSON.stringify(c))" "$MEDIA/.meta/sync-history.jsonl")
echo "      backup history for this phone: $hist"
check "History lists every upload" 'node -e "const c=$hist; process.exit((c.uploaded||0) >= $(wc -l < "$TMPD/pc.txt") ? 0 : 1)"'

echo
if [ "${KEEP:-}" != "1" ]; then cleanup_pc; cleanup_phone; fi
rm -rf "$TMPD"
[ $FAILS = 0 ] && echo "ALL PASSED" || echo "$FAILS FAILED"
exit $FAILS
