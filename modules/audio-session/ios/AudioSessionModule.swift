import AVFoundation
import ExpoModulesCore

/// WKWebView plays media through the app's audio session. Its default category
/// (soloAmbient) is silenced by the ring/silent switch, so Scrimba's instructor audio
/// would be inaudible on many iPhones. Playback is the category media apps use.
public class AudioSessionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AudioSessionModule")

    Function("setPlaybackCategory") { () -> Bool in
      do {
        try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [])
        return true
      } catch {
        return false
      }
    }
  }
}
