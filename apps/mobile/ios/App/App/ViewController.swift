import Capacitor

final class ViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(IOSNotificationSettingsPlugin())
        bridge?.registerPluginInstance(IOSWallpaperPlugin())
    }
}
