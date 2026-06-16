# python-example

This app provides a simple greeting CLI written in Python. It demonstrates how Python-based apps integrate into the happycompany.

## Capabilities

| Command | Description |
|---------|-------------|
| `bin/run` | Prints a greeting. Accepts `--name NAME` and `--lang LANG` (en/zh/es/ja) flags |

## When to Use

- As a reference for building Python-based domain apps
- To verify the platform's dual-language support (spec D14)

## Integration Notes

- The `bin/run` shell script delegates to `src/hello.py`
- Python must be available in the system PATH for this app to work
- The app gracefully handles missing Python with a clear error message
