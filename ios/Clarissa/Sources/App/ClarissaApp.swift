import ClarissaKit
import SwiftUI

@main
struct ClarissaApp: App {
    @StateObject private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            if appState.isOnboardingComplete {
                ContentView()
                    .environmentObject(appState)
            } else {
                OnboardingView()
                    .environmentObject(appState)
            }
        }
        #if os(macOS)
        .windowStyle(.automatic)
        .windowResizability(.contentSize)
        .defaultSize(width: 800, height: 600)
        .commands {
            CommandGroup(replacing: .newItem) {}
        }
        #endif
    }
}

