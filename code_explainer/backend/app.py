"""FastAPI server: API + static frontend for the code explainer."""

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .llm_client import get_groq_model_name
from .pipeline import run_pipeline

# code_explainer/ (sibling of backend/)
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = _PROJECT_ROOT / "frontend"

app = FastAPI(title="Code Explainer", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    code: str = Field(..., min_length=1, description="Source code to analyze")


class AnalyzeResponse(BaseModel):
    analysis_output: str = ""
    readable_explanation: str = ""
    fixes_and_optimization: str = ""
    code_variants: str = ""
    complexity_analysis: str = ""
    model: str = ""
    error: str | None = None


@app.post("/api/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest) -> AnalyzeResponse:
    try:
        out = run_pipeline(req.code)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if out.get("error"):
        return AnalyzeResponse(error=out["error"])

    return AnalyzeResponse(
        analysis_output=out["analysis_output"],
        readable_explanation=out["readable_explanation"],
        fixes_and_optimization=out["fixes_and_optimization"],
        code_variants=out["code_variants"],
        complexity_analysis=out["complexity_analysis"],
        model=get_groq_model_name(),
    )


@app.get("/api/meta")
def meta() -> dict[str, str]:
    return {
        "app_name": app.title,
        "version": app.version,
        "model": get_groq_model_name(),
    }


@app.get("/")
def index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


app.mount("/static", StaticFiles(directory=FRONTEND_DIR / "static"), name="static")
