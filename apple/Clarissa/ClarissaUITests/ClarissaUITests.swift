//
//  ClarissaUITests.swift
//  ClarissaUITests
//
//  Automated screenshot capture for App Store using fastlane snapshot
//  Uses demo mode (-SCREENSHOT_MODE) with scenario arguments for different screenshots
//

import XCTest

@MainActor
final class ClarissaUITests: XCTestCase {
    var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
    }

    override func tearDownWithError() throws {
        app = nil
    }

    // MARK: - Helper to launch with specific scenario

    private func launchWithScenario(_ scenario: String? = nil) {
        app.launchArguments = ["-SCREENSHOT_MODE"]
        if let scenario = scenario {
            app.launchArguments.append("-DEMO_SCENARIO_\(scenario)")
        }
        setupSnapshot(app)
        app.launch()

        #if os(macOS)
        // Ensure window is frontmost on macOS
        app.activate()
        // Give macOS extra time to render the window
        sleep(2)
        #endif
    }

    // MARK: - Screenshot Tests

    /// Capture all screenshots for App Store in sequence
    /// Each screenshot requires a fresh app launch with the correct scenario
    func testCaptureAllScreenshots() throws {
        // 1. Welcome - empty state with suggestions
        launchWithScenario("WELCOME")
        sleep(2)
        snapshot("01-welcome")
        app.terminate()

        // 2. Conversation - calendar conversation
        launchWithScenario("CONVERSATION")
        sleep(2)
        snapshot("02-conversation")
        app.terminate()

        // 3. Context Visualizer - shows context window feature
        launchWithScenario("CONTEXT")
        sleep(2)
        openContextVisualizer()
        sleep(1)
        snapshot("03-tools")
        app.terminate()

        // 4. Settings
        launchWithScenario("SETTINGS")
        sleep(2)
        navigateToSettings()
        sleep(1)
        snapshot("04-settings")
    }

    // MARK: - Individual Screenshot Tests

    func testWelcomeScreenshot() throws {
        launchWithScenario("WELCOME")
        sleep(2)
        snapshot("01-welcome")
    }

    func testConversationScreenshot() throws {
        launchWithScenario("CONVERSATION")
        sleep(2)
        snapshot("02-conversation")
    }

    func testToolsScreenshot() throws {
        // Use context visualizer as the "tools" screenshot
        launchWithScenario("CONTEXT")
        sleep(2)
        openContextVisualizer()
        sleep(1)
        snapshot("03-tools")
    }

    func testSettingsScreenshot() throws {
        launchWithScenario("SETTINGS")
        sleep(2)
        navigateToSettings()
        sleep(1)
        snapshot("04-settings")
    }

    // MARK: - Navigation Helpers

    private func openContextVisualizer() {
        // The context indicator appears when there are messages with context stats
        // Use accessibility identifier with .firstMatch to handle multiple matches on macOS
        let contextButton = app.buttons["ContextIndicator"].firstMatch
        if contextButton.waitForExistence(timeout: 5) {
            contextButton.tap()
        } else {
            // Fallback: try to find by accessibility label pattern
            let contextIndicator = app.buttons.matching(
                NSPredicate(format: "label CONTAINS[c] 'Context usage'")
            ).firstMatch
            if contextIndicator.waitForExistence(timeout: 3) {
                contextIndicator.tap()
            }
        }
    }

    private func navigateToSettings() {
        #if os(macOS)
        // On macOS, settings is in sidebar or menu
        let settingsButton = app.buttons["Settings"]
        if settingsButton.waitForExistence(timeout: 5) {
            settingsButton.tap()
        }
        #else
        // On iOS, look for tab bar or navigation
        let settingsTab = app.tabBars.buttons["Settings"]
        if settingsTab.waitForExistence(timeout: 5) {
            settingsTab.tap()
        } else {
            // Try sidebar button for iPad
            let sidebarSettings = app.buttons["Settings"]
            if sidebarSettings.waitForExistence(timeout: 3) {
                sidebarSettings.tap()
            }
        }
        #endif
    }

    private func navigateToChat() {
        #if os(macOS)
        let chatButton = app.buttons["New Chat"]
        if chatButton.waitForExistence(timeout: 5) {
            chatButton.tap()
        }
        #else
        let chatTab = app.tabBars.buttons["Chat"]
        if chatTab.waitForExistence(timeout: 5) {
            chatTab.tap()
        }
        #endif
    }
}
