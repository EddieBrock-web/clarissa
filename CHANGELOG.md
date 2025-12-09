# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2025-12-09

### Added

- **Apple Foundation Model with Tools** - Full tool calling support for Apple Intelligence
  - Apple on-device AI now supports all built-in tools (file operations, git, bash, web fetch)
  - Intelligent tool limit handling (max 10 tools for optimal performance)
  - Channel token parsing for clean output from thinking models
  - Automatic retry without tools when model returns null responses
- **Enhanced Apple AI streaming** - Real-time streaming with channel token filtering
- **Comprehensive test suite** - New test script for Apple AI provider (`bun test:apple-ai`)

### Fixed

- Apple AI responses now properly parse channel tokens (analysis, commentary, final)
- Tool calls from Apple Foundation Model now correctly extract function arguments
- Streaming mode properly filters internal model tokens for clean user output

## [1.1.0] - 2025-12-08

### Added

- **Multi-provider LLM support** - Switch between different LLM providers at runtime
  - OpenRouter (cloud) - Access to 100+ models
  - OpenAI (cloud) - Direct GPT API access
  - Anthropic (cloud) - Direct Claude API access
  - Apple Intelligence (local) - On-device AI for macOS 26+
  - LM Studio (local) - Local inference via LM Studio desktop app
  - Local Llama (local) - Direct GGUF model inference via node-llama-cpp
- **Provider registry** - Automatic provider detection and priority-based selection
- **Model download system** - Download GGUF models from Hugging Face
  - `clarissa download` command with recommended models list
  - `clarissa models` command to list downloaded models
  - Progress tracking during downloads
  - Curated list of best models (Qwen 3, Gemma 3, Llama 4, DeepSeek R1, etc.)
- **Preferences persistence** - Remember last used provider and model across sessions
- **Auto-update system** - Check for updates and upgrade easily
  - `clarissa upgrade` command to update to latest version
  - Background update checking with notifications
  - Package manager detection (bun, pnpm, npm)
- **`/provider` command** - Switch LLM providers during a session
- **Retry logic** - Exponential backoff with jitter for API rate limits

### Changed

- Refactored LLM client to use provider abstraction layer
- Updated architecture diagram to show multi-provider support
- Enhanced configuration options for provider-specific settings

## [1.0.2] - 2025-12-07

### Fixed

- Configure custom domain clarissa.run for GitHub Pages
- SSL certificate provisioning and HTTPS enforcement

## [1.0.1] - 2025-12-07

### Added

- Custom domain clarissa.run for documentation site
- Open Graph and Twitter Card meta tags for SEO
- JSON-LD structured data

## [1.0.0] - 2025-12-07

### Added

- Initial release of Clarissa
- Interactive terminal UI with Ink
- One-shot command mode with piped input support
- ReAct agent loop for multi-step reasoning
- Built-in tools:
  - `calculator` - Safe mathematical expression evaluation
  - `bash` - Shell command execution with timeout
  - `read_file` - Read file contents
  - `write_file` - Write/create files
  - `patch_file` - Apply patches to files
  - `list_directory` - List directory contents
  - `search_files` - Search for patterns in files
  - `git_status`, `git_diff`, `git_log`, `git_add`, `git_commit`, `git_branch` - Git operations
  - `web_fetch` - Fetch content from URLs
- MCP (Model Context Protocol) server integration
- Session management with save/load/resume
- Memory persistence across sessions
- Context window management with automatic truncation
- Token usage and cost tracking
- Tool confirmation system for dangerous operations
- Multiple model support via OpenRouter
- Prompt enhancement with Ctrl+P
- Markdown rendering in terminal

### Security

- Path traversal protection for file operations
- Session ID validation
- Tool confirmation for destructive operations
