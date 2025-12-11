import Foundation
@preconcurrency import Speech
@preconcurrency import AVFoundation

/// Handles speech-to-text using Apple's Speech framework
@MainActor
final class SpeechRecognizer: ObservableObject {
    @Published var transcript: String = ""
    @Published var isRecording: Bool = false
    @Published var isAvailable: Bool = false
    @Published var error: String?

    private let speechRecognizer: SFSpeechRecognizer?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?

    // Audio engine wrapper that handles operations on the correct queue
    private let audioHandler = AudioEngineHandler()

    init(locale: Locale = Locale(identifier: "en-US")) {
        speechRecognizer = SFSpeechRecognizer(locale: locale)
        isAvailable = speechRecognizer?.isAvailable ?? false
    }

    /// Request authorization for speech recognition
    func requestAuthorization() async -> Bool {
        let status = await requestSpeechAuthorizationStatus()

        // Update state on MainActor (we're already on MainActor due to class annotation)
        switch status {
        case .authorized:
            isAvailable = true
            return true
        case .denied, .restricted, .notDetermined:
            isAvailable = false
            error = "Speech recognition not authorized"
            return false
        @unknown default:
            isAvailable = false
            return false
        }
    }

    /// Start recording and transcribing speech
    func startRecording() async throws {
        guard let speechRecognizer, speechRecognizer.isAvailable else {
            throw SpeechError.recognizerUnavailable
        }

        // Cancel any existing task
        stopRecordingInternal()

        // Create recognition request
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true

        // Use on-device recognition for privacy
        request.requiresOnDeviceRecognition = speechRecognizer.supportsOnDeviceRecognition

        self.recognitionRequest = request

        // Start audio engine on dedicated queue (avoids dispatch queue assertion)
        try await audioHandler.start { [weak request] buffer in
            request?.append(buffer)
        }

        isRecording = true
        transcript = ""
        error = nil

        // Start recognition
        recognitionTask = speechRecognizer.recognitionTask(with: request) { [weak self] result, taskError in
            Task { @MainActor [weak self] in
                guard let self else { return }

                if let result {
                    self.transcript = result.bestTranscription.formattedString
                }

                if let taskError {
                    self.error = taskError.localizedDescription
                    self.stopRecordingInternal()
                }

                if result?.isFinal == true {
                    self.stopRecordingInternal()
                }
            }
        }
    }

    /// Stop recording and finalize transcription (internal implementation)
    private func stopRecordingInternal() {
        let request = recognitionRequest
        let task = recognitionTask

        recognitionRequest = nil
        recognitionTask = nil
        isRecording = false

        // Stop audio engine synchronously on dedicated queue
        audioHandler.stopSync()

        request?.endAudio()
        task?.cancel()
    }

    /// Stop recording and finalize transcription
    func stopRecording() {
        stopRecordingInternal()
    }

    /// Toggle recording state
    func toggleRecording() async {
        if isRecording {
            stopRecordingInternal()
        } else {
            do {
                try await startRecording()
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

enum SpeechError: LocalizedError {
    case recognizerUnavailable
    case requestCreationFailed
    case notAuthorized

    var errorDescription: String? {
        switch self {
        case .recognizerUnavailable:
            return "Speech recognizer is not available"
        case .requestCreationFailed:
            return "Failed to create speech recognition request"
        case .notAuthorized:
            return "Speech recognition is not authorized"
        }
    }
}

/// Handles AVAudioEngine operations on a dedicated queue to avoid dispatch assertion failures
private final class AudioEngineHandler: @unchecked Sendable {
    private let audioEngine = AVAudioEngine()
    private let queue = DispatchQueue(label: "com.clarissa.audioengine", qos: .userInitiated)

    func start(bufferHandler: @escaping @Sendable (AVAudioPCMBuffer) -> Void) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            queue.async { [self] in
                do {
                    // Stop any existing session first
                    if audioEngine.isRunning {
                        audioEngine.stop()
                    }
                    audioEngine.inputNode.removeTap(onBus: 0)

                    // Configure audio session
                    let audioSession = AVAudioSession.sharedInstance()
                    try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
                    try audioSession.setActive(true, options: .notifyOthersOnDeactivation)

                    // Set up audio input
                    let inputNode = audioEngine.inputNode
                    let recordingFormat = inputNode.outputFormat(forBus: 0)

                    // Validate format before installing tap
                    guard recordingFormat.sampleRate > 0 else {
                        throw SpeechError.requestCreationFailed
                    }

                    inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
                        bufferHandler(buffer)
                    }

                    audioEngine.prepare()
                    try audioEngine.start()

                    continuation.resume()
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    func stop() async {
        await withCheckedContinuation { continuation in
            queue.async { [self] in
                if audioEngine.isRunning {
                    audioEngine.stop()
                }
                audioEngine.inputNode.removeTap(onBus: 0)

                try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
                continuation.resume()
            }
        }
    }

    func stopSync() {
        queue.sync { [self] in
            if audioEngine.isRunning {
                audioEngine.stop()
            }
            audioEngine.inputNode.removeTap(onBus: 0)

            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }
}

/// Non-isolated helper to request speech authorization without actor isolation context
/// This avoids dispatch queue assertion failures when the callback runs on a background queue
private func requestSpeechAuthorizationStatus() async -> SFSpeechRecognizerAuthorizationStatus {
    await withCheckedContinuation { continuation in
        SFSpeechRecognizer.requestAuthorization { status in
            continuation.resume(returning: status)
        }
    }
}
