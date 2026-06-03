(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);

  const editorSamples = {
    javascript: `function summarizeOrders(orders) {
  return orders
    .filter((order) => order.status === "paid")
    .reduce((total, order) => total + order.amount, 0);
}`,
    python: `def longest_streak(values):
    best = 0
    current = 0

    for value in values:
        if value:
            current += 1
            best = max(best, current)
        else:
            current = 0

    return best`,
    sql: `SELECT customer_id,
       COUNT(*) AS orders_count,
       SUM(total_amount) AS total_spent
FROM orders
WHERE status = 'paid'
GROUP BY customer_id
ORDER BY total_spent DESC;`,
  };

  const els = {
    code: $("#code-input"),
    lineGutter: $("#line-gutter"),
    lineCount: $("#line-count"),
    charCount: $("#char-count"),
    analyze: $("#analyze-btn"),
    clear: $("#clear-btn"),
    copySection: $("#copy-section-btn"),
    status: $("#status"),
    resultsMeta: $("#results-meta"),
    variantsBadge: $("#variants-badge"),
    heroModel: $("#hero-model"),
    diffOutput: $("#diff-output"),
    diffMeta: $("#diff-meta"),
    btnLabel: $("#analyze-btn .btn-label"),
    btnSpinner: $("#analyze-btn .btn-spinner"),
    tabs: document.querySelectorAll(".tab"),
    sampleChips: document.querySelectorAll(".sample-chip"),
    resultsPanel: $(".results-panel"),
    panels: {
      analysis: $("#out-analysis"),
      readable: $("#out-readable"),
      fixes: $("#out-fixes"),
      variants: $("#out-variants"),
      complexity: $("#out-complexity"),
    },
    panelEls: document.querySelectorAll(".tab-panel"),
  };

  const state = {
    activeTab: "analysis",
    baselineCode: "",
    baselineTimeLabel: "",
    modelName: "openai/gpt-oss-120b",
  };

  function normalizeNewlines(text) {
    return String(text || "").replace(/\r\n/g, "\n");
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatLineWord(count, singular, plural) {
    return `${count} ${count === 1 ? singular : plural}`;
  }

  function getLineCount(text) {
    if (!text) return 1;
    return normalizeNewlines(text).split("\n").length;
  }

  function buildLineGutter(lineCount) {
    return Array.from({ length: lineCount }, (_, index) => String(index + 1)).join("\n");
  }

  function updateInputStats() {
    const value = els.code.value;
    const lineCount = getLineCount(value);
    els.lineCount.textContent = formatLineWord(lineCount, "line", "lines");
    els.charCount.textContent = formatLineWord(value.length, "char", "chars");
    els.lineGutter.textContent = buildLineGutter(lineCount);
  }

  function syncEditorScroll() {
    els.lineGutter.scrollTop = els.code.scrollTop;
  }

  function setModelLabel(modelName) {
    const model = String(modelName || "").trim();
    if (!model) return;
    state.modelName = model;
    if (els.heroModel) {
      els.heroModel.textContent = `Groq model: ${model}`;
    }
  }

  function currentTimeLabel() {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date());
  }

  function setStatus(message, tone) {
    els.status.textContent = message || "";
    els.status.classList.toggle("is-error", tone === "error");
    els.status.classList.toggle("is-success", tone === "success");
  }

  function setResultsMeta(text) {
    if (els.resultsMeta) {
      els.resultsMeta.textContent = text || "";
    }
  }

  function setLoading(loading) {
    els.analyze.disabled = loading;
    els.btnSpinner.hidden = !loading;
    els.btnLabel.textContent = loading ? "Analyzing..." : "Analyze";
  }

  function isNoVariantsPlaceholder(text) {
    if (!text || !String(text).trim()) return true;
    for (const line of String(text).split(/\r?\n/)) {
      const normalized = line
        .trim()
        .replace(/^[*_`#]+|[*_`#]+$/g, "")
        .toUpperCase()
        .replace(/[.:]+$/, "");
      if (!normalized) continue;
      return normalized === "NO_VARIANTS" || normalized.startsWith("NO_VARIANTS");
    }
    return false;
  }

  function renderMarkdown(container, text) {
    if (!text || !String(text).trim()) {
      container.innerHTML =
        '<p class="empty-state">No content for this section yet. Run another analysis whenever you want a fresh pass.</p>';
      return;
    }

    if (typeof marked === "undefined" || typeof DOMPurify === "undefined") {
      container.textContent = text;
      return;
    }

    const raw = marked.parse(text, { breaks: true });
    container.innerHTML = DOMPurify.sanitize(raw);
  }

  function plainTextFromMarkdownEl(element) {
    return element.innerText.replace(/\u00a0/g, " ").trim();
  }

  function showTab(name) {
    state.activeTab = name;

    els.tabs.forEach((tab) => {
      const active = tab.dataset.tab === name;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });

    const panelMap = {
      analysis: "panel-analysis",
      readable: "panel-readable",
      fixes: "panel-fixes",
      variants: "panel-variants",
      complexity: "panel-complexity",
    };

    els.panelEls.forEach((panel) => {
      const visible = panel.id === panelMap[name];
      panel.hidden = !visible;
      panel.classList.toggle("is-visible", visible);
    });
  }

  function clearResults() {
    Object.values(els.panels).forEach((panel) => {
      panel.innerHTML =
        '<p class="empty-state">Run an analysis to populate this panel. You can keep iterating on the same snippet and compare changes below.</p>';
    });

    if (els.variantsBadge) {
      els.variantsBadge.hidden = true;
    }

    setResultsMeta("Results land here after the model finishes all three passes.");
    showTab("analysis");
  }

  function splitLines(text) {
    const normalized = normalizeNewlines(text);
    return normalized ? normalized.split("\n") : [];
  }

  function diffLines(previousText, currentText) {
    const previousLines = splitLines(previousText);
    const currentLines = splitLines(currentText);
    const rows = Array.from({ length: previousLines.length + 1 }, () =>
      Array(currentLines.length + 1).fill(0),
    );

    for (let i = previousLines.length - 1; i >= 0; i -= 1) {
      for (let j = currentLines.length - 1; j >= 0; j -= 1) {
        rows[i][j] =
          previousLines[i] === currentLines[j]
            ? rows[i + 1][j + 1] + 1
            : Math.max(rows[i + 1][j], rows[i][j + 1]);
      }
    }

    const ops = [];
    let i = 0;
    let j = 0;

    while (i < previousLines.length && j < currentLines.length) {
      if (previousLines[i] === currentLines[j]) {
        ops.push({ type: "same", text: previousLines[i] });
        i += 1;
        j += 1;
      } else if (rows[i + 1][j] >= rows[i][j + 1]) {
        ops.push({ type: "remove", text: previousLines[i] });
        i += 1;
      } else {
        ops.push({ type: "add", text: currentLines[j] });
        j += 1;
      }
    }

    while (i < previousLines.length) {
      ops.push({ type: "remove", text: previousLines[i] });
      i += 1;
    }

    while (j < currentLines.length) {
      ops.push({ type: "add", text: currentLines[j] });
      j += 1;
    }

    return ops;
  }

  function renderDiffView() {
    const currentCode = normalizeNewlines(els.code.value);

    if (!state.baselineCode) {
      els.diffMeta.textContent = "Analyze a snippet once to create a baseline.";
      els.diffOutput.innerHTML =
        '<p class="diff-placeholder">Your next draft will be compared line-by-line against the previous analyzed code.</p>';
      return;
    }

    if (currentCode === state.baselineCode) {
      const baselineText = state.baselineTimeLabel
        ? `Baseline saved at ${state.baselineTimeLabel}. Start editing to see additions in green and removals in red.`
        : "Start editing to see additions in green and removals in red.";
      els.diffMeta.textContent = baselineText;
      els.diffOutput.innerHTML =
        '<p class="diff-placeholder">No changes yet. Edit the current snippet to generate a line-by-line diff.</p>';
      return;
    }

    const ops = diffLines(state.baselineCode, currentCode);
    let oldLine = 1;
    let newLine = 1;
    let added = 0;
    let removed = 0;

    const rows = ops.map((op) => {
      let oldNumber = "";
      let newNumber = "";
      let sign = " ";

      if (op.type === "same") {
        oldNumber = String(oldLine);
        newNumber = String(newLine);
        oldLine += 1;
        newLine += 1;
      } else if (op.type === "add") {
        newNumber = String(newLine);
        newLine += 1;
        sign = "+";
        added += 1;
      } else {
        oldNumber = String(oldLine);
        oldLine += 1;
        sign = "-";
        removed += 1;
      }

      const safeLine = escapeHtml(op.text || " ");
      return `
        <div class="diff-line is-${op.type}">
          <span class="diff-num">${oldNumber}</span>
          <span class="diff-num">${newNumber}</span>
          <span class="diff-sign">${sign}</span>
          <span class="diff-code">${safeLine || "&nbsp;"}</span>
        </div>
      `;
    });

    const baselineLabel = state.baselineTimeLabel ? ` from ${state.baselineTimeLabel}` : "";
    els.diffMeta.textContent = `${added} additions and ${removed} removals compared with the last analyzed snippet${baselineLabel}.`;
    els.diffOutput.innerHTML = `<div class="diff-grid">${rows.join("")}</div>`;
  }

  function loadSample(name) {
    const sample = editorSamples[name];
    if (!sample) return;
    els.code.value = sample;
    updateInputStats();
    renderDiffView();
    setStatus(`Loaded the ${name} sample.`, "success");
    els.code.focus();
  }

  function insertAtSelection(text) {
    const start = els.code.selectionStart;
    const end = els.code.selectionEnd;
    const value = els.code.value;
    els.code.value = `${value.slice(0, start)}${text}${value.slice(end)}`;
    els.code.selectionStart = els.code.selectionEnd = start + text.length;
  }

  function indentSelectedLines() {
    const value = els.code.value;
    const start = els.code.selectionStart;
    const end = els.code.selectionEnd;

    if (start === end) {
      insertAtSelection("  ");
      return;
    }

    const lineStart = value.lastIndexOf("\n", Math.max(start - 1, 0)) + 1;
    const selectedBlock = value.slice(lineStart, end);
    const lineCount = selectedBlock.split("\n").length;
    const indented = selectedBlock.replace(/^/gm, "  ");

    els.code.value = `${value.slice(0, lineStart)}${indented}${value.slice(end)}`;
    els.code.selectionStart = start + 2;
    els.code.selectionEnd = end + lineCount * 2;
  }

  function outdentSelectedLines() {
    const value = els.code.value;
    const start = els.code.selectionStart;
    const end = els.code.selectionEnd;
    const lineStart = value.lastIndexOf("\n", Math.max(start - 1, 0)) + 1;
    const selectedBlock = value.slice(lineStart, end);

    if (!selectedBlock) return;

    let removedCount = 0;
    const outdented = selectedBlock.replace(/^( {1,2}|\t)/gm, (match) => {
      removedCount += match.length;
      return "";
    });

    els.code.value = `${value.slice(0, lineStart)}${outdented}${value.slice(end)}`;
    els.code.selectionStart = Math.max(lineStart, start - 2);
    els.code.selectionEnd = Math.max(els.code.selectionStart, end - removedCount);
  }

  function handleEnterIndentation(event) {
    const start = els.code.selectionStart;
    const end = els.code.selectionEnd;
    const value = els.code.value;
    const lineStart = value.lastIndexOf("\n", Math.max(start - 1, 0)) + 1;
    const currentLine = value.slice(lineStart, start);
    const baseIndent = (currentLine.match(/^\s*/) || [""])[0];
    const trimmed = currentLine.trimEnd();
    const extraIndent = /[\{\[\(:]$/.test(trimmed) ? "  " : "";

    event.preventDefault();

    const insertion = `\n${baseIndent}${extraIndent}`;
    els.code.value = `${value.slice(0, start)}${insertion}${value.slice(end)}`;
    const cursor = start + insertion.length;
    els.code.selectionStart = els.code.selectionEnd = cursor;
  }

  async function copyActiveSection() {
    const panel = els.panels[state.activeTab];
    if (!panel) return;

    const text = plainTextFromMarkdownEl(panel);
    if (!text || text.startsWith("Run an analysis")) {
      setStatus("Nothing to copy in this tab yet.", "error");
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied the visible section.", "success");
    } catch (_error) {
      setStatus("Could not copy that section because clipboard access was blocked.", "error");
    }
  }

  async function fetchMeta() {
    try {
      const response = await fetch("/api/meta");
      if (!response.ok) return;
      const data = await response.json();
      if (data && typeof data.model === "string") {
        setModelLabel(data.model);
      }
    } catch (_error) {
      // Silent fallback: the page already has a default label.
    }
  }

  async function analyze() {
    const rawCode = els.code.value;
    const code = rawCode.trim();

    if (!code) {
      setStatus("Paste some code into the editor first.", "error");
      return;
    }

    setLoading(true);
    setStatus("Calling Groq across three stages. This can take a little while for larger snippets.", "");
    setResultsMeta("");

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const detail =
          data && typeof data.detail === "string"
            ? data.detail
            : data && data.detail && data.detail[0] && data.detail[0].msg
              ? data.detail[0].msg
              : response.statusText || "Request failed";
        throw new Error(detail);
      }

      if (data.error) {
        setStatus(data.error, "error");
        return;
      }

      renderMarkdown(els.panels.analysis, data.analysis_output);
      renderMarkdown(els.panels.readable, data.readable_explanation);
      renderMarkdown(els.panels.fixes, data.fixes_and_optimization);

      const variants = data.code_variants || "";
      if (isNoVariantsPlaceholder(variants)) {
        els.panels.variants.innerHTML =
          '<p class="empty-state">No alternate implementations were returned for this snippet. Try a larger example if you want rewrite options.</p>';
        if (els.variantsBadge) els.variantsBadge.hidden = true;
      } else {
        renderMarkdown(els.panels.variants, variants);
        if (els.variantsBadge) els.variantsBadge.hidden = false;
      }

      renderMarkdown(els.panels.complexity, data.complexity_analysis);

      if (data.model) {
        setModelLabel(data.model);
      }

      state.baselineCode = normalizeNewlines(rawCode);
      state.baselineTimeLabel = currentTimeLabel();
      renderDiffView();

      setStatus("Analysis ready.", "success");
      setResultsMeta(
        `${state.baselineTimeLabel} - ${state.modelName} - The variants tab lights up only when alternate implementations are returned.`,
      );
      showTab("analysis");

      if (window.matchMedia("(max-width: 1080px)").matches && els.resultsPanel) {
        els.resultsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (error) {
      setStatus(error.message || "Something went wrong while calling the API.", "error");
    } finally {
      setLoading(false);
    }
  }

  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => showTab(tab.dataset.tab));
  });

  els.sampleChips.forEach((chip) => {
    chip.addEventListener("click", () => loadSample(chip.dataset.sample));
  });

  els.code.addEventListener("input", () => {
    updateInputStats();
    renderDiffView();
  });

  els.code.addEventListener("scroll", syncEditorScroll);

  els.code.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      analyze();
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      if (event.shiftKey) {
        outdentSelectedLines();
      } else {
        indentSelectedLines();
      }
      updateInputStats();
      renderDiffView();
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      handleEnterIndentation(event);
      updateInputStats();
      renderDiffView();
    }
  });

  els.analyze.addEventListener("click", analyze);

  els.clear.addEventListener("click", () => {
    els.code.value = "";
    updateInputStats();
    renderDiffView();
    clearResults();
    setStatus("Editor cleared. Your previous analyzed snippet is still available as the diff baseline.", "");
    els.code.focus();
  });

  if (els.copySection) {
    els.copySection.addEventListener("click", copyActiveSection);
  }

  clearResults();
  updateInputStats();
  renderDiffView();
  fetchMeta();
})();
