---
name: python-example
description: >
  A sample Python-based app that demonstrates how Python apps integrate
  into the happycompany. Provides a greeting CLI that accepts a name
  and an optional language flag, prints a formatted greeting, and exits.
  This app serves as the reference implementation for spec D14 (dual-language
  support: TypeScript platform + Python App CLI).
user-invocable: true
argument-hint: "[--name NAME] [--lang LANG]"
allowed-tools: Bash
---

# python-example

A minimal Python app that demonstrates the dual-language pattern (spec D14).
The platform stays TypeScript, but domain Apps can be written in Python by
exposing a shell `bin/run` entry point that invokes Python.

## CLI Entry Point

- **Path**: `bin/run`
- **Usage**: `bin/run [--name NAME] [--lang LANG]`
- **Behavior**: Prints a greeting message using argparse. Defaults to "World" with English.
- **Language options**: `en`, `zh`, `es`, `ja`

## How It Works

1. `bin/run` is a shell script that locates the Python interpreter
2. It delegates to `src/hello.py` with all forwarded arguments
3. `hello.py` uses argparse to parse flags and prints a formatted greeting

## Python App Pattern

Any Python app in this platform follows the same structure:

```
app-name/v1.0/
  SKILL.md       -- skill metadata + instructions
  CLAUDE.md      -- bot-level description
  README.md      -- documentation
  bin/run        -- shell entry point (chmod +x)
  src/           -- Python source code
  requirements.txt -- Python dependencies (optional)
```

The `bin/run` script must:
- Be executable (`chmod +x`)
- Forward all arguments to the Python script
- Handle the case where Python is not installed gracefully
