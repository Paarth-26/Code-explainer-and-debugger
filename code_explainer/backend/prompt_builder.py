"""Builds prompts for each stage of the LLM pipeline."""


def build_analysis_prompt(user_code: str) -> str:
    """Build prompt for stage 1: initial code analysis."""
    return (
        "Analyze the following code.\n\n"
        "Tasks:\n\n"
        "1. Identify the programming language\n"
        "2. Explain the code line by line\n"
        "3. Detect syntax or logical errors\n"
        "4. Identify the overall purpose or algorithm\n\n"
        "Code:\n"
        f"{user_code}"
    )


def build_explanation_improver_prompt(analysis_output: str) -> str:
    """Build prompt for stage 2: improve readability of analysis."""
    return (
        "Rewrite the following explanation so it is clearer and easier to "
        "understand.\n\n"
        "Organize the response into these sections:\n\n"
        "Program Overview\n"
        "Step-by-step Logic\n"
        "Example Execution (if helpful)\n\n"
        "Explanation:\n"
        f"{analysis_output}"
    )


def build_fixes_variants_complexity_prompt(user_code: str, analysis_output: str) -> str:
    """Build prompt for stage 3: fixes, variants, and complexity."""
    return (
        "You are a senior software engineer reviewing code.\n\n"
        "Code:\n"
        f"{user_code}\n\n"
        "Analysis:\n"
        f"{analysis_output}\n\n"
        "Respond using the EXACT sections below.\n\n"
        "## FIXES & OPTIMIZATION\n\n"
        "- If the code has bugs, provide corrected code.\n"
        '- If the code is already correct, write: "No fixes required."\n'
        "- Suggest small improvements if useful.\n\n"
        "## CODE VARIANTS\n\n"
        "Always provide EXACTLY two alternative implementations of the same "
        "behavior as the original code (same inputs/outputs), unless the snippet "
        "is too trivial (e.g. a single constant). For each variant, include "
        "full code in a fenced code block and a short tradeoff note.\n\n"
        "Use these subsection titles verbatim:\n\n"
        "### Variant A — Readability first\n"
        "- Prioritize clear names, structure, comments where helpful, and "
        "straightforward control flow. Performance is secondary.\n\n"
        "### Variant B — Performance first\n"
        "- Prioritize speed and efficiency (fewer allocations, tighter loops, "
        "better asymptotics or practical throughput). The code may be denser, "
        "less obvious, or harder to maintain — say so explicitly.\n\n"
        "If and only if there is no meaningful way to offer two such variants, "
        "write exactly this single line and nothing else: NO_VARIANTS\n\n"
        "## COMPLEXITY ANALYSIS\n\n"
        "Provide:\n\n"
        "Time Complexity\n"
        "Space Complexity\n\n"
        "Give a short explanation for each."
    )
