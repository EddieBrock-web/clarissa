import Foundation

/// System prompt for the prompt enhancement feature.
/// Instructs the LLM to improve prompts while preserving intent.
private let enhancementSystemPrompt = """
You are a prompt enhancement assistant. Your task is to improve user prompts to make them clearer, more specific, and more effective.

Guidelines for enhancement:
1. Make the prompt more detailed and explicit
2. Remove ambiguity and vague language
3. Fix grammatical or spelling errors
4. Add relevant context where it would help
5. Preserve the original intent completely
6. Keep the prompt concise - don't make it unnecessarily long
7. Return ONLY the enhanced prompt, no explanations or preamble

If the prompt is already clear and well-formed, return it with minimal changes.
"""

/// Actor responsible for enhancing user prompts using an LLM provider.
/// Thread-safe and can be used from any context.
actor PromptEnhancer {
    /// Shared singleton instance
    static let shared = PromptEnhancer()

    private init() {}

    /// Enhances a user prompt using the provided LLM provider.
    ///
    /// - Parameters:
    ///   - prompt: The original prompt text to enhance
    ///   - provider: The LLM provider to use for enhancement
    /// - Returns: The enhanced prompt text
    /// - Throws: Any errors from the LLM provider
    func enhance(_ prompt: String, using provider: any LLMProvider) async throws -> String {
        let trimmedPrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedPrompt.isEmpty else {
            return prompt
        }

        ClarissaLogger.agent.info("Enhancing prompt: \(trimmedPrompt.prefix(50), privacy: .public)...")

        let messages: [Message] = [
            .system(enhancementSystemPrompt),
            .user("Enhance this prompt:\n\n\(trimmedPrompt)")
        ]

        // Use the provider without tools for simple text generation
        let response = try await provider.complete(messages: messages, tools: [])

        var enhanced = response.content.trimmingCharacters(in: .whitespacesAndNewlines)

        // Clean up any stray LLM artifacts that may have leaked through
        enhanced = cleanLLMOutput(enhanced)

        ClarissaLogger.agent.info("Prompt enhanced successfully")

        // Return enhanced text, or original if response is empty
        return enhanced.isEmpty ? prompt : enhanced
    }

    /// Clean up LLM output by removing function call syntax and executable tags
    private func cleanLLMOutput(_ text: String) -> String {
        var result = text

        // Remove executable tags like <executable_end>, <exe>, etc.
        let executablePatterns = [
            "<executable_end>",
            "<exe>",
            "</exe>",
            "<executable>",
            "</executable>",
            "```executable",
            "```function"
        ]
        for pattern in executablePatterns {
            result = result.replacingOccurrences(of: pattern, with: "", options: .caseInsensitive)
        }

        // Remove function call JSON blocks with backticks
        // Pattern: ```function ... ``` or ```json ... ``` containing function calls
        if let range = result.range(of: "```(?:function|json)?\\s*\\[\\{\"name\":[^`]+```", options: .regularExpression) {
            result.removeSubrange(range)
        }

        // Remove bare function call arrays like [{"name": "...", "arguments": ...}]
        if let range = result.range(of: "\\[\\{\"name\":\\s*\"[^\"]+\",\\s*\"arguments\":[^\\]]+\\}\\]", options: .regularExpression) {
            result.removeSubrange(range)
        }

        // Clean up any resulting whitespace issues
        result = result.trimmingCharacters(in: .whitespacesAndNewlines)

        // Remove leading/trailing backticks if the result is wrapped in code blocks
        if result.hasPrefix("```") && result.hasSuffix("```") {
            result = String(result.dropFirst(3).dropLast(3)).trimmingCharacters(in: .whitespacesAndNewlines)
        }

        return result
    }
}

