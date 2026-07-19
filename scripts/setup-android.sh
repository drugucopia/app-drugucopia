#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# One-time Android toolchain setup for Drugucopia.
#
# This script validates the Android NDK and installs only the supported ARM Rust
# targets. scripts/android.sh supplies the machine-specific linker paths through
# environment variables for each build; no Cargo config file is generated.
#
# Usage: bash scripts/setup-android.sh
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

RUST_TARGETS=(aarch64-linux-android armv7-linux-androideabi)

# ─── 1. Detect Android NDK ────────────────────────────────────────────────────
info "Detecting Android NDK..."

NDK_PATH=""

for var in ANDROID_NDK_HOME NDK_HOME; do
  val="${!var:-}"
  if [ -n "$val" ] && [ -d "$val" ]; then
    NDK_PATH="$val"
    ok "$var is set: $NDK_PATH"
    break
  fi
done

if [ -z "$NDK_PATH" ] && [ -n "${ANDROID_HOME:-}" ]; then
  NDK_PATH=$(ls -d "$ANDROID_HOME/ndk/"* 2>/dev/null | sort -V | tail -1 || true)
  if [ -n "$NDK_PATH" ]; then
    ok "Found NDK in ANDROID_HOME: $NDK_PATH"
  fi
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
      if [ -n "$NDK_PATH" ]; then
        ok "Found NDK at: $NDK_PATH"
        break
      fi
    fi
    if [ -d "$dir/ndk-bundle" ]; then
      NDK_PATH="$dir/ndk-bundle"
      ok "Found NDK at: $NDK_PATH"
      break
    fi
  done
fi

if [ -z "$NDK_PATH" ]; then
  error "Could not find Android NDK. Set ANDROID_NDK_HOME or ANDROID_HOME and re-run.

Install the NDK through Android Studio, or with:
  sdkmanager --install 'ndk;27.0.12077973'"
fi

# ─── 2. Validate host toolchain and API wrappers ──────────────────────────────
case "$(uname -s)" in
  Linux)   HOST_TAG="linux-x86_64" ;;
  Darwin)  HOST_TAG="darwin-x86_64" ;;
  MINGW*|MSYS*|CYGWIN*) HOST_TAG="windows-x86_64" ;;
  *)       error "Unsupported OS: $(uname -s)" ;;
esac

TOOLCHAIN_DIR="$NDK_PATH/toolchains/llvm/prebuilt/$HOST_TAG"
if [ ! -d "$TOOLCHAIN_DIR" ]; then
  error "NDK toolchain directory not found: $TOOLCHAIN_DIR"
fi

API_LEVEL=""
for level in 34 33 32 31 30 29 28; do
  if [ -f "$TOOLCHAIN_DIR/bin/aarch64-linux-android${level}-clang" ]; then
    API_LEVEL=$level
    break
  fi
done

if [ -z "$API_LEVEL" ]; then
  API_LEVEL=$(ls "$TOOLCHAIN_DIR/bin/"*android*clang 2>/dev/null | head -1 | grep -oP '\d+(?=-clang)' || true)
fi

if [ -z "$API_LEVEL" ]; then
  warn "Could not detect an Android API linker wrapper; scripts/android.sh will default to API 33"
  API_LEVEL=33
fi

ARM64_LINKER="$TOOLCHAIN_DIR/bin/aarch64-linux-android${API_LEVEL}-clang"
ARMV7_LINKER="$TOOLCHAIN_DIR/bin/armv7a-linux-androideabi${API_LEVEL}-clang"

[ -x "$ARM64_LINKER" ] || error "ARM64 linker not found: $ARM64_LINKER"
[ -x "$ARMV7_LINKER" ] || error "ARMv7 linker not found: $ARMV7_LINKER"

ok "Using API level: $API_LEVEL"
ok "Host tag: $HOST_TAG"
ok "Toolchain: $TOOLCHAIN_DIR"

# ─── 3. Install only supported ARM Rust targets ──────────────────────────────
command -v rustup >/dev/null 2>&1 || error "rustup is required but was not found"

info "Installing ARM Rust targets..."
for target in "${RUST_TARGETS[@]}"; do
  if rustup target list --installed 2>/dev/null | grep -qx "$target"; then
    ok "Target $target already installed"
  else
    info "Installing target $target..."
    rustup target add "$target"
  fi
done

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Android ARM setup complete!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo ""
echo "  NDK:          $NDK_PATH"
echo "  API level:    $API_LEVEL"
echo "  Rust targets: aarch64-linux-android, armv7-linux-androideabi"
echo "  Cargo config: not generated (linkers are set per build)"
echo ""
echo "  Next step: npm run tauri:android:dev"
echo ""
