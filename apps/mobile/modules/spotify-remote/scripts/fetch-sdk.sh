#!/bin/sh
# Downloads Spotify's official iOS SDK (SpotifyiOS.xcframework) into this module.
# Source: https://github.com/spotify/ios-sdk (tag below). Run before `npx expo prebuild`.
set -eu
VERSION="v5.0.1"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HERE/ios/SpotifyiOS.xcframework"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl -fsSL "https://github.com/spotify/ios-sdk/archive/refs/tags/$VERSION.zip" -o "$TMP/sdk.zip"
unzip -q "$TMP/sdk.zip" "ios-sdk-${VERSION#v}/SpotifyiOS.xcframework/*" -d "$TMP"
rm -rf "$DEST"
mv "$TMP/ios-sdk-${VERSION#v}/SpotifyiOS.xcframework" "$DEST"
echo "SpotifyiOS $VERSION → $DEST"
