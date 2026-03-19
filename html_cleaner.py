#!/usr/bin/env python3

import argparse
import re
import sys
from pathlib import Path
from typing import List, Tuple

PatternReplacement = Tuple[re.Pattern, str]

RULES: List[PatternReplacement] = [
    (re.compile(r"<svg[\s\S]*?<\/svg>"), "<svg></svg>"),
    (re.compile(r'\s*class="[^"]*"'), ""),
    (re.compile(r'\s*style="[^"]*"'), ""),
    (
        re.compile(
            r'\s*(dir|tabindex|role|aria-hidden|aria-labelledby|aria-level)="[^"]*"'
        ),
        "",
    ),
]


def clean_dom(content: str, rules: List[PatternReplacement]) -> str:
    for pattern, replacement in rules:
        content = pattern.sub(replacement, content)
    return content


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input_file", type=Path)
    parser.add_argument("-o", "--output", type=Path)
    args = parser.parse_args()

    input_path: Path = args.input_file
    if not input_path.is_file():
        sys.exit(1)

    output_path: Path = args.output or input_path.with_name(
        f"{input_path.stem}_clean{input_path.suffix}"
    )

    content = input_path.read_text(encoding="utf-8")
    cleaned_content = clean_dom(content, RULES)
    output_path.write_text(cleaned_content, encoding="utf-8")


if __name__ == "__main__":
    main()
