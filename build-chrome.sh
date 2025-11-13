#!/bin/bash

# Build script for Chrome extension (Manifest V3)

echo "Building Web Marker Extension for Chrome..."
echo "========================================"

# Create Chrome build directory
echo "Creating Chrome build directory..."
rm -rf build-chrome
mkdir -p build-chrome

# Copy all source files except Firefox-specific ones
echo "Copying source files..."
cp *.png build-chrome/
cp *.html build-chrome/
cp *.css build-chrome/
cp *.js build-chrome/
cp fabric.min.js build-chrome/

# Use Chrome-specific manifest and background script
cp manifest-chrome.json build-chrome/manifest.json
cp background-chrome.js build-chrome/background.js

# Verify build output
echo "Verifying build output..."

# Check if core files exist
core_files=("manifest.json" "background.js" "marker.js" "main.css" "popup.html" "options.html" "fabric.min.js" "icon.png")
missing_files=()

for file in "${core_files[@]}"; do
    if [ ! -f "build-chrome/$file" ]; then
        missing_files+=("$file")
    fi
done

if [ ${#missing_files[@]} -eq 0 ]; then
    echo "✅ Core files copied successfully"
else
    echo "❌ Missing core files: ${missing_files[*]}"
    exit 1
fi

# Count files
source_files=$(find . -maxdepth 1 -type f \( -name "*.png" -o -name "*.html" -o -name "*.css" -o -name "*.js" \) | wc -l)
chrome_files=$(find build-chrome/ -maxdepth 1 -type f | wc -l)

echo "Source files:       $source_files"
echo "Chrome build files: $chrome_files"

if [ "$source_files" -eq "$((chrome_files - 2))" ]; then  # -2 for manifest-chrome.json and background-chrome.js
    echo "✅ All files copied successfully"
else
    echo "⚠️  File count mismatch - please verify manually"
fi

echo
echo "Build completed successfully!"
echo "Chrome extension files are ready in the 'build-chrome/' directory"
echo
echo "Next steps:"
echo "1. Open Chrome"
echo "2. Navigate to chrome://extensions/"
echo "3. Enable 'Developer mode' (top right toggle)"
echo "4. Click 'Load unpacked'"
echo "5. Select the build-chrome/ directory"
echo

# Show build output size
echo "Build output size:"
du -sh build-chrome/