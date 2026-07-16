#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Android dev/build wrapper for Drugucopia's Tauri app.
#
# The project supports physical ARM Android devices only:
#   - aarch64 / arm64-v8a
#   - armv7 / armeabi-v7a
#
# Linkers are provided to Cargo through process-local environment variables.
# No machine-specific paths are written to src-tauri/.cargo/config.toml.
#
# Usage:
#   bash scripts/android.sh dev          # build and run on a device
#   bash scripts/android.sh build        # build an ARM release APK
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ACTION="${1:-dev}"
if [ "$#" -gt 0 ]; then
  shift
fi
EXTRA_ARGS=("$@")

case "$ACTION" in
  dev|build) ;;
  *) echo "[android] Unknown action: $ACTION (use 'dev' or 'build')" >&2; exit 1 ;;
esac

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

info() { echo -e "${CYAN}[android]${NC} $*"; }
ok()   { echo -e "${GREEN}[android]${NC} $*"; }
die()  { echo -e "${RED}[android]${NC} $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUST_TARGETS=(aarch64-linux-android armv7-linux-androideabi)

# ─── 1. Find Android NDK ─────────────────────────────────────────────────────
info "Looking for Android NDK..."

NDK_PATH=""

for var in ANDROID_NDK_HOME NDK_HOME; do
  val="${!var:-}"
  if [ -n "$val" ] && [ -d "$val" ]; then
    NDK_PATH="$val"
    ok "Found via $var: $NDK_PATH"
    break
  fi
done

if [ -z "$NDK_PATH" ] && [ -n "${ANDROID_HOME:-}" ]; then
  NDK_PATH=$(ls -d "$ANDROID_HOME/ndk/"* 2>/dev/null | sort -V | tail -1 || true)
fi

if [ -z "$NDK_PATH" ]; then
  for dir in \
    "$HOME/Android/Sdk" \
    "$HOME/android-sdk" \
    "$HOME/.android/sdk" \
    "/opt/android-sdk" \
    "/usr/local/android-sdk"; do
    if [ -d "$dir/ndk" ]; then
      NDK_PATH=$(ls -d "$dir/ndk/"* 2>/dev/null | sort -V | tail -1 || true)
      [ -n "$NDK_PATH" ] && break
    fi
    if [ -d "$dir/ndk-bundle" ]; then
      NDK_PATH="$dir/ndk-bundle"
      break
    fi
  done
fi

LOCAL_PROPS="$PROJECT_ROOT/src-tauri/gen/android/local.properties"
if [ -z "$NDK_PATH" ] && [ -f "$LOCAL_PROPS" ]; then
  NDK_PATH=$(grep -oP '(?<=ndk\.dir=).*' "$LOCAL_PROPS" 2>/dev/null | head -1 || true)
  if [ -n "$NDK_PATH" ] && [ ! -d "$NDK_PATH" ]; then
    NDK_PATH=""
  fi
fi

if [ -z "$NDK_PATH" ]; then
  die "Android NDK not found!

  Set one of these environment variables:
    export ANDROID_NDK_HOME=/path/to/ndk
    export ANDROID_HOME=/path/to/sdk   (must have ndk/<version> inside)

  Or install the NDK via Android Studio:
    Tools > SDK Manager > SDK Tools > NDK (Side by side)"
fi

ok "NDK: $NDK_PATH"

# ─── 2. Detect host toolchain ─────────────────────────────────────────────────
case "$(uname -s)" in
  Linux)   HOST_TAG="linux-x86_64" ;;
  Darwin)  HOST_TAG="darwin-x86_64" ;;
  MINGW*|MSYS*|CYGWIN*) HOST_TAG="windows-x86_64" ;;
  *)       die "Unsupported OS: $(uname -s)" ;;
esac

TOOLCHAIN="$NDK_PATH/toolchains/llvm/prebuilt/$HOST_TAG"
if [ ! -d "$TOOLCHAIN" ]; then
  die "NDK toolchain not found at: $TOOLCHAIN"
fi

ok "Toolchain: $TOOLCHAIN"

# ─── 3. Detect API level ──────────────────────────────────────────────────────
API_LEVEL=""
for level in 34 33 32 31 30 29 28; do
  if [ -f "$TOOLCHAIN/bin/aarch64-linux-android${level}-clang" ]; then
    API_LEVEL=$level
    break
  fi
done

if [ -z "$API_LEVEL" ]; then
  API_LEVEL=33
  info "Defaulting to API level $API_LEVEL"
else
  ok "API level: $API_LEVEL"
fi

# ─── 4. Check only the supported Rust targets ────────────────────────────────
command -v rustup >/dev/null 2>&1 || die "rustup is required but was not found"

info "Checking ARM Rust targets..."
for target in "${RUST_TARGETS[@]}"; do
  if ! rustup target list --installed 2>/dev/null | grep -qx "$target"; then
    info "Installing $target..."
    rustup target add "$target"
  fi
done
ok "ARM Rust targets ready"

# ─── 5. Set process-local Cargo linker variables ─────────────────────────────
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$TOOLCHAIN/bin/aarch64-linux-android${API_LEVEL}-clang"
export CARGO_TARGET_ARMV7_LINUX_ANDROIDEABI_LINKER="$TOOLCHAIN/bin/armv7a-linux-androideabi${API_LEVEL}-clang"

[ -x "$CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER" ] || die "ARM64 linker not found: $CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER"
[ -x "$CARGO_TARGET_ARMV7_LINUX_ANDROIDEABI_LINKER" ] || die "ARMv7 linker not found: $CARGO_TARGET_ARMV7_LINUX_ANDROIDEABI_LINKER"

ok "ARM linker environment configured"

cd "$PROJECT_ROOT"

GEN_ANDROID_DIR="$PROJECT_ROOT/src-tauri/gen/android"

# Determine which config we're using and expected identifier
if [ "$ACTION" = "dev" ]; then
  EXPECTED_IDENTIFIER="com.drugucopiadev.app"
  CONFIG_FILE="src-tauri/tauri.conf.dev.json"
else
  EXPECTED_IDENTIFIER="com.drugucopia.app"
  CONFIG_FILE="src-tauri/tauri.conf.json"
fi

# Check if Android project exists and matches expected identifier
if [ -d "$GEN_ANDROID_DIR" ]; then
  BUILD_GRADLE="$GEN_ANDROID_DIR/app/build.gradle.kts"
  if [ -f "$BUILD_GRADLE" ]; then
    CURRENT_IDENTIFIER=$(grep -oP 'namespace\s*=\s*"\K[^"]+' "$BUILD_GRADLE" | head -1)
    if [ "$CURRENT_IDENTIFIER" != "$EXPECTED_IDENTIFIER" ]; then
      info "Android project identifier mismatch ($CURRENT_IDENTIFIER vs $EXPECTED_IDENTIFIER), regenerating..."
      rm -rf "$GEN_ANDROID_DIR"
    fi
  fi
fi

# Initialize Android project if needed
if [ ! -d "$GEN_ANDROID_DIR" ]; then
  info "Initializing Android project for $EXPECTED_IDENTIFIER..."
  npx tauri android init --config "$CONFIG_FILE"
fi

case "$ACTION" in
  dev)
    # Development-only recovery for stale native libraries. Release artifacts
    # are intentionally left untouched so Cargo can reuse them.
    for target in "${RUST_TARGETS[@]}"; do
      rm -f "$PROJECT_ROOT/src-tauri/target/$target/debug/deps/libdrugucopia_lib"*.so 2>/dev/null || true
    done

    # A physical device reaches the frontend dev server through the host's LAN
    # address. This discovery is not needed for release builds.
    LAN_IP=""
    if command -v ip >/dev/null 2>&1; then
      LAN_IP=$(ip route get 1 2>/dev/null | grep -oP 'src \K\S+' | head -1 || true)
    elif command -v ifconfig >/dev/null 2>&1; then
      LAN_IP=$(ifconfig 2>/dev/null | grep 'inet ' | grep -v 127.0.0.1 | awk '{print $2}' | head -1 || true)
    fi

    if [ -n "$LAN_IP" ]; then
      ok "LAN IP: $LAN_IP"
      export TAURI_DEV_HOST="$LAN_IP"
    else
      info "Could not auto-detect LAN IP. Set TAURI_DEV_HOST manually if the device cannot reach the app."
    fi

    info "Starting Tauri Android development build..."
    npx tauri android dev --config src-tauri/tauri.conf.dev.json "${EXTRA_ARGS[@]}"
    ;;

  build)
    info "Building release APK for ARM64 and ARMv7..."
    npx tauri android build \
      --config "$CONFIG_FILE" \
      --apk \
      --target aarch64 \
      "${EXTRA_ARGS[@]}"
    ;;
esac
