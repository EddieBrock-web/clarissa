#!/bin/bash
# Generate gradient backgrounds for fastlane frameit

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKGROUNDS_DIR="$SCRIPT_DIR/../Clarissa/fastlane/backgrounds"

# Check for ImageMagick
if ! command -v convert &> /dev/null; then
    echo "ImageMagick not found. Install with: brew install imagemagick"
    exit 1
fi

mkdir -p "$BACKGROUNDS_DIR"

echo "Generating iOS background..."
# Dark gradient matching Clarissa theme (purple to dark blue)
convert -size 2732x2732 \
    -define gradient:direction=south \
    gradient:'#1a1a2e'-'#16213e' \
    "$BACKGROUNDS_DIR/background.png"

echo "Generating macOS background..."
# Similar gradient for macOS
convert -size 2880x1800 \
    -define gradient:direction=south \
    gradient:'#1a1a2e'-'#16213e' \
    "$BACKGROUNDS_DIR/mac_background.png"

echo "Done! Backgrounds generated in: $BACKGROUNDS_DIR"
ls -la "$BACKGROUNDS_DIR"

