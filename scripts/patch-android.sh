#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Patches the Tauri-generated Android project with:
#   - Ongoing notification helper (unswipeable timeline notifications)
#   - Dark status bar matching the app theme (#0a0a0a)
#   - Transparent status bar so content can extend behind it
#   - Proper safe area inset handling
#   - Ensures INTERNET permission for Firebase sync (critical for release builds)
#
# Run this once after `tauri android init`:
#   bash scripts/patch-android.sh
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_DIR="$SCRIPT_DIR/../src-tauri/gen/android"

if [ ! -d "$ANDROID_DIR" ]; then
  echo "Error: Android project not found at $ANDROID_DIR"
  echo "Run 'npm run tauri:android:init' first."
  exit 1
fi

CYAN='\033[0;36m'
GREEN='\033[0;32m'
NC='\033[0m'

info()  { echo -e "${CYAN}[patch]${NC} $*"; }

# --- ICON FIX: Sync launcher icons from public/ to Android mipmap ---
resolve_icon_src() {
  for cand in "public/logo-512.png" "public/logo.png" "src-tauri/icons/icon.png"; do
    if [ -f "$PROJECT_ROOT/$cand" ]; then
      echo "$PROJECT_ROOT/$cand"
      return 0
    fi
  done
  return 1
}

ICON_SRC="$(resolve_icon_src || true)"
if [ -n "${ICON_SRC:-}" ]; then
  info "Syncing launcher icons from $ICON_SRC..."
  if command -v bun >/dev/null 2>&1; then
    bun run tauri icon "$ICON_SRC" 2>/dev/null && ok "Tauri icon via bun" || info "bun icon failed"
  elif command -v npx >/dev/null 2>&1; then
    npx tauri icon "$ICON_SRC" 2>/dev/null && ok "Tauri icon via npx" || info "npx icon failed"
  fi
  if command -v python3 >/dev/null 2>&1; then
    PROJECT_ROOT="$PROJECT_ROOT" python3 - <<'PYEOF'
import os, sys, pathlib
try:
    from PIL import Image
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "Pillow"])
    from PIL import Image
pr = pathlib.Path(os.environ.get("PROJECT_ROOT", "."))
cands = [pr / "public/logo-512.png", pr / "public/logo.png", pr / "src-tauri/icons/icon.png"]
src = next((c for c in cands if c.exists()), None)
if not src:
    print("No source")
    sys.exit(0)
img = Image.open(src).convert("RGBA")
gen = pr / "src-tauri/gen/android/app/src/main/res"
cfgs = {
    "mipmap-mdpi": {"launcher": 48, "foreground": 108},
    "mipmap-hdpi": {"launcher": 72, "foreground": 162},
    "mipmap-xhdpi": {"launcher": 96, "foreground": 216},
    "mipmap-xxhdpi": {"launcher": 144, "foreground": 324},
    "mipmap-xxxhdpi": {"launcher": 192, "foreground": 432},
}
for folder, sz in cfgs.items():
    d = gen / folder
    d.mkdir(parents=True, exist_ok=True)
    for name in ["ic_launcher.png", "ic_launcher_round.png"]:
        r = img.resize((sz["launcher"], sz["launcher"]), Image.LANCZOS)
        r.save(d / name, "PNG")
    r = img.resize((sz["foreground"], sz["foreground"]), Image.LANCZOS)
    r.save(d / "ic_launcher_foreground.png", "PNG")
print("Manual sync done")
# desktop icons
dd = pr / "src-tauri/icons"
dd.mkdir(parents=True, exist_ok=True)
for size, fname in [(32, "32x32.png"), (32, "32.png"), (16, "16.png"), (48, "48.png"), (64, "64x64.png"), (128, "128x128.png"), (256, "128x128@2x.png"), (256, "256.png"), (512, "icon.png")]:
    try:
        r = img.resize((size, size), Image.LANCZOS)
        r.save(dd / fname, "PNG")
    except Exception as e:
        print(f"fail {fname} {e}")
try:
    ico_path = dd / "icon.ico"
    sizes = [16,24,32,48,64,256]
    imgs = [img.resize((s,s), Image.LANCZOS) for s in sizes]
    imgs[-1].save(ico_path, format="ICO", sizes=[(s,s) for s in sizes])
    print(f"ico {ico_path}")
except Exception as e:
    print(f"ico fail {e}")
PYEOF
    ok "Manual icon sync done"
  fi
fi


ok()    { echo -e "${GREEN}[patch]${NC} $*"; }

# ─── 1. Install OngoingNotificationHelper.kt ──────────────────────────────────
# Find the Kotlin source directory (varies by project name)
KOTLIN_SRC=$(find "$ANDROID_DIR/app/src/main/java" -type d -maxdepth 4 | head -1)

if [ -z "$KOTLIN_SRC" ]; then
  echo "Error: Could not find Kotlin source directory"
  exit 1
fi

info "Installing OngoingNotificationHelper.kt to $KOTLIN_SRC"
cp "$SCRIPT_DIR/android-ongoing-notif/OngoingNotificationHelper.kt" "$KOTLIN_SRC/"
ok "Installed OngoingNotificationHelper.kt"

# ─── 1b. Ensure INTERNET permission exists (critical for Firebase on Android)
MANIFEST="$ANDROID_DIR/app/src/main/AndroidManifest.xml"

if [ -f "$MANIFEST" ]; then
  if ! grep -q "android.permission.INTERNET" "$MANIFEST"; then
    info "Adding INTERNET permission to AndroidManifest.xml"
    # Insert INTERNET permission before <application>
    sed -i 's/<application/<uses-permission android:name="android.permission.INTERNET" \/>\n    <application/' "$MANIFEST"
    ok "Added INTERNET permission"
  else
    ok "INTERNET permission already present"
  fi

  if ! grep -q "android.permission.ACCESS_NETWORK_STATE" "$MANIFEST"; then
    info "Adding ACCESS_NETWORK_STATE permission"
    sed -i 's/<uses-permission android:name="android.permission.INTERNET" \/>/<uses-permission android:name="android.permission.INTERNET" \/>\n    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" \/>/' "$MANIFEST"
    ok "Added ACCESS_NETWORK_STATE permission"
  fi
fi

# ─── 2. Patch AndroidManifest.xml for status bar color ────────────────────────
if [ -f "$MANIFEST" ]; then
  if ! grep -q "android.statusbar.color" "$MANIFEST"; then
    sed -i '/<application/,/>/ {
      /android:usesCleartextTraffic/a\        <meta-data android:name="android.window.statusBarColor" android:value="#0a0a0a" />\n        <meta-data android:name="android.window.navigationBarColor" android:value="#0a0a0a" />
    }' "$MANIFEST" 2>/dev/null || true
    ok "Added status/navigation bar color metadata"
  fi
fi

# ─── 3. Patch styles.xml for the dark status bar ──────────────────────────────
STYLES_DIR="$ANDROID_DIR/app/src/main/res/values"
mkdir -p "$STYLES_DIR"

STYLES_FILE="$STYLES_DIR/styles.xml"
if [ ! -f "$STYLES_FILE" ]; then
  cat > "$STYLES_FILE" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="Theme.Drugucopia" parent="Theme.AppCompat.NoActionBar">
        <item name="android:statusBarColor">#0a0a0a</item>
        <item name="android:navigationBarColor">#0a0a0a</item>
        <item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>
    </style>
</resources>
EOF
  ok "Created styles.xml with dark status/nav bar"
fi

# ─── 4. Patch AndroidManifest.xml to use our theme ────────────────────────────
if [ -f "$MANIFEST" ]; then
  if ! grep -q "Theme.Drugucopia" "$MANIFEST"; then
    sed -i 's/android:theme="[^"]*"/android:theme="@style\/Theme.Drugucopia"/' "$MANIFEST" 2>/dev/null || true
    ok "Applied Theme.Drugucopia to manifest"
  fi
fi

# ─── 5. Ensure the dependency on AndroidX core (for NotificationCompat) ───────
# The Tauri Android project should already have this, but just in case.
GRADLE_FILE="$ANDROID_DIR/app/build.gradle.kts"
if [ -f "$GRADLE_FILE" ]; then
  if ! grep -q "androidx.core" "$GRADLE_FILE"; then
    # Add the dependency
    sed -i '/dependencies {/a\    implementation("androidx.core:core:1.13.1")' "$GRADLE_FILE" 2>/dev/null || true
    ok "Added androidx.core dependency for NotificationCompat"
  fi
fi

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Android patch complete!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo ""
echo "  Installed:"
echo "    • OngoingNotificationHelper.kt (unswipeable notifications)"
echo "    • Dark status/nav bar theme"
echo "    • Edge-to-edge display mode"
echo "    • INTERNET + ACCESS_NETWORK_STATE permissions (Firebase)"
echo ""
echo "  Next step: npm run tauri:android:dev"
echo ""
