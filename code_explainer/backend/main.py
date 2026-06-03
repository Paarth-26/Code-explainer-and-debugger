"""Terminal CLI for a 3-stage code analysis pipeline with Groq."""

import re

from .pipeline import is_no_variants_response, run_pipeline


def collect_multiline_code() -> str:
    """Read user input until END is entered on a new line."""
    print("Paste your code below.")
    print("Type END on a new line to finish.")

    lines = []
    while True:
        line = input()
        if line.strip() == "END":
            break
        lines.append(line)

    return "\n".join(lines).strip()


def _clean_for_terminal(text: str) -> str:
    """Remove noisy markdown headers while preserving bullets and code blocks."""
    lines = text.splitlines()
    cleaned_lines = []
    in_code_block = False

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("```"):
            in_code_block = not in_code_block
            cleaned_lines.append(line)
            continue

        if not in_code_block and re.match(r"^\s*#{3,}\s+.+$", line):
            continue

        cleaned_lines.append(line)

    cleaned_text = "\n".join(cleaned_lines).strip()
    return cleaned_text or "No content returned."


def _print_section(title: str, content: str) -> None:
    """Print a single output section with consistent spacing and separators."""
    print("\n" + "=" * 48)
    print(title)
    print("=" * len(title))
    print()
    print(_clean_for_terminal(content))


def print_formatted_output(
    analysis_output: str,
    readable_explanation: str,
    fixes_and_optimization: str,
    code_variants: str,
    complexity_analysis: str,
) -> None:
    """Display stage outputs in a cleaner terminal-friendly format."""
    _print_section("CODE ANALYSIS", analysis_output)
    _print_section("READABLE EXPLANATION", readable_explanation)
    _print_section("FIXES & OPTIMIZATION", fixes_and_optimization)

    if code_variants and not is_no_variants_response(code_variants):
        _print_section("CODE VARIANTS", code_variants)

    _print_section("COMPLEXITY ANALYSIS", complexity_analysis)


def main() -> None:
    """Run CLI flow: read code, build prompt, call LLM, print result."""
    user_code = collect_multiline_code()
    if not user_code:
        print("No code provided. Exiting.")
        return

    try:
        result = run_pipeline(user_code)
    except Exception as exc:
        print(f"Error: {exc}")
        return

    if result.get("error"):
        print(result["error"])
        return

    print_formatted_output(
        analysis_output=result["analysis_output"],
        readable_explanation=result["readable_explanation"],
        fixes_and_optimization=result["fixes_and_optimization"],
        code_variants=result["code_variants"],
        complexity_analysis=result["complexity_analysis"],
    )


if __name__ == "__main__":
    main()
