import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    private var backgroundPrivacyShield: UIVisualEffectView?

    private static let backgroundPrivacyPreferenceKey =
        "CapacitorStorage.ddl-reminder:hide-background-preview"

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        protectBackgroundPreviewIfNeeded()
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // This is a fallback for cold/background launches that do not pass through
        // the usual active-to-inactive transition before iOS takes its snapshot.
        protectBackgroundPreviewIfNeeded()
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        removeBackgroundPrivacyShield()
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    private func protectBackgroundPreviewIfNeeded() {
        guard backgroundPrivacyEnabled,
              backgroundPrivacyShield == nil,
              let window else {
            return
        }

        let shield = UIVisualEffectView(effect: UIBlurEffect(style: .dark))
        shield.frame = window.bounds
        shield.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        shield.isUserInteractionEnabled = false
        window.addSubview(shield)
        window.bringSubviewToFront(shield)
        backgroundPrivacyShield = shield
    }

    private func removeBackgroundPrivacyShield() {
        backgroundPrivacyShield?.removeFromSuperview()
        backgroundPrivacyShield = nil
    }

    private var backgroundPrivacyEnabled: Bool {
        UserDefaults.standard.string(forKey: Self.backgroundPrivacyPreferenceKey) == "true"
    }

}
