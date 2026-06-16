# python-example

A sample Python-based app demonstrating the dual-language pattern defined in spec D14. The happycompany itself is TypeScript, but domain Apps can be written in Python by exposing a shell entry point.

## Quick Start

```bash
# Direct invocation
bin/run --name Alice --lang en

# Expected output:
# Hello, Alice!
```

## Arguments

| Flag | Default | Description |
|------|---------|-------------|
| `--name NAME` | `World` | Name to greet |
| `--lang LANG` | `en` | Language: en, zh, es, ja |

## Examples

```bash
bin/run                          # Hello, World!
bin/run --name Bob               # Hello, Bob!
bin/run --name Bob --lang zh     # 你好, Bob!
bin/run --name Bob --lang es     # Hola, Bob!
bin/run --name Bob --lang ja     # こんにちは, Bob!
```

## Project Structure

```
python-example/v1.0/
  bin/run           # Shell entry point (executable)
  src/hello.py      # Python script with argparse
  requirements.txt  # Python dependencies (empty for this example)
  SKILL.md          # Skill metadata
  CLAUDE.md         # Bot-level description
  README.md         # This file
```

## Pattern for New Python Apps

To create a new Python app for this platform:

1. Create the directory structure above under `apps/{your-app}/v1.0/`
2. Write `bin/run` as an executable shell script that invokes Python
3. Place Python source code under `src/`
4. List dependencies in `requirements.txt` if needed
5. Add `SKILL.md` with frontmatter and usage instructions
6. Add `CLAUDE.md` for bot-level description
7. Add `README.md` for documentation

The platform's `app-runner.ts` detects Python apps by the presence of `requirements.txt` or `*.py` files, and invokes them via `bin/run` just like any other app.
