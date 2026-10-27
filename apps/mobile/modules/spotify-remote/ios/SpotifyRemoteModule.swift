import ExpoModulesCore

public class SpotifyRemoteModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SpotifyRemote")

    Events("onStateChange", "onError")

    OnCreate {
      let controller = SpotifyRemoteController.shared
      controller.onState = { [weak self] state in self?.sendEvent("onStateChange", state) }
      controller.onError = { [weak self] message in self?.sendEvent("onError", ["message": message]) }
    }

    AsyncFunction("isSpotifyInstalled") { () -> Bool in
      SpotifyRemoteController.shared.isSpotifyInstalled
    }.runOnQueue(.main)

    AsyncFunction("playFrom") { (clientId: String, uri: String, positionMs: Int) in
      SpotifyRemoteController.shared.playFrom(clientID: clientId, uri: uri, positionMs: positionMs)
    }.runOnQueue(.main)

    AsyncFunction("pause") {
      SpotifyRemoteController.shared.pause()
    }.runOnQueue(.main)

    AsyncFunction("resume") {
      SpotifyRemoteController.shared.resume()
    }.runOnQueue(.main)

    AsyncFunction("getState") { () -> [String: Any] in
      SpotifyRemoteController.shared.state
    }.runOnQueue(.main)

    AsyncFunction("disconnect") {
      SpotifyRemoteController.shared.disconnect()
    }.runOnQueue(.main)
  }
}
