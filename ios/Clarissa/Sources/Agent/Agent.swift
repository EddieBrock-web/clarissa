import Foundation

/// Configuration for the agent
struct AgentConfig {
    var maxIterations: Int = 10
    var autoApprove: Bool = false
}

// MARK: - Token Management

/// Constants for Foundation Models context window management
/// Community insight: "The 4,096 token limit is for input + output combined, not separate"
enum TokenBudget {
    /// Total context window for Foundation Models
    static let totalContextWindow = 4096

    /// Reserve tokens for system instructions
    static let systemReserve = 300

    /// Reserve tokens for the expected response
    static let responseReserve = 1500

    /// Maximum tokens for conversation history
    static let maxHistoryTokens = totalContextWindow - systemReserve - responseReserve

    /// Estimate tokens for a string
    /// Community insight: "For Latin text: ~3-4 characters per token, CJK: ~1 char per token"
    static func estimate(_ text: String) -> Int {
        let asciiCount = text.unicodeScalars.filter { $0.isASCII }.count
        let isMainlyLatin = asciiCount > text.count / 2
        return isMainlyLatin ? max(1, text.count / 4) : text.count
    }

    /// Estimate tokens for an array of messages
    static func estimate(_ messages: [Message]) -> Int {
        messages.reduce(0) { $0 + estimate($1.content) }
    }
}

/// Errors that can occur during agent execution
enum AgentError: LocalizedError {
    case maxIterationsReached
    case noProvider
    case toolNotFound(String)
    case toolExecutionFailed(String, Error)
    
    var errorDescription: String? {
        switch self {
        case .maxIterationsReached:
            return "Maximum iterations reached. The agent may be stuck in a loop."
        case .noProvider:
            return "No LLM provider configured."
        case .toolNotFound(let name):
            return "Tool '\(name)' not found."
        case .toolExecutionFailed(let name, let error):
            return "Tool '\(name)' failed: \(error.localizedDescription)"
        }
    }
}

/// The Clarissa Agent - implements the ReAct loop pattern
@MainActor
final class Agent: ObservableObject {
    private var messages: [Message] = []
    private let config: AgentConfig
    private let toolRegistry: ToolRegistry
    private var provider: (any LLMProvider)?

    weak var callbacks: AgentCallbacks?

    init(
        config: AgentConfig = AgentConfig(),
        toolRegistry: ToolRegistry = .shared
    ) {
        self.config = config
        self.toolRegistry = toolRegistry
    }
    
    /// Set the LLM provider
    func setProvider(_ provider: any LLMProvider) {
        self.provider = provider
    }
    
    /// Build the system prompt with memories
    /// Community insight: "Include examples in your session instructions to guide tool usage"
    /// Note: Tool names are registered natively with the LLM provider
    private func buildSystemPrompt() async -> String {
        // Instructions should be in English for best results per community insight
        var prompt = """
        You are Clarissa, a helpful AI assistant.

        TOOL USAGE GUIDELINES:
        - When the user asks about weather or temperature, use the weather tool.
        - When the user wants to create, list, or search calendar events, use the calendar tool.
        - When the user asks to find or look up a contact, use the contacts tool.
        - When the user wants to create or list reminders/tasks, use the reminders tool.
        - When the user asks for their location or "where am I", use the location tool.
        - When the user needs to calculate or do math, use the calculator tool.
        - When the user wants to fetch or read a webpage/URL, use the web_fetch tool.
        - When the user asks you to remember something, use the remember tool.

        RESPONSE GUIDELINES:
        - Always explain what you're doing and provide clear, helpful responses.
        - If a tool fails, explain the error and suggest alternatives if possible.
        - Be concise but thorough. Format your responses for mobile display.
        - For non-tool questions, respond directly without using tools.
        """

        // Add memories if any (sanitized in MemoryManager)
        if let memoriesPrompt = await MemoryManager.shared.getForPrompt() {
            prompt += "\n\n\(memoriesPrompt)"
        }

        return prompt
    }
    
    /// Trim conversation history to fit within token budget
    /// Keeps system prompt and at least the last user message
    private func trimHistoryIfNeeded() {
        // Don't trim if we only have system + 1 message
        guard messages.count > 2 else { return }

        // Get non-system messages for token counting
        let historyMessages = messages.filter { $0.role != .system }
        var tokenCount = TokenBudget.estimate(historyMessages)

        // Trim from the beginning (oldest first) until within budget
        // Keep at least the last 2 messages (user + response pair)
        while tokenCount > TokenBudget.maxHistoryTokens && messages.count > 3 {
            // Find first non-system message to remove
            if let firstNonSystemIndex = messages.firstIndex(where: { $0.role != .system }) {
                let removed = messages.remove(at: firstNonSystemIndex)
                tokenCount -= TokenBudget.estimate(removed.content)
            } else {
                break
            }
        }
    }

    /// Run the agent with a user message
    func run(_ userMessage: String) async throws -> String {
        guard let provider = provider else {
            throw AgentError.noProvider
        }

        // Update system prompt
        let systemPrompt = await buildSystemPrompt()
        if messages.isEmpty || messages.first?.role != .system {
            messages.insert(.system(systemPrompt), at: 0)
        } else {
            messages[0] = .system(systemPrompt)
        }

        // Add user message
        messages.append(.user(userMessage))

        // Trim history to fit within Foundation Models context window
        trimHistoryIfNeeded()

        // Get available tools
        let tools = toolRegistry.getDefinitions()
        
        // ReAct loop
        for _ in 0..<config.maxIterations {
            callbacks?.onThinking()
            
            // Get LLM response with streaming
            var fullContent = ""
            var toolCalls: [ToolCall] = []
            
            for try await chunk in provider.streamComplete(messages: messages, tools: tools) {
                if let content = chunk.content {
                    fullContent += content
                    callbacks?.onStreamChunk(chunk: content)
                }
                if let calls = chunk.toolCalls {
                    toolCalls = calls
                }
            }
            
            // Create assistant message
            let assistantMessage = Message.assistant(
                fullContent,
                toolCalls: toolCalls.isEmpty ? nil : toolCalls
            )
            messages.append(assistantMessage)
            
            // Check for tool calls
            if !toolCalls.isEmpty {
                for toolCall in toolCalls {
                    callbacks?.onToolCall(name: toolCall.name, arguments: toolCall.arguments)
                    
                    // Check confirmation if needed
                    let needsConfirmation = toolRegistry.requiresConfirmation(toolCall.name)
                    if !config.autoApprove && needsConfirmation {
                        let approved = await callbacks?.onToolConfirmation(
                            name: toolCall.name,
                            arguments: toolCall.arguments
                        ) ?? true
                        
                        if !approved {
                            let result = Message.tool(
                                callId: toolCall.id,
                                name: toolCall.name,
                                content: "{\"rejected\": true, \"message\": \"User rejected this tool execution\"}"
                            )
                            messages.append(result)
                            callbacks?.onToolResult(name: toolCall.name, result: "Rejected by user")
                            continue
                        }
                    }
                    
                    // Execute tool
                    do {
                        let result = try await toolRegistry.execute(name: toolCall.name, arguments: toolCall.arguments)
                        let toolMessage = Message.tool(callId: toolCall.id, name: toolCall.name, content: result)
                        messages.append(toolMessage)
                        callbacks?.onToolResult(name: toolCall.name, result: result)
                    } catch {
                        let errorResult = "{\"error\": \"\(error.localizedDescription)\"}"
                        let toolMessage = Message.tool(callId: toolCall.id, name: toolCall.name, content: errorResult)
                        messages.append(toolMessage)
                        callbacks?.onToolResult(name: toolCall.name, result: errorResult)
                    }
                }
                continue // Continue loop for next response
            }
            
            // No tool calls - final response
            callbacks?.onResponse(content: fullContent)
            return fullContent
        }
        
        throw AgentError.maxIterationsReached
    }
    
    /// Reset conversation (keep system prompt)
    func reset() {
        let systemMessage = messages.first { $0.role == .system }
        messages = systemMessage.map { [$0] } ?? []
    }
    
    /// Get conversation history
    func getHistory() -> [Message] {
        messages
    }
    
    /// Load messages from a saved session
    func loadMessages(_ savedMessages: [Message]) {
        let systemMessage = messages.first { $0.role == .system }
        let filtered = savedMessages.filter { $0.role != .system }
        messages = (systemMessage.map { [$0] } ?? []) + filtered
    }
    
    /// Get messages for saving (excluding system)
    func getMessagesForSave() -> [Message] {
        messages.filter { $0.role != .system }
    }
}

