<p align="center">
  <img src="logo.svg" alt="Clarissa" width="128" height="128">
</p>

<h1 align="center">Clarissa</h1>

<p align="center">
  An AI-powered terminal assistant with tool execution capabilities
</p>

---

Clarissa is a command-line AI agent built with [Bun](https://bun.sh) and [Ink](https://github.com/vadimdemedes/ink). It provides a conversational interface powered by [OpenRouter](https://openrouter.ai), enabling access to various LLMs like Claude, GPT-4, Gemini, and more. The agent can execute tools, manage files, run shell commands, and integrate with external services via the Model Context Protocol (MCP).

## Features

- **Multi-model support** - Switch between Claude, GPT-4, Gemini, Llama, DeepSeek, and other models via OpenRouter
- **Streaming responses** - Real-time token streaming for responsive conversations
- **Built-in tools** - File operations, Git integration, shell commands, web fetching, and more
- **MCP integration** - Connect to external MCP servers to extend functionality
- **Session management** - Save and restore conversation history
- **Context management** - Automatic token tracking and context truncation
- **Tool confirmation** - Approve or reject potentially dangerous operations

## Requirements

- [Bun](https://bun.sh) v1.0 or later (for running from source or npm install)
- An [OpenRouter API key](https://openrouter.ai/keys)

## Installation

### From npm (recommended)

```bash
# Using bun
bun install -g clarissa

# Using npm
npm install -g clarissa
```

### From source

```bash
git clone https://github.com/cameronrye/clarissa.git
cd clarissa
bun install
bun link
```

### Standalone binary

Download a pre-built binary from the [releases page](https://github.com/cameronrye/clarissa/releases) and add it to your PATH:

```bash
# Example for macOS ARM
chmod +x clarissa-macos-arm64
mv clarissa-macos-arm64 /usr/local/bin/clarissa
```

## Configuration

Set your OpenRouter API key as an environment variable:

```bash
export OPENROUTER_API_KEY=your_api_key_here
```

Optional environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENROUTER_MODEL` | `anthropic/claude-sonnet-4` | Default model to use |
| `MAX_ITERATIONS` | `10` | Maximum tool execution iterations per request |
| `DEBUG` | `false` | Enable debug logging |

## Usage

Start Clarissa:

```bash
bun run start
```

Or run directly:

```bash
bun src/index.tsx
```

### Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/clear` | Clear conversation history |
| `/save` | Save current session |
| `/sessions` | List saved sessions |
| `/load ID` | Load a saved session |
| `/model [NAME]` | Show or switch the current model |
| `/mcp CMD ARGS` | Connect to an MCP server |
| `/tools` | List available tools |
| `/exit` | Exit Clarissa |

### Built-in Tools

**File Operations**
- `read_file` - Read file contents
- `write_file` - Write or create files
- `patch_file` - Apply patches to files
- `list_directory` - List directory contents
- `search_files` - Search for files by pattern

**Git Integration**
- `git_status` - Show repository status
- `git_diff` - Show changes
- `git_log` - View commit history
- `git_add` - Stage files
- `git_commit` - Commit changes
- `git_branch` - Manage branches

**System**
- `bash` - Execute shell commands
- `calculator` - Perform calculations

**Web**
- `web_fetch` - Fetch and parse web pages

### MCP Integration

Connect to Model Context Protocol servers to extend Clarissa with additional tools:

```bash
/mcp npx -y @modelcontextprotocol/server-filesystem /path/to/directory
```

## Development

Run with hot reloading:

```bash
bun run dev
```

Run tests:

```bash
bun test
```

### Building Binaries

Build for your current platform:

```bash
bun run build:current
```

Build for all platforms:

```bash
bun run build:all
```

Binaries are output to the `dist/` directory.

### Publishing to npm

```bash
npm publish
```

## Project Structure

```
src/
  index.tsx        # Entry point
  agent.ts         # ReAct agent loop implementation
  config/          # Environment configuration
  llm/             # LLM client and context management
  mcp/             # MCP client integration
  session/         # Session persistence
  tools/           # Tool definitions
  ui/              # Ink UI components
```

## License

MIT

---

Made with ❤️ by [Cameron Rye](https://rye.dev)
