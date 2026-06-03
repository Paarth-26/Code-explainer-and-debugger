"""Groq client utilities for multi-stage code analysis."""

import os
from pathlib import Path

from dotenv import load_dotenv
from groq import Groq

# Project root is code_explainer/ (parent of backend/)
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b"


def _load_project_env() -> None:
    """Load environment variables from the project-local .env file."""
    load_dotenv(_PROJECT_ROOT / ".env")


def get_groq_model_name() -> str:
    """Return the configured Groq model name, falling back to GPT OSS 120B."""
    _load_project_env()
    model = os.getenv("GROQ_MODEL", DEFAULT_GROQ_MODEL).strip()
    return model or DEFAULT_GROQ_MODEL


def create_groq_client() -> Groq:
    """Create a Groq SDK client using an API key from .env."""
    _load_project_env()
    api_key = os.getenv("GROQ_API_KEY")

    if not api_key:
        raise ValueError(
            "GROQ_API_KEY is missing. Create a .env file and add your key."
        )

    return Groq(api_key=api_key)


def call_groq(prompt: str) -> str:
    """Send a prompt to Groq and return response text."""
    client = create_groq_client()
    completion = client.chat.completions.create(
        model=get_groq_model_name(),
        messages=[{"role": "user", "content": prompt}],
    )

    return completion.choices[0].message.content or "No response received."


def analyze_code_with_llm(prompt: str) -> str:
    """Backward-compatible helper for older single-call usage."""
    return call_groq(prompt)
