import ExpoModulesCore
import UIKit

/// Receives Spotify's authorization redirect and app life-cycle events (forwarded by Expo's scene delegate).
public class SpotifyRemoteAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return SpotifyRemoteController.shared.handle(url: url)
  }

  public func applicationDidBecomeActive(_ application: UIApplication) {
    SpotifyRemoteController.shared.appDidBecomeActive()
  }

  public func applicationWillResignActive(_ application: UIApplication) {
    SpotifyRemoteController.shared.appWillResignActive()
  }
}
