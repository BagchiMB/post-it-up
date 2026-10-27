# Local Expo module wrapping Spotify's iOS SDK (App Remote) for in-app playback control.
# The SDK binary isn't committed: run modules/spotify-remote/scripts/fetch-sdk.sh first.
sdk = File.join(__dir__, 'SpotifyiOS.xcframework')
unless File.exist?(sdk)
  raise "SpotifyiOS.xcframework is missing. Run: sh modules/spotify-remote/scripts/fetch-sdk.sh"
end

Pod::Spec.new do |s|
  s.name           = 'SpotifyRemote'
  s.version        = '1.0.0'
  s.summary        = 'Plays a Spotify track from a given position via the Spotify app (App Remote).'
  s.description    = s.summary
  s.license        = 'MIT'
  s.author         = 'Post It Up'
  s.homepage       = 'https://github.com/spotify/ios-sdk'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: 'https://github.com/spotify/ios-sdk.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.vendored_frameworks = 'SpotifyiOS.xcframework'

  s.source_files = '*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
