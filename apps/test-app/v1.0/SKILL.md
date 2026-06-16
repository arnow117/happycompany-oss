---
name: test-app
description: Sample app for testing the CLI intermediary layer (spec D4).
user-invocable: true
argument-hint: "[args...]"
allowed-tools: Bash
---

# test-app

A minimal test app that demonstrates the skill -> CLI -> app code chain.

## CLI Entry Point

- **Path**: `bin/run`
- **Usage**: `bin/run [args...]`
- **Behavior**: Echoes "App CLI: test-app" and lists provided arguments.
- **Stdin**: Reads stdin and echoes it back if present.
