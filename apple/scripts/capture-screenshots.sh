#!/bin/bash
# Clarissa AI - Automated Screenshot Capture for App Store
# Single script to capture demo screenshots on all platforms

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/../Clarissa"
SCREENSHOTS_DIR="$SCRIPT_DIR/../screenshots"
CACHE_DIR="$HOME/Library/Caches/tools.fastlane"
SCREENSHOTS_CACHE="$CACHE_DIR/screenshots"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${GREEN}[SCREENSHOT]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
info() { echo -e "${BLUE}[INFO]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# iOS device configurations for App Store
# Format: "Simulator Name|Output Folder"
IOS_DEVICES=(
    "iPhone 17 Pro Max|iPhone-6.9"
    "iPhone 17 Pro|iPhone-6.5"
    "iPad Pro 13-inch (M5)|iPad-13"
)

# Prepare directories for SnapshotHelper
prepare_cache() {
    log "Preparing screenshot cache directories..."
    rm -rf "$SCREENSHOTS_CACHE"
    mkdir -p "$SCREENSHOTS_CACHE"

    # Write language/locale files for SnapshotHelper
    echo "en" > "$CACHE_DIR/language.txt"
    echo "en_US" > "$CACHE_DIR/locale.txt"

    export SIMULATOR_HOST_HOME="$HOME"
}

# Capture iOS/iPad screenshots
capture_ios() {
    log "Capturing iOS screenshots..."
    cd "$PROJECT_DIR"

    for device_config in "${IOS_DEVICES[@]}"; do
        IFS='|' read -r device folder <<< "$device_config"
        info "Capturing on $device..."

        # Run UI tests with demo mode
        xcodebuild -scheme ClarissaUITests \
            -project Clarissa.xcodeproj \
            -destination "platform=iOS Simulator,name=$device" \
            -testLanguage en -testRegion US \
            build test 2>&1 | grep -E "(Test Case|snapshot:|error:)" || true

        log "Completed $device"
    done
}

# Capture macOS screenshots
capture_macos() {
    log "Capturing macOS screenshots..."
    cd "$PROJECT_DIR"

    xcodebuild -scheme ClarissaUITests \
        -project Clarissa.xcodeproj \
        -destination "platform=macOS" \
        build test 2>&1 | grep -E "(Test Case|snapshot:|error:)" || true

    log "Completed macOS"
}

# Organize screenshots into App Store directories
organize_screenshots() {
    log "Organizing screenshots..."

    # Create output directories
    for device_config in "${IOS_DEVICES[@]}"; do
        IFS='|' read -r device folder <<< "$device_config"
        mkdir -p "$SCREENSHOTS_DIR/$folder"
    done
    mkdir -p "$SCREENSHOTS_DIR/macOS"

    # Collect all screenshot source directories
    # macOS sandboxed apps save to a container path
    MACOS_CONTAINER="$HOME/Library/Containers/dev.rye.ClarissaUITests.xctrunner/Data/Library/Caches/tools.fastlane/screenshots"
    SCREENSHOT_SOURCES=("$SCREENSHOTS_CACHE")
    if [ -d "$MACOS_CONTAINER" ]; then
        SCREENSHOT_SOURCES+=("$MACOS_CONTAINER")
    fi

    # Copy and organize from all source directories
    local count=0
    for source_dir in "${SCREENSHOT_SOURCES[@]}"; do
        for file in "$source_dir"/*.png; do
            [ -f "$file" ] || continue
            filename=$(basename "$file")

            # Parse device name from filename (format: DeviceName-ScreenshotName.png)
            for device_config in "${IOS_DEVICES[@]}"; do
                IFS='|' read -r device folder <<< "$device_config"
                if [[ "$filename" == "$device"* ]]; then
                    screenshot_name="${filename#$device-}"
                    cp "$file" "$SCREENSHOTS_DIR/$folder/$screenshot_name"
                    ((count++)) || true
                    break
                fi
            done

            # Check for Mac screenshots
            if [[ "$filename" == Mac* ]]; then
                screenshot_name="${filename#Mac-}"
                cp "$file" "$SCREENSHOTS_DIR/macOS/$screenshot_name"
                ((count++)) || true
            fi
        done
    done

    if [ $count -eq 0 ]; then
        warn "No screenshots were captured. Check that UI tests are running correctly."
    else
        log "Organized $count screenshots to $SCREENSHOTS_DIR"
    fi
}

# Show what devices are available
list_devices() {
    info "Available iOS Simulators:"
    xcrun simctl list devices available | grep -E "(iPhone|iPad)" | head -15
    echo ""
    info "Configured devices for capture:"
    for device_config in "${IOS_DEVICES[@]}"; do
        IFS='|' read -r device folder <<< "$device_config"
        echo "  - $device -> $folder/"
    done
}

# Show usage
usage() {
    echo ""
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  demo      - Capture all platforms (iOS + iPad + macOS) - RECOMMENDED"
    echo "  ios       - Capture iOS/iPad screenshots only"
    echo "  macos     - Capture macOS screenshots only"
    echo "  devices   - List available and configured devices"
    echo "  help      - Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 demo    # Capture all screenshots for App Store"
    echo "  $0 ios     # Capture only iOS/iPad screenshots"
    echo ""
}

# Main
main() {
    case "${1:-help}" in
        demo)
            prepare_cache
            capture_ios
            capture_macos
            organize_screenshots
            log "Done! Screenshots saved to: $SCREENSHOTS_DIR"
            ;;
        ios)
            prepare_cache
            capture_ios
            organize_screenshots
            ;;
        macos)
            prepare_cache
            capture_macos
            organize_screenshots
            ;;
        devices)
            list_devices
            ;;
        help|*)
            usage
            ;;
    esac
}

main "$@"
