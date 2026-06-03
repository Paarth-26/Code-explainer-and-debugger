"""Shared multi-stage code analysis pipeline (CLI and API)."""

import re
from typing import TypedDict

from .llm_client import call_groq
from .prompt_builder import (
    build_analysis_prompt,
    build_explanation_improver_prompt,
    build_fixes_variants_complexity_prompt,
)


class AnalysisResult(TypedDict, total=False):
    analysis_output: str
    readable_explanation: str
    fixes_and_optimization: str
    code_variants: str
    complexity_analysis: str
    error: str


def extract_section(content: str, heading: str, fallback: str = "") -> str:
    """Extract section based on heading keywords (legacy; can truncate on phrases like 'Time Complexity')."""
    pattern = re.compile(
        rf"{heading}[:\n](.*?)(?=\n[A-Z ]+[:\n]|$)",
        re.IGNORECASE | re.DOTALL,
    )
    match = pattern.search(content)
    if match:
        section = match.group(1).strip()
        if section:
            return section
    return fallback


def extract_h2_section(content: str, title: str) -> str | None:
    """Extract body under a markdown ## heading until the next ## heading (line-start)."""
    escaped = re.escape(title)
    pattern = re.compile(
        rf"(?ms)^\s*##\s+{escaped}\s*\r?\n(.*?)(?=^\s*##\s+|\Z)",
    )
    match = pattern.search(content)
    if not match:
        return None
    section = match.group(1).strip()
    return section if section else None


def extract_stage_three_field(content: str, title: str, fallback: str) -> str:
    """Prefer ##-bounded sections so prose inside variants (e.g. 'Time Complexity') is not cut off."""
    h2 = extract_h2_section(content, title)
    if h2:
        return h2
    return extract_section(content, title, fallback=fallback)


def is_no_variants_response(text: str) -> bool:
    """True when the model returned the explicit NO_VARIANTS placeholder."""
    for line in text.splitlines():
        stripped = line.strip().strip("*_`#").upper().rstrip(".:")
        if not stripped:
            continue
        if stripped == "NO_VARIANTS" or stripped.startswith("NO_VARIANTS"):
            return True
        return False
    return not text.strip()


def run_pipeline(user_code: str) -> AnalysisResult:
    """Run all three LLM stages and return structured sections."""
    code = user_code.strip()
    if not code:
        return {"error": "No code provided."}

    analysis_prompt = build_analysis_prompt(code)
    analysis_output = call_groq(analysis_prompt)

    improver_prompt = build_explanation_improver_prompt(analysis_output)
    readable_explanation = call_groq(improver_prompt)

    fixes_prompt = build_fixes_variants_complexity_prompt(code, analysis_output)
    stage_three_output = call_groq(fixes_prompt)

    fixes_and_optimization = extract_stage_three_field(
        stage_three_output,
        "FIXES & OPTIMIZATION",
        fallback="No fixes or optimization suggestions returned.",
    )
    code_variants = extract_stage_three_field(
        stage_three_output,
        "CODE VARIANTS",
        fallback="NO_VARIANTS",
    )
    complexity_analysis = extract_stage_three_field(
        stage_three_output,
        "COMPLEXITY ANALYSIS",
        fallback="No complexity analysis returned.",
    )

    return {
        "analysis_output": analysis_output,
        "readable_explanation": readable_explanation,
        "fixes_and_optimization": fixes_and_optimization,
        "code_variants": code_variants,
        "complexity_analysis": complexity_analysis,
    }
