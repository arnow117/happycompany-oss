"""Greeting CLI for python-example app."""

import argparse
import sys


GREETINGS = {
    "en": "Hello, {name}!",
    "zh": "你好, {name}!",
    "es": "¡Hola, {name}!",
    "ja": "こんにちは, {name}!",
}


def greet(name: str, lang: str) -> str:
    template = GREETINGS.get(lang, GREETINGS["en"])
    return template.format(name=name)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Print a greeting in the specified language.",
    )
    parser.add_argument(
        "--name",
        default="World",
        help="Name to greet (default: World)",
    )
    parser.add_argument(
        "--lang",
        default="en",
        choices=list(GREETINGS.keys()),
        help="Language for the greeting (default: en)",
    )
    args = parser.parse_args()

    message = greet(args.name, args.lang)
    print(message)


if __name__ == "__main__":
    main()
