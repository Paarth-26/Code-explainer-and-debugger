# Code Explainer + Debug Assistant

This project is a local Python app that explains code with a 3-stage Groq pipeline.
It ships with two ways to use the same backend logic:

- A browser UI with an editor-style input panel, result tabs, and a previous-vs-current diff viewer
- A terminal CLI that reads pasted code until `END`

The goal of this README is to explain the codebase end to end, so you can see exactly how the app starts, how requests move through the system, how Groq is called, how results are parsed, and how the frontend renders them.

## What the app does

Given a code snippet, the app produces:

- An initial analysis
- A clearer rewritten explanation
- Fixes and optimization notes
- Optional code variants
- Complexity analysis

The default Groq model is `openai/gpt-oss-120b`, but you can override it with an environment variable.

## Tech stack

- Python for the backend, CLI, and launcher
- FastAPI for the HTTP API and static file serving
- Pydantic for request and response validation
- Groq Python SDK for LLM calls
- Plain HTML, CSS, and JavaScript for the frontend
- `marked` and `DOMPurify` from CDNs for markdown rendering and sanitization in the browser

## Project structure

```text
code_explainer/
|- backend/
|  |- __init__.py
|  |- __main__.py
|  |- app.py
|  |- llm_client.py
|  |- main.py
|  |- pipeline.py
|  |- prompt_builder.py
|- frontend/
|  |- index.html
|  |- static/
|     |- css/
|     |  |- styles.css
|     |- js/
|        |- app.js
|- requirements.txt
|- README.md
run.py
```

## End-to-end architecture

There are two entry paths into the same core pipeline:

1. Web flow
2. CLI flow

Both end up calling `backend.pipeline.run_pipeline`, which is the central orchestration function.

### Web flow at a glance

1. You run `python run.py` from the repository root.
2. `run.py` frees port `8765`, starts Uvicorn with `backend.app:app`, waits until the server responds, then opens the browser.
3. FastAPI serves `frontend/index.html` at `/` and static files from `/static`.
4. The browser loads `frontend/static/js/app.js`.
5. The frontend requests `/api/meta` to discover the current Groq model.
6. You paste code and click `Analyze` or press `Ctrl+Enter`.
7. The frontend sends `POST /api/analyze` with JSON like `{"code": "..."}`.
8. FastAPI validates the payload with Pydantic and calls `run_pipeline`.
9. `run_pipeline` builds three prompts and makes three sequential Groq calls.
10. Stage 3 output is parsed into `fixes`, `variants`, and `complexity`.
11. FastAPI returns the structured JSON response.
12. The frontend renders each section into its result tab.
13. The exact code you just analyzed becomes the new diff baseline for the next edit.

### CLI flow at a glance

1. You run `python -m backend` from inside `code_explainer`.
2. `backend/__main__.py` forwards execution to `backend.main.main`.
3. `collect_multiline_code()` reads lines until you enter `END`.
4. The CLI calls `run_pipeline`.
5. The returned sections are printed in a terminal-friendly format.

## Setup

Install dependencies from the `code_explainer` directory:

```bash
pip install -r requirements.txt
```

Create a `.env` file inside `code_explainer`:

```env
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=openai/gpt-oss-120b
```

`GROQ_MODEL` is optional. If you omit it, the code falls back to `openai/gpt-oss-120b`.

## How to run

### Web UI

From the repository root:

```bash
python run.py
```

This starts the FastAPI app on `http://127.0.0.1:8765/`.

### CLI

From the `code_explainer` directory:

```bash
python -m backend
```

Paste code, then enter:

```text
END
```

## Detailed code walkthrough

### 1. `run.py`: local launcher for the web app

`run.py` is a convenience script for the browser experience. It does more than just call Uvicorn.

Responsibilities:

- Defines the host and port: `127.0.0.1:8765`
- Locates the app directory at `code_explainer/`
- Frees the port before starting the server
- Starts Uvicorn as a subprocess
- Polls the server until it responds
- Opens the default web browser
- Keeps the process alive until you stop it

Important functions:

- `kill_listeners_on_port_windows(port)`
  Removes existing listeners on the port with `netstat` plus `taskkill`.
- `kill_listeners_on_port_posix(port)`
  Uses `lsof` and `os.kill` on Unix-like systems.
- `free_port(port)`
  Chooses the platform-specific implementation and waits briefly.
- `main()`
  Verifies the app folder exists, starts the server, waits for readiness, opens the browser, and handles shutdown.

Why it exists:

- It saves you from manually starting Uvicorn
- It reduces "port already in use" issues during local development
- It gives a one-command startup flow for the UI

### 2. `backend/app.py`: FastAPI app and HTTP contract

`backend/app.py` is the web entry point. It creates the FastAPI application and wires together the API and the static frontend.

Main pieces:

- `app = FastAPI(title="Code Explainer", version="1.0.0")`
- CORS middleware with permissive settings
- `AnalyzeRequest`
- `AnalyzeResponse`
- `/api/analyze`
- `/api/meta`
- `/`
- `/static`

#### `AnalyzeRequest`

This Pydantic model validates incoming JSON:

```json
{
  "code": "source code to analyze"
}
```

Validation rule:

- `code` must be present
- `code` must be at least 1 character long

#### `AnalyzeResponse`

This model defines the shape returned to the frontend:

- `analysis_output`
- `readable_explanation`
- `fixes_and_optimization`
- `code_variants`
- `complexity_analysis`
- `model`
- `error`

This is useful because the frontend can count on a stable schema.

#### `POST /api/analyze`

This route:

1. Accepts the validated request body
2. Calls `run_pipeline(req.code)`
3. Converts exceptions into HTTP 500 errors
4. Returns structured output for every visible tab in the UI
5. Includes the current Groq model name in the response

If `run_pipeline` returns an `"error"` key, the route returns that instead of stage outputs.

#### `GET /api/meta`

This is a lightweight metadata endpoint for the frontend.

It returns:

- App name
- Version
- Current Groq model

The frontend uses this to display the actual configured model in the hero area without waiting for a full analysis call.

#### `GET /`

This returns `frontend/index.html`.

#### `app.mount("/static", ...)`

This serves:

- `/static/css/styles.css`
- `/static/js/app.js`

### 3. `backend/llm_client.py`: environment loading and Groq calls

This module isolates all Groq-specific logic.

Responsibilities:

- Load environment variables from `code_explainer/.env`
- Pick the Groq model
- Build the Groq client
- Make chat completion requests

Important constants and functions:

- `DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b"`
- `_load_project_env()`
- `get_groq_model_name()`
- `create_groq_client()`
- `call_groq(prompt)`
- `analyze_code_with_llm(prompt)`

#### `_load_project_env()`

This loads `.env` from the project root, not from the current shell working directory.

That matters because the app can be started in different ways:

- `python run.py` from the repo root
- `python -m backend` from inside `code_explainer`

By resolving the path relative to the file location, the code avoids depending on where the command was launched from.

#### `get_groq_model_name()`

This returns:

- `GROQ_MODEL` from `.env` if present and non-empty
- otherwise `openai/gpt-oss-120b`

This is the single source of truth for model selection.

#### `create_groq_client()`

This:

- Loads the environment
- Reads `GROQ_API_KEY`
- Raises a clear error if the key is missing
- Returns a `Groq` client instance

#### `call_groq(prompt)`

This is the actual LLM request function.

It calls:

- `create_groq_client()`
- `client.chat.completions.create(...)`

with:

- `model=get_groq_model_name()`
- one user message containing the prompt text

It returns:

- The first choice's message content
- Or `"No response received."` if the API returns empty content

#### `analyze_code_with_llm(prompt)`

This is just a compatibility wrapper around `call_groq`. It is not currently the main path used by the app.

### 4. `backend/prompt_builder.py`: prompt construction

This module holds the three prompt templates used by the pipeline.

Functions:

- `build_analysis_prompt(user_code)`
- `build_explanation_improver_prompt(analysis_output)`
- `build_fixes_variants_complexity_prompt(user_code, analysis_output)`

#### Stage 1 prompt: analysis

This prompt asks the model to:

- Identify the programming language
- Explain the code line by line
- Detect syntax or logical errors
- Identify the overall purpose or algorithm

Input:

- The raw user code

Output expectation:

- Broad analysis text

#### Stage 2 prompt: explanation improver

This prompt takes the output of stage 1 and asks the model to rewrite it into a clearer structure.

Requested sections:

- Program Overview
- Step-by-step Logic
- Example Execution (if helpful)

Input:

- Stage 1 output, not the original code directly

Purpose:

- Turn a rough analysis into a cleaner explanation for human reading

#### Stage 3 prompt: fixes, variants, complexity

This is the most structured prompt in the project.

It gives the model:

- The original code
- The stage 1 analysis

And it requires the model to answer using exact markdown section headings:

- `## FIXES & OPTIMIZATION`
- `## CODE VARIANTS`
- `## COMPLEXITY ANALYSIS`

It also specifies:

- If code is already correct, say `"No fixes required."`
- Variants should be exactly two meaningful alternatives when possible
- Variant A should be readability-first
- Variant B should be performance-first
- If no meaningful variants exist, return `NO_VARIANTS`
- Complexity output should include time and space complexity

This exact formatting requirement is important because `pipeline.py` later parses these sections out of the model output.

### 5. `backend/pipeline.py`: core orchestration and response parsing

This is the heart of the application.

Responsibilities:

- Validate the incoming code string
- Build prompts for all three stages
- Call Groq three times in sequence
- Parse the structured stage 3 response
- Return a normalized result object

#### `AnalysisResult`

This is a `TypedDict` describing the pipeline output keys:

- `analysis_output`
- `readable_explanation`
- `fixes_and_optimization`
- `code_variants`
- `complexity_analysis`
- `error`

It documents the expected shape without forcing a runtime Pydantic model here.

#### `run_pipeline(user_code)`

This is the shared execution path used by both the API and the CLI.

Step by step:

1. Trim the incoming code
2. Return `{"error": "No code provided."}` if empty
3. Build stage 1 prompt from the raw code
4. Call Groq for the initial analysis
5. Build stage 2 prompt from stage 1 output
6. Call Groq for the improved explanation
7. Build stage 3 prompt from the original code plus stage 1 output
8. Call Groq for fixes, variants, and complexity
9. Parse stage 3 into three separate fields
10. Return the final dictionary

Why stage 2 uses stage 1 output:

- It treats stage 1 as a rough draft
- It asks the model to improve an explanation rather than regenerate one from scratch

Why stage 3 uses both original code and stage 1 output:

- The original code preserves exact source details
- The analysis gives the model extra context about intent and issues

#### Parsing helpers

The project uses three helpers to safely recover sections from stage 3:

- `extract_section(content, heading, fallback="")`
- `extract_h2_section(content, title)`
- `extract_stage_three_field(content, title, fallback)`

##### `extract_h2_section`

This is the preferred parser.

It looks for markdown `##` headings exactly like:

- `## FIXES & OPTIMIZATION`
- `## CODE VARIANTS`
- `## COMPLEXITY ANALYSIS`

and captures the text until the next `##` heading.

This is safer than a simpler regex because prose inside the section might mention phrases like "Time Complexity" and accidentally confuse a naive parser.

##### `extract_section`

This is the fallback parser. It is marked as legacy in the docstring.

It tries to match sections using a broader heading pattern and is only used if the nicer `##` parsing fails.

##### `extract_stage_three_field`

This combines the two approaches:

1. Try strict markdown heading extraction first
2. Fall back to the older regex extractor
3. If neither works, return a fallback string

#### `is_no_variants_response(text)`

This helper checks whether the model effectively returned `NO_VARIANTS`.

It normalizes:

- whitespace
- markdown decoration
- trailing punctuation
- capitalization

This allows the app to treat minor formatting differences as the same semantic value.

### 6. `backend/main.py`: CLI experience

This file provides the terminal workflow.

Functions:

- `collect_multiline_code()`
- `_clean_for_terminal(text)`
- `_print_section(title, content)`
- `print_formatted_output(...)`
- `main()`

#### `collect_multiline_code()`

Reads lines from standard input until the user enters `END` on its own line.

Why this approach:

- It keeps the CLI simple
- It avoids worrying about shell quoting for multiline snippets

#### `_clean_for_terminal(text)`

Removes noisy markdown headers with 3 or more `#` characters while preserving:

- code fences
- bullets
- regular text

This makes the CLI output cleaner without trying to fully convert markdown to terminal formatting.

#### `_print_section(title, content)`

Prints a single section with separators for readability.

#### `print_formatted_output(...)`

Prints:

- `CODE ANALYSIS`
- `READABLE EXPLANATION`
- `FIXES & OPTIMIZATION`
- `CODE VARIANTS` if meaningful variants exist
- `COMPLEXITY ANALYSIS`

It intentionally hides the variants section if the model returned `NO_VARIANTS`.

#### `main()`

This is the CLI entry point:

1. Collect user code
2. Exit early if it is empty
3. Run the shared pipeline
4. Print errors if the pipeline fails
5. Otherwise print each output section

### 7. `backend/__main__.py`: CLI module entry

This file is intentionally tiny.

Its only job is to make this command work:

```bash
python -m backend
```

It simply imports `main` from `backend.main` and runs it.

### 8. `frontend/index.html`: page structure

The HTML is a static shell. It does not contain business logic; it defines the regions the JavaScript will control.

Main sections:

- Hero
- Editor panel
- Diff card
- Results panel
- Footer

#### Hero

Displays:

- App title
- A short explanation of what the app returns
- The current model badge
- Short feature chips

The model badge starts with a default label and is later updated by `/api/meta`.

#### Editor panel

Contains:

- Line and character counters
- Sample snippet buttons
- Faux editor chrome
- Line-number gutter
- Main `<textarea>`
- Analyze and clear buttons
- Status message area

The frontend gives the textarea editor-like behavior, but it is still a native textarea under the hood.

#### Diff card

Shows changes between:

- The last code snippet you successfully analyzed
- The current contents of the editor

This is a local UI feature only. It does not involve extra backend storage.

#### Results panel

Contains tab buttons and one panel per result section:

- Analysis
- Readable rewrite
- Fixes
- Variants
- Complexity

These are filled dynamically by JavaScript.

#### Footer

Reminds the user which environment variables matter.

### 9. `frontend/static/js/app.js`: client-side behavior

This is the largest frontend logic file. It manages state, editor behavior, diffing, API calls, and result rendering.

High-level responsibilities:

- Cache DOM references
- Track active UI state
- Update line and character counts
- Keep the gutter scroll synced with the textarea
- Support editor-like indentation behavior
- Load sample snippets
- Render markdown results
- Compute and render previous-vs-current diffs
- Call `/api/meta`
- Call `/api/analyze`
- Manage tabs, status messages, copy, and empty states

#### Top-level state

The `state` object tracks:

- `activeTab`
- `baselineCode`
- `baselineTimeLabel`
- `modelName`

What that means:

- `activeTab` controls which result tab is visible
- `baselineCode` stores the most recently analyzed code
- `baselineTimeLabel` stores when that baseline was created
- `modelName` stores the current Groq model for display

#### Sample snippets

`editorSamples` contains three starter examples:

- JavaScript
- Python
- SQL

Clicking a sample button fills the editor with that snippet.

#### Input stats and gutter

Functions involved:

- `getLineCount(text)`
- `buildLineGutter(lineCount)`
- `updateInputStats()`
- `syncEditorScroll()`

These keep the UI feeling editor-like by:

- Counting lines and characters
- Rendering sequential line numbers
- Syncing the line-number gutter scroll position with the textarea

#### Status and model display

Functions involved:

- `setStatus(message, tone)`
- `setResultsMeta(text)`
- `setModelLabel(modelName)`
- `setLoading(loading)`

These are small UI helpers that centralize:

- Success and error messaging
- The loading spinner
- The model chip text
- Result metadata text

#### Markdown rendering

Functions involved:

- `renderMarkdown(container, text)`
- `plainTextFromMarkdownEl(element)`

Behavior:

- If `marked` and `DOMPurify` are available, markdown is parsed and sanitized
- Otherwise the app falls back to plain text
- Empty content gets a friendly empty state instead of a blank panel

#### Tabs

`showTab(name)` toggles:

- `.is-active` on tab buttons
- `hidden` on tab panels

This keeps the result view simple and fast without re-rendering the page structure.

#### Diff viewer

This is one of the more interesting pieces of the frontend.

Functions involved:

- `splitLines(text)`
- `diffLines(previousText, currentText)`
- `renderDiffView()`

How it works:

1. The code is normalized to Unix-style newlines
2. The old snippet and current editor content are split into arrays of lines
3. `diffLines` computes a line-level diff using a longest common subsequence dynamic programming table
4. The result is converted into operations:
   - `same`
   - `add`
   - `remove`
5. `renderDiffView` turns those operations into HTML rows with:
   - old line number
   - new line number
   - sign
   - escaped code text

Color meaning:

- Green rows are additions
- Red rows are removals
- Neutral rows are unchanged context

Important behavior detail:

- The diff baseline updates only after a successful analysis
- Clicking `Clear editor` empties the current editor and result tabs, but does not wipe the last analyzed baseline
- That means you can still compare your next draft against the most recent analyzed snippet

#### Editor-like keyboard behavior

Functions involved:

- `insertAtSelection(text)`
- `indentSelectedLines()`
- `outdentSelectedLines()`
- `handleEnterIndentation(event)`

Supported behavior:

- `Tab` inserts two spaces or indents selected lines
- `Shift+Tab` outdents selected lines
- `Enter` preserves the current indentation
- If the current line ends with `{`, `[`, `(`, or `:`, pressing `Enter` adds one extra indentation level
- `Ctrl+Enter` or `Cmd+Enter` triggers analysis

This gives a code-editor feel without adding a full editor dependency like Monaco or CodeMirror.

#### Copy section

`copyActiveSection()` copies the currently visible result panel as plain text using the Clipboard API.

#### Metadata fetch

`fetchMeta()` sends `GET /api/meta` on page load and updates the model badge if the backend returns a model name.

#### Main analysis request

`analyze()` is the browser-side orchestration function.

Step by step:

1. Read the raw editor contents
2. Trim it for validation
3. Show loading state
4. Send `POST /api/analyze`
5. Parse the JSON response
6. Handle HTTP or API errors
7. Render each output section into the correct panel
8. Hide the variants badge if the result is effectively `NO_VARIANTS`
9. Update the displayed model name if included in the response
10. Save the raw current code as the new diff baseline
11. Stamp the baseline with the current time
12. Re-render the diff card
13. Show success metadata
14. Switch back to the `Analysis` tab
15. On smaller screens, scroll the results panel into view

#### Event wiring

At the bottom of the file, the code wires up:

- Tab clicks
- Sample snippet clicks
- Editor input events
- Scroll syncing
- Keyboard shortcuts
- Analyze button
- Clear button
- Copy section button

Then it initializes the page with:

- `clearResults()`
- `updateInputStats()`
- `renderDiffView()`
- `fetchMeta()`

### 10. `frontend/static/css/styles.css`: visual system and layout

This file is the visual layer for the browser UI.

What it defines:

- Color tokens in `:root`
- Typography choices
- Light themed background treatment
- Hero layout
- Editor panel styling
- Diff row styling
- Tab styling
- Markdown content styling
- Responsive breakpoints
- Reduced-motion behavior

The CSS is intentionally component-oriented. The HTML assigns semantic containers such as:

- `.hero`
- `.panel`
- `.editor-shell`
- `.diff-card`
- `.tabs`
- `.markdown`

and the stylesheet gives each section its own visual identity.

A few notable details:

- The app uses a warm light theme instead of simply inverting a dark palette
- The line-number gutter and editor share aligned monospace spacing
- Diff rows use separate add and remove color treatments
- The results area is designed to handle long markdown responses with scrollable panels
- Media queries collapse the two-column layout into one column on smaller screens

### 11. `requirements.txt`

Dependencies:

- `groq`
- `python-dotenv`
- `fastapi`
- `uvicorn[standard]`
- `pydantic>=2`

Why each one is here:

- `groq` powers LLM API calls
- `python-dotenv` loads `.env`
- `fastapi` serves the API and frontend
- `uvicorn[standard]` runs the ASGI server
- `pydantic` validates API inputs and outputs

## End-to-end data flow in detail

This section traces one browser analysis request all the way through the code.

### Phase 1: app startup

1. You run `python run.py`
2. `run.py` frees port `8765`
3. `run.py` starts `uvicorn backend.app:app`
4. `backend.app` creates the FastAPI app and mounts routes
5. The browser opens `/`
6. FastAPI serves `frontend/index.html`
7. The browser downloads CSS and JavaScript from `/static`
8. The browser also downloads third-party markdown libraries from CDNs

### Phase 2: initial page initialization

1. `app.js` caches DOM nodes
2. It initializes local state
3. It fills empty result panels
4. It calculates line and character stats
5. It renders the initial empty diff state
6. It requests `/api/meta`
7. The backend returns the configured model name
8. The model badge in the UI updates

### Phase 3: user submits code

1. The user types or pastes code into the textarea
2. Input events keep stats and the diff card live
3. The user clicks `Analyze` or presses `Ctrl+Enter`
4. `analyze()` sends `POST /api/analyze`

### Phase 4: backend pipeline execution

1. FastAPI validates the JSON body using `AnalyzeRequest`
2. `analyze()` in `backend/app.py` calls `run_pipeline(req.code)`
3. `run_pipeline` trims the code
4. `build_analysis_prompt` constructs the stage 1 prompt
5. `call_groq` sends stage 1 to Groq
6. `build_explanation_improver_prompt` constructs the stage 2 prompt from stage 1 output
7. `call_groq` sends stage 2 to Groq
8. `build_fixes_variants_complexity_prompt` constructs the stage 3 prompt
9. `call_groq` sends stage 3 to Groq
10. `extract_stage_three_field` parses fixes
11. `extract_stage_three_field` parses variants
12. `extract_stage_three_field` parses complexity
13. `run_pipeline` returns a dictionary
14. FastAPI wraps it in `AnalyzeResponse`
15. The response JSON goes back to the browser

### Phase 5: frontend rendering

1. `app.js` reads the JSON
2. Each section is rendered into the appropriate result panel
3. The variants badge is shown only if variants actually exist
4. The model badge is refreshed if the response includes `model`
5. The exact submitted code becomes the new diff baseline
6. The diff card recalculates against any future edits
7. The UI returns to the `Analysis` tab

## API reference

### `GET /`

Returns the main HTML page.

### `GET /api/meta`

Example response:

```json
{
  "app_name": "Code Explainer",
  "version": "1.0.0",
  "model": "openai/gpt-oss-120b"
}
```

### `POST /api/analyze`

Request body:

```json
{
  "code": "for i in range(5):\n    print(i)"
}
```

Successful response shape:

```json
{
  "analysis_output": "...",
  "readable_explanation": "...",
  "fixes_and_optimization": "...",
  "code_variants": "...",
  "complexity_analysis": "...",
  "model": "openai/gpt-oss-120b",
  "error": null
}
```

Possible failure behaviors:

- Validation errors return FastAPI's normal 422 response
- Internal pipeline failures are converted to HTTP 500
- Missing API key raises a backend error with a helpful message

## Design choices and tradeoffs

### Why a 3-stage pipeline instead of one prompt

Benefits:

- Stage 1 focuses on understanding
- Stage 2 focuses on clarity
- Stage 3 focuses on fixes and structured outputs

Tradeoff:

- It costs more latency than a single call

### Why stage 3 uses explicit markdown headings

Benefits:

- Easier to parse reliably
- Easier to map onto UI tabs

Tradeoff:

- The prompt is stricter and depends on the model following instructions well

### Why the frontend uses a textarea instead of a full editor dependency

Benefits:

- Fewer dependencies
- Simpler startup
- Smaller codebase

Tradeoff:

- No true syntax highlighting
- No AST-aware editing features

### Why the diff baseline updates after analysis, not after every keystroke

Benefits:

- The diff reflects the last submitted version, not just the last typed version
- This makes it useful for iterative prompt-and-fix workflows

Tradeoff:

- The baseline is session-local and not persisted anywhere

## Limitations

- The backend makes three sequential LLM calls, so larger requests can feel slow
- The app depends on a valid Groq API key
- The frontend loads some assets from CDNs, so a fully offline browser experience is not guaranteed
- The diff is line-based, not token-based
- The parser assumes stage 3 follows the requested heading format
- The editor is textarea-based, so it is editor-like but not a full IDE component

## Good places to modify the app

If you want to change specific behavior, these are the main files to touch:

- Change the model or client behavior: `backend/llm_client.py`
- Change prompt wording: `backend/prompt_builder.py`
- Change pipeline order or parsing: `backend/pipeline.py`
- Change API contract: `backend/app.py`
- Change CLI behavior: `backend/main.py`
- Change UI structure: `frontend/index.html`
- Change UI logic: `frontend/static/js/app.js`
- Change UI appearance: `frontend/static/css/styles.css`
- Change web startup behavior: `run.py`

## Quick mental model

If you only remember one thing about the codebase, remember this:

- `run.py` starts the web app
- `backend/app.py` defines routes
- `backend/pipeline.py` runs the 3-stage analysis
- `backend/prompt_builder.py` defines what each stage asks for
- `backend/llm_client.py` talks to Groq
- `frontend/static/js/app.js` turns API responses into the interactive UI

That is the core loop of the project.
