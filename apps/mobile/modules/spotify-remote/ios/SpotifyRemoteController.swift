import SpotifyiOS
import UIKit

/**
 Owns the single `SPTAppRemote` connection to the Spotify app.

 Flow: the first `playFrom` has no token, so `authorizeAndPlayURI` hands off to the Spotify app,
 which starts the track and returns to `postitup://spotify-callback#access_token=…`. The app
 delegate subscriber passes that URL to `handle(url:)`, we connect, then seek to the clip.
 The token stays in memory only (it expires after about an hour; we re-authorize then).
 */
final class SpotifyRemoteController: NSObject, SPTAppRemoteDelegate, SPTAppRemotePlayerStateDelegate {
  static let shared = SpotifyRemoteController()

  static let redirectURL = URL(string: "postitup://spotify-callback")!

  /// Set by the module to forward state / errors to JS.
  var onState: (([String: Any]) -> Void)?
  var onError: ((String) -> Void)?

  private var appRemote: SPTAppRemote?
  private var clientID: String?
  private var accessToken: String?
  private var connecting = false
  /// The user wants playback (set by play, cleared by pause/disconnect); drives reconnects.
  private var active = false
  /// Track and position to start once connected / once the track is loaded.
  private var pendingURI: String?
  private var pendingSeekMs: Int?
  /// One automatic re-authorization when a saved token stops working.
  private var reauthorized = false
  private(set) var state: [String: Any] = ["connected": false, "playing": false, "positionMs": 0]

  // MARK: Public API (main thread)

  var isSpotifyInstalled: Bool {
    guard let url = URL(string: "spotify:") else { return false }
    return UIApplication.shared.canOpenURL(url)
  }

  func playFrom(clientID: String, uri: String, positionMs: Int) {
    let remote = remote(for: clientID)
    active = true
    pendingURI = uri
    pendingSeekMs = positionMs
    reauthorized = false

    if remote.isConnected {
      startPending()
    } else if accessToken != nil {
      connect()
    } else {
      authorize(uri)
    }
  }

  func pause() {
    active = false
    pendingURI = nil
    pendingSeekMs = nil
    guard let remote = appRemote, remote.isConnected else { return }
    remote.playerAPI?.pause { [weak self] _, error in
      if let error { self?.report(error) }
    }
  }

  func resume() {
    guard let remote = appRemote, remote.isConnected else { return }
    active = true
    remote.playerAPI?.resume { [weak self] _, error in
      if let error { self?.report(error) }
    }
  }

  func disconnect() {
    active = false
    pendingURI = nil
    pendingSeekMs = nil
    if appRemote?.isConnected == true { appRemote?.disconnect() }
  }

  // MARK: App delegate hooks

  /// Returns true when the URL was Spotify's authorization response.
  func handle(url: URL) -> Bool {
    guard url.scheme == Self.redirectURL.scheme, url.host == Self.redirectURL.host,
      let remote = appRemote,
      let params = remote.authorizationParameters(from: url)
    else { return false }

    if let token = params[SPTAppRemoteAccessTokenKey] {
      accessToken = token
      remote.connectionParameters.accessToken = token
      connect()
      return true
    }
    if let description = params[SPTAppRemoteErrorDescriptionKey] {
      active = false
      onError?(Self.message(forAuthError: description))
      return true
    }
    return false
  }

  func appDidBecomeActive() {
    // App Remote drops while we're in the background; pick it back up if the user was listening.
    if active, accessToken != nil, appRemote?.isConnected == false { connect() }
  }

  func appWillResignActive() {
    // Spotify asks apps to let go of the connection when they leave the foreground.
    if appRemote?.isConnected == true { appRemote?.disconnect() }
  }

  // MARK: Connection

  private func remote(for clientID: String) -> SPTAppRemote {
    if let appRemote, self.clientID == clientID { return appRemote }
    let configuration = SPTConfiguration(clientID: clientID, redirectURL: Self.redirectURL)
    let remote = SPTAppRemote(configuration: configuration, logLevel: .error)
    remote.delegate = self
    remote.connectionParameters.accessToken = accessToken
    appRemote = remote
    self.clientID = clientID
    return remote
  }

  private func authorize(_ uri: String) {
    guard let remote = appRemote else { return }
    // Opens the Spotify app, which starts `uri` and sends the user back with a token.
    remote.authorizeAndPlayURI(uri) { [weak self] installed in
      if !installed {
        self?.active = false
        self?.onError?("Install the Spotify app to play songs here.")
      }
    }
  }

  private func connect() {
    guard let remote = appRemote, !remote.isConnected, !connecting else { return }
    connecting = true
    remote.connect()
  }

  func appRemoteDidEstablishConnection(_ appRemote: SPTAppRemote) {
    connecting = false
    reauthorized = false
    appRemote.playerAPI?.delegate = self
    appRemote.playerAPI?.subscribe(toPlayerState: { [weak self] _, error in
      if let error { self?.report(error) }
    })
    // On-demand playback (a chosen track at a chosen time) needs Premium.
    appRemote.userAPI?.fetchCapabilities(callback: { [weak self] result, _ in
      guard let self else { return }
      if let capabilities = result as? SPTAppRemoteUserCapabilities, !capabilities.canPlayOnDemand {
        self.active = false
        self.pendingURI = nil
        self.pendingSeekMs = nil
        self.onError?("Spotify Premium is needed to play songs.")
        return
      }
      self.startPending()
    })
    update(connected: true)
  }

  func appRemote(_ appRemote: SPTAppRemote, didFailConnectionAttemptWithError error: Error?) {
    connecting = false
    update(connected: false)
    guard active, let uri = pendingURI else { return }
    // Usually the Spotify app was suspended or the token expired: authorize again once.
    if !reauthorized {
      reauthorized = true
      accessToken = nil
      appRemote.connectionParameters.accessToken = nil
      authorize(uri)
    } else {
      active = false
      onError?("Open Spotify once and try again.")
    }
  }

  func appRemote(_ appRemote: SPTAppRemote, didDisconnectWithError error: Error?) {
    connecting = false
    update(connected: false, playing: false)
  }

  // MARK: Playback

  /// Plays the pending track (unless it's already the current one) and seeks when it's loaded.
  private func startPending() {
    guard let remote = appRemote, remote.isConnected, let uri = pendingURI else { return }
    remote.playerAPI?.getPlayerState { [weak self] result, _ in
      guard let self else { return }
      if let state = result as? SPTAppRemotePlayerState, state.track.uri == uri {
        self.seekIfPending(state)
        if state.isPaused { remote.playerAPI?.resume(nil) }
      } else {
        remote.playerAPI?.play(uri, callback: { [weak self] _, error in
          if let error { self?.report(error) }
        })
      }
    }
  }

  private func seekIfPending(_ state: SPTAppRemotePlayerState) {
    guard let uri = pendingURI, state.track.uri == uri, let position = pendingSeekMs else { return }
    pendingURI = nil
    pendingSeekMs = nil
    appRemote?.playerAPI?.seek(toPosition: position, callback: { [weak self] _, error in
      if let error { self?.report(error) }
    })
  }

  func playerStateDidChange(_ playerState: SPTAppRemotePlayerState) {
    seekIfPending(playerState)
    state = [
      "connected": true,
      "playing": !playerState.isPaused,
      "positionMs": playerState.playbackPosition,
      "trackUri": playerState.track.uri,
    ]
    onState?(state)
  }

  // MARK: Helpers

  private func update(connected: Bool, playing: Bool? = nil) {
    state["connected"] = connected
    if let playing { state["playing"] = playing }
    onState?(state)
  }

  private func report(_ error: Error) {
    let text = error.localizedDescription
    if text.localizedCaseInsensitiveContains("premium") {
      onError?("Spotify Premium is needed to play songs.")
    } else {
      onError?("Spotify couldn’t play this song: \(text)")
    }
  }

  private static func message(forAuthError description: String) -> String {
    if description.localizedCaseInsensitiveContains("premium") {
      return "Spotify Premium is needed to play songs."
    }
    return "Spotify didn’t allow playback (\(description)). Open Spotify once and try again."
  }
}
