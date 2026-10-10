#!/bin/sh
# VidiaForge — production build + standalone asset copy
#
# V8.5: hardened build script with proper failure handling + standalone
# output normalization.
#
# Key V8.5 changes:
# - Normalizes the standalone output so server.js is at .next/standalone/server.js
#   (Next.js 16 places it at .next/standalone/<build-path>/server.js, which
#   doesn't match the production start command's expected path).
# - Uses `set -e` for immediate failure on any command error.
# - Cleans stale .next/ before building to prevent stale output.
# - Validates standalone output exists after the build.
# - Validates static assets + public assets are present.
# - Every critical step has an explicit error message + exit code.
#
# V8.4: hardened build script with proper failure handling.
# V8.3: fixed the standalone output path issue where Next.js 16 places
# server.js in a nested directory mirroring the absolute build path.

set -e

# ─── Step 0: Clean stale build output ────────────────────────────────────────
echo "[build] Cleaning stale .next/ output..."
rm -rf .next

# ─── Step 1: Run the Next.js production build ────────────────────────────────
echo "[build] Running: bunx next build"
bunx next build

# V8.4: explicitly check the exit status of `next build`.
if [ ! -d .next ]; then
  echo "ERROR: .next/ directory not created — next build likely failed."
  exit 1
fi

# ─── Step 2: Find the standalone server.js ────────────────────────────────────
echo "[build] Locating standalone server.js..."
SERVER_JS=$(find .next/standalone -name server.js -not -path '*/node_modules/*' | head -1)
if [ -z "$SERVER_JS" ]; then
  echo "ERROR: server.js not found in .next/standalone/ — the build may have failed."
  echo "  Check that next.config.ts has output: 'standalone' set."
  exit 1
fi

STANDALONE_DIR=$(dirname "$SERVER_JS")
echo "[build] Found standalone server at: $SERVER_JS"

# ─── Step 2b: Normalize standalone output to .next/standalone/ root ───────────
# V8.5: Next.js 16 places server.js in a nested directory mirroring the
# absolute build path (e.g., .next/standalone/work-v8.5/server.js locally,
# or .next/standalone/app/server.js in Docker). The production start command
# expects server.js at .next/standalone/server.js. We normalize by moving
# the contents of the nested directory to .next/standalone/ root.
#
# This is safe because:
# - .next/standalone/ is a generated output directory (created by next build)
# - The nested directory only exists because of the absolute build path
# - Moving its contents to .next/standalone/ root preserves all relative
#   paths (server.js, .next/, node_modules/, public/ are all relative)
# - We verify the result after the move
if [ "$STANDALONE_DIR" != ".next/standalone" ]; then
  echo "[build] Normalizing standalone output from $STANDALONE_DIR → .next/standalone/"
  # Move the contents of the nested directory to .next/standalone/ root.
  # Use cp -r + rm instead of mv to handle all cases safely.
  cp -r "$STANDALONE_DIR"/. .next/standalone/
  # Verify the normalized server.js exists
  if [ ! -f .next/standalone/server.js ]; then
    echo "ERROR: Failed to normalize standalone output — .next/standalone/server.js not found after copy."
    exit 1
  fi
  # Clean up the nested directory (safe — it's a generated output)
  rm -rf "$STANDALONE_DIR"
  STANDALONE_DIR=".next/standalone"
  echo "[build] ✓ Normalized to .next/standalone/server.js"
fi

# ─── Step 3: Copy static assets ───────────────────────────────────────────────
echo "[build] Copying static assets..."
if [ ! -d .next/static ]; then
  echo "ERROR: .next/static/ not found — the build did not generate static assets."
  exit 1
fi

mkdir -p "$STANDALONE_DIR/.next/static"
cp -r .next/static/* "$STANDALONE_DIR/.next/static/"

if [ ! -d "$STANDALONE_DIR/.next/static" ]; then
  echo "ERROR: Failed to copy static assets to $STANDALONE_DIR/.next/static/"
  exit 1
fi

STATIC_COUNT=$(find "$STANDALONE_DIR/.next/static" -type f | wc -l)
if [ "$STATIC_COUNT" -eq 0 ]; then
  echo "ERROR: $STANDALONE_DIR/.next/static/ is empty — static asset copy failed."
  exit 1
fi
echo "[build] Copied .next/static → $STANDALONE_DIR/.next/static/ ($STATIC_COUNT files)"

# ─── Step 4: Copy public assets ───────────────────────────────────────────────
echo "[build] Copying public assets..."
if [ ! -d public ]; then
  echo "WARNING: public/ directory not found — skipping public asset copy."
else
  cp -r public "$STANDALONE_DIR/public"

  if [ ! -d "$STANDALONE_DIR/public" ]; then
    echo "ERROR: Failed to copy public/ to $STANDALONE_DIR/public/"
    exit 1
  fi

  PUBLIC_COUNT=$(find "$STANDALONE_DIR/public" -type f | wc -l)
  if [ "$PUBLIC_COUNT" -eq 0 ]; then
    echo "WARNING: $STANDALONE_DIR/public/ is empty — public/ directory may be empty."
  else
    echo "[build] Copied public → $STANDALONE_DIR/public/ ($PUBLIC_COUNT files)"
  fi
fi

# ─── Step 5: Final verification ────────────────────────────────────────────────
echo "[build] Verifying standalone output..."

# V8.5: verify the EXPECTED path (.next/standalone/server.js), not a nested one
if [ ! -f .next/standalone/server.js ]; then
  echo "ERROR: .next/standalone/server.js not found — the standalone output was not normalized correctly."
  exit 1
fi

if [ ! -d .next/standalone/.next/static ] || [ "$(find .next/standalone/.next/static -type f | wc -l)" -eq 0 ]; then
  echo "ERROR: .next/standalone/.next/static/ is missing or empty."
  exit 1
fi

echo "[build] ✓ Standalone server.js verified at .next/standalone/server.js"
echo "[build] ✓ Static assets verified ($STATIC_COUNT files)"
if [ -d .next/standalone/public ]; then
  echo "[build] ✓ Public assets verified ($PUBLIC_COUNT files)"
fi
echo "[build] Build + asset copy complete."
