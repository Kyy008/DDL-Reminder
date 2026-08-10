import Capacitor
import UIKit
import UserNotifications

@objc(IOSNotificationSettingsPlugin)
public final class IOSNotificationSettingsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "IOSNotificationSettingsPlugin"
    public let jsName = "IOSNotificationSettings"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise)
    ]

    @objc public func getStatus(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let result: JSObject = [
                "alert": Self.notificationSettingName(settings.alertSetting),
                "lockScreen": Self.notificationSettingName(settings.lockScreenSetting),
                "notificationCenter": Self.notificationSettingName(settings.notificationCenterSetting),
                "scheduledDelivery": Self.notificationSettingName(settings.scheduledDeliverySetting),
                "sound": Self.notificationSettingName(settings.soundSetting)
            ]

            DispatchQueue.main.async {
                call.resolve(result)
            }
        }
    }

    @objc public func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let settingsURLString: String

            if #available(iOS 16.0, *) {
                settingsURLString = UIApplication.openNotificationSettingsURLString
            } else {
                settingsURLString = UIApplication.openSettingsURLString
            }

            guard let settingsURL = URL(string: settingsURLString) else {
                call.reject(
                    "没能打开系统通知设置，请从“设置”中找到 DDL Reminder。",
                    "IOS_SETTINGS_URL_INVALID"
                )
                return
            }

            UIApplication.shared.open(settingsURL, options: [:]) { opened in
                DispatchQueue.main.async {
                    if opened {
                        call.resolve(["opened": true])
                    } else {
                        call.reject(
                            "没能打开系统通知设置，请从“设置”中找到 DDL Reminder。",
                            "IOS_SETTINGS_OPEN_FAILED"
                        )
                    }
                }
            }
        }
    }

    private static func notificationSettingName(_ setting: UNNotificationSetting) -> String {
        switch setting {
        case .notSupported:
            return "notSupported"
        case .disabled:
            return "disabled"
        case .enabled:
            return "enabled"
        @unknown default:
            return "unknown"
        }
    }
}
