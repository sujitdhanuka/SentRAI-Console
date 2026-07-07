"""
Static codebase discovery scanner.

Walks a directory tree and flags files that *appear* to implement an AI/ML/
LLM-driven decision system, based on regex signal matching — not a full
language-aware AST analysis. This is intentionally a heuristic first pass:
it surfaces candidates and obvious governance gaps for a human reviewer to
confirm and complete, the same way a static-analysis security scanner
surfaces findings rather than guaranteeing correctness.

Explicitly out of scope (by design, not oversight):
  - Cross-file call-graph tracing (e.g. following an import to its definition)
  - Distinguishing a live production model from disabled/test/example code
  - Verifying claims found in comments or docstrings
  - Non-text or binary model artifacts (pickled models, ONNX, GGUF, etc.)
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from sentrai.domain.enums import ModelType, RiskLevel
from sentrai.discovery.tree_sitter_parser import scan_python, scan_javascript, scan_typescript, scan_go

# Directories never worth descending into — build output, deps, VCS internals.
SKIP_DIRS = {
    "node_modules", ".git", ".next", "dist", "build", "__pycache__",
    ".venv", "venv", ".turbo", "coverage", ".pytest_cache", ".mypy_cache",
    "target", ".idea", ".vscode",
}

SCANNABLE_EXTENSIONS = {".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".java", ".rb"}

MAX_FILE_SIZE_BYTES = 1_500_000   # skip generated/minified/vendored mega-files
MAX_FILES_SCANNED = 5000          # circuit breaker against pathological trees


@dataclass(frozen=True)
class SignalMatch:
    category: str
    pattern: str
    line_number: int
    snippet: str


@dataclass
class DiscoveredModelCandidate:
    suggested_name: str
    file_path: str
    model_type_guess: ModelType
    functional_area_guess: str
    risk_hint: RiskLevel
    confidence: str                 # "HIGH" | "MEDIUM" | "LOW"
    domain_tags: list[str] = field(default_factory=list)
    signals: list[SignalMatch] = field(default_factory=list)
    gaps: list[str] = field(default_factory=list)
    description: str = ""
    prompts: list[dict] = field(default_factory=list)
    secrets: list[dict] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "suggested_name": self.suggested_name,
            "file_path": self.file_path,
            "model_type_guess": self.model_type_guess.value,
            "functional_area_guess": self.functional_area_guess,
            "risk_hint": self.risk_hint.value,
            "confidence": self.confidence,
            "domain_tags": self.domain_tags,
            "description": self.description,
            "prompts": self.prompts,
            "secrets": self.secrets,
            "signals": [
                {"category": s.category, "pattern": s.pattern, "line": s.line_number, "snippet": s.snippet}
                for s in self.signals
            ],
            "gaps": self.gaps,
        }


# ── Signal patterns, grouped by category ─────────────────────────────────────
# Each tuple: (category, compiled regex, base confidence weight)
_LLM_PATTERNS = [
    ("llm_api_call", re.compile(r"\bopenai\.|\banthropic\.|chat\.completions|\.messages\.create\(", re.I), 3),
    ("llm_model_string", re.compile(r"['\"`](gpt-4|gpt-3\.5|claude-|gemini-|llama-|mistral-)[\w.\-]*['\"`]", re.I), 3),
    ("llm_sdk_import", re.compile(r"from\s+['\"]openai['\"]|from\s+['\"]@anthropic-ai|import\s+openai|import\s+anthropic", re.I), 3),
]
_ML_PATTERNS = [
    ("ml_library_import", re.compile(r"\b(sklearn|tensorflow|torch|xgboost|lightgbm|keras)\b", re.I), 3),
    ("ml_inference_call", re.compile(r"\.predict\(|\.fit\(|model\.eval\(\)", re.I), 2),
]
_AGENT_PATTERNS = [
    ("agent_definition", re.compile(r"\b(class|function|const)\s+\w*(Agent|Swarm|Persona)\w*", re.I), 2),
    ("agent_keyword", re.compile(r"\bSwarm\b|\bmulti-agent\b|\bAI\s+agent\b", re.I), 1),
    ("mcp_server", re.compile(r"\bmcp\b|modelcontextprotocol|FastMCP", re.I), 2),
    ("ai_tool", re.compile(r"@tool|\b(class|function|const)\s+\w*(Tool)\w*|langchain\.tools", re.I), 2),
]
_SCORING_PATTERNS = [
    ("scoring_logic", re.compile(r"\b(riskScore|signalScore|tripleScreen|swingTrader|momentumScore|generateSignal)\b", re.I), 1),
    ("decision_function", re.compile(
        r"\b(function|const|def)\s+\w*(Score|Scoring|Risk|Credit|Underwrit|Approv|Decision|Eligib)\w*\s*[=(]", re.I
    ), 1),
]

ALL_PATTERN_GROUPS = _LLM_PATTERNS + _ML_PATTERNS + _AGENT_PATTERNS + _SCORING_PATTERNS

# Domain/category tags shown alongside model_type — answers "what kind of
# AI is this", separate from "what architecture is it" (GenAI/ML/RulesBased).
# A file can carry multiple tags (e.g. a GenAI model used for Quant research).
_DOMAIN_TAG_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("GenAI / LLM", re.compile(r"\bopenai\.|\banthropic\.|chat\.completions|gpt-4|gpt-3\.5|claude-|gemini-|llama-|prompt|\bllm\b", re.I)),
    ("Machine Learning", re.compile(r"\b(sklearn|tensorflow|torch|xgboost|lightgbm|keras|\.predict\(|\.fit\()\b", re.I)),
    ("Quant / Trading", re.compile(
        r"\bquant|backtest|sharpe|volatility|black.?scholes|monte.?carlo|momentum|swing.?trad|"
        r"\btechnical[_-]?indicator|\brsi\b|\bmacd\b|bollinger|triple.?screen|option.?pricing|alpha\b|hedge\b", re.I
    )),
    ("FinTech / Banking", re.compile(r"\bbank|credit|loan|kyc|\baml\b|payment|\bupi\b|underwrit|ledger\b", re.I)),
    ("Fraud / Risk", re.compile(r"\bfraud|anomaly|riskscore|risk[_-]?engine|chargeback", re.I)),
    ("Portfolio / Wealth", re.compile(r"\bportfolio|wealth|asset.?alloc|rebalanc|diversif", re.I)),
    ("Research / NLP", re.compile(r"\bresearch|sentiment|summar|nlp\b|institutional|analyst\b", re.I)),
    ("Agent / Orchestration", re.compile(r"\bagent\b|\bswarm\b|workflow|\brouter\b|persona\b|multi-agent", re.I)),
]


def _classify_domain(content: str, rel_path: str) -> list[str]:
    haystack = f"{rel_path}\n{content}"
    return [tag for tag, pattern in _DOMAIN_TAG_PATTERNS if pattern.search(haystack)]


# Heuristics for guessing a functional area from path components.
_FUNCTIONAL_AREA_HINTS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"credit|underwrit|loan", re.I), "credit_underwriting"),
    (re.compile(r"chat|conversation|assistant", re.I), "customer_chatbot"),
    (re.compile(r"report|briefing|summar", re.I), "report_generation"),
    (re.compile(r"trade|trading|signal|swing|momentum|screen|mcx|fo[_-]?dashboard", re.I), "trading_signal_generation"),
    (re.compile(r"fraud|anomaly", re.I), "fraud_detection"),
    (re.compile(r"portfolio", re.I), "portfolio_analysis"),
    (re.compile(r"research|analyst|persona|institutional", re.I), "investment_research"),
    (re.compile(r"swarm|router|workflow|self[_-]?improv", re.I), "autonomous_agent_orchestration"),
]

# Keywords whose *absence* in a file imply a likely governance gap.
_GAP_KEYWORD_CHECKS: list[tuple[str, re.Pattern, str]] = [
    ("human_oversight", re.compile(r"human[_-]?(review|approval|confirm|in[_-]?the[_-]?loop)|requireConfirm", re.I),
     "No human-in-the-loop or confirmation step detected near this code — verify Sutra 2 (People First) is satisfied."),
    ("explainability", re.compile(r"rationale|explain|reasoning|confidence\s*score|justif", re.I),
     "No explanation/rationale output detected — required for Sutra 6 (Understandable by Design) if this drives a recommendation."),
    ("risk_label", re.compile(r"riskLevel|risk_level|RiskLevel|LOW.?RISK|HIGH.?RISK", re.I),
     "No risk classification found in code — assign Low/Medium/High before production use (Sutra 3 / REC 14)."),
    ("fairness_check", re.compile(r"bias|fairness|demographic.?parity|disparate", re.I),
     "No bias/fairness check reference found — required for Sutra 4 (Fairness & Equity) on customer-facing models."),
    ("monitoring", re.compile(r"drift|monitor|circuit.?breaker|fallback", re.I),
     "No drift-monitoring or fallback reference found — required for Sutra 7 (Safety & Resilience) on production models."),
]

# Always-true gaps for any discovered candidate, since static scanning cannot
# verify organizational facts (these only exist in your AI policy / org chart).
_ALWAYS_FLAGGED_GAPS = [
    "No board-approved AI policy reference found in code — required for Sutra 1 (Trust) / REC 14.",
    "No owning team assigned — required for Sutra 5 (Accountability) before this can move out of DESIGN stage.",
]


import os

def _iter_source_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for dirpath_str, dirnames, filenames in os.walk(root):
        if len(files) >= MAX_FILES_SCANNED:
            break
        
        # Prune SKIP_DIRS in-place so os.walk doesn't descend into them
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        
        dirpath = Path(dirpath_str)
        for filename in filenames:
            if len(files) >= MAX_FILES_SCANNED:
                break
            
            path = dirpath / filename
            if path.suffix not in SCANNABLE_EXTENSIONS:
                continue
            try:
                if path.stat().st_size > MAX_FILE_SIZE_BYTES:
                    continue
            except OSError:
                continue
            files.append(path)
    return files


def _guess_functional_area(rel_path: str) -> str:
    for pattern, area in _FUNCTIONAL_AREA_HINTS:
        if pattern.search(rel_path):
            return area
    return "unclassified"


def _guess_name(rel_path: Path) -> str:
    stem = rel_path.stem
    # camelCase / snake_case -> Title Case words
    words = re.findall(r"[A-Z][a-z]*|[a-z]+|\d+", stem)
    return " ".join(w.capitalize() for w in words) or stem


def _assess_gaps(content: str, has_llm_or_ml: bool, has_agent: bool) -> list[str]:
    gaps = list(_ALWAYS_FLAGGED_GAPS)
    for _key, pattern, gap_message in _GAP_KEYWORD_CHECKS:
        if not pattern.search(content):
            gaps.append(gap_message)
    return gaps


def _extract_description(content: str) -> str:
    # 1. Try to extract Python docstring
    docstring_match = re.search(r'^\s*(?:"""(.*?)"""|\'\'\'(.*?)\'\'\')', content, re.DOTALL)
    if docstring_match:
        doc = docstring_match.group(1) or docstring_match.group(2)
        if doc:
            lines = [line.strip() for line in doc.splitlines() if line.strip()]
            if lines:
                return " ".join(lines)[:300]

    # 2. Try to extract JS/Go/Python comment block at the beginning
    lines = content.splitlines()
    desc_lines = []
    in_block_comment = False
    for line in lines[:30]:  # scan first 30 lines
        line_strip = line.strip()
        if not line_strip:
            if desc_lines:
                break
            continue
            
        if line_strip.startswith("/*"):
            in_block_comment = True
            comment_content = line_strip[2:].strip()
            if comment_content:
                desc_lines.append(comment_content)
            if "*/" in line_strip:
                in_block_comment = False
            continue
        elif in_block_comment:
            if "*/" in line_strip:
                in_block_comment = False
                comment_content = line_strip.split("*/")[0].strip()
            else:
                comment_content = line_strip.strip()
            if comment_content:
                desc_lines.append(comment_content)
            continue
            
        if line_strip.startswith("//"):
            desc_lines.append(line_strip[2:].strip())
        elif line_strip.startswith("#"):
            desc_lines.append(line_strip[1:].strip())
        else:
            break

    if desc_lines:
        return " ".join(desc_lines)[:300]
        
    return ""


def _scan_prompts_and_security(content: str) -> tuple[list[dict], list[dict]]:
    prompts = []
    secrets = []
    
    prompt_var_pattern = re.compile(
        r'(?:prompt|template|instruction|system_prompt|user_prompt|system_message)\s*=\s*(?:f?["\'`]{3}(.*?)["\'`]{3}|f?["\'`](.*?)["\'`])',
        re.DOTALL | re.IGNORECASE
    )
    for m in prompt_var_pattern.finditer(content):
        val = m.group(1) or m.group(2)
        if val and len(val.strip()) > 10:
            prompt_text = val.strip()
            has_injection_risk = ("{user" in prompt_text.lower() or "{input" in prompt_text.lower() or "{query" in prompt_text.lower()) and "sanitize" not in content.lower()
            
            has_pii = False
            pii_categories = []
            if re.search(r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+', prompt_text):
                has_pii = True
                pii_categories.append("Email Address")
            if re.search(r'\b\d{3}-\d{2}-\d{4}\b', prompt_text):
                has_pii = True
                pii_categories.append("Social Security Number (SSN)")
                
            prompts.append({
                "raw_text": prompt_text[:300] + ("..." if len(prompt_text) > 300 else ""),
                "prompt_type": "System Prompt" if "you are a" in prompt_text.lower() or "system" in m.group(0).lower() else "User Prompt",
                "injection_risk": "HIGH" if has_injection_risk else "LOW",
                "pii_detected": pii_categories
            })
            
    secret_patterns = {
        "AWS Access Key": re.compile(r'\b(AKIA[A-Z0-9]{16})\b'),
        "Bearer API Token": re.compile(r'\b(bearer\s+[a-zA-Z0-9_\-\.]{15,})\b', re.IGNORECASE),
        "Generic Secret Key": re.compile(r'\b(api[_-]?key|secret[_-]?key|password|db[_-]?pass)\s*=\s*["\'`]([a-zA-Z0-9_\-\.]{8,})["\'`]\b', re.IGNORECASE)
    }
    
    for name, pattern in secret_patterns.items():
        for m in pattern.finditer(content):
            line_no = content.count("\n", 0, m.start()) + 1
            secret_val = m.group(1) if len(m.groups()) == 1 else m.group(2)
            masked = secret_val[:4] + "********" + secret_val[-4:] if len(secret_val) > 8 else "********"
            secrets.append({
                "type": name,
                "masked_value": masked,
                "line": line_no
            })
            
    return prompts, secrets


def _ast_scan_python(content: str) -> tuple[set[str], list[str]]:
    return scan_python(content)

def _ast_scan_js_ts(content: str, suffix: str) -> tuple[set[str], list[str]]:
    if suffix in (".ts", ".tsx"):
        return scan_typescript(content)
    return scan_javascript(content)


def scan_directory(root: str | Path) -> list[DiscoveredModelCandidate]:
    """
    Scans `root` for files matching AI/ML/LLM signal patterns and returns
    one candidate per matching file, each with a risk hint, a functional-area
    guess, and a static gap report relative to the 7 Sutras / SentrAI
    recommendations.
    """
    root = Path(root).expanduser().resolve()
    if not root.is_dir():
        raise NotADirectoryError(f"{root} is not a directory or does not exist")

    candidates: list[DiscoveredModelCandidate] = []

    for file_path in _iter_source_files(root):
        try:
            content = file_path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue

        lines = content.splitlines()
        matches: list[SignalMatch] = []
        weight = 0
        has_llm = False
        has_ml = False
        has_agent = False
        ast_gaps = []

        fast_keywords = ["openai", "anthropic", "langchain", "torch", "sklearn", "xgboost", "tensorflow", "onnx", "google", "gemini", "genai"]
        needs_ast = any(kw in content.lower() for kw in fast_keywords)

        if needs_ast:
            if file_path.suffix == ".py":
                detected_libs, ast_gaps = _ast_scan_python(content)
                if "openai" in detected_libs or "anthropic" in detected_libs or "google" in detected_libs:
                    has_llm = True
                    weight += 5
                if "torch" in detected_libs or "sklearn" in detected_libs or "xgboost" in detected_libs:
                    has_ml = True
                    weight += 5
                if "langchain" in detected_libs:
                    has_agent = True
                    weight += 5
            elif file_path.suffix in (".js", ".jsx", ".ts", ".tsx"):
                detected_libs, ast_gaps = _ast_scan_js_ts(content, file_path.suffix)
                if "openai" in detected_libs or "anthropic" in detected_libs or "google-generativeai" in detected_libs:
                    has_llm = True
                    weight += 5
                if "tensorflow" in detected_libs or "onnxruntime" in detected_libs:
                    has_ml = True
                    weight += 5
                if "langchain" in detected_libs:
                    has_agent = True
                    weight += 5
            elif file_path.suffix == ".go":
                detected_libs, ast_gaps = scan_go(content)
                if "go-openai" in detected_libs or "anthropic-go" in detected_libs or "genai" in detected_libs:
                    has_llm = True
                    weight += 5
                if "langchain-go" in detected_libs:
                    has_agent = True
                    weight += 5

        for category, pattern, base_weight in ALL_PATTERN_GROUPS:
            for m in pattern.finditer(content):
                line_no = content.count("\n", 0, m.start()) + 1
                snippet = lines[line_no - 1].strip()[:140] if line_no - 1 < len(lines) else ""
                matches.append(SignalMatch(category=category, pattern=m.group(0), line_number=line_no, snippet=snippet))
                weight += base_weight
                if category.startswith("llm_"):
                    has_llm = True
                if category.startswith("ml_"):
                    has_ml = True
                if category.startswith("agent_"):
                    has_agent = True

        if not matches and not ast_gaps:
            continue

        rel_path = file_path.relative_to(root)

        has_mcp = any(m.category == "mcp_server" for m in matches)
        has_tool = any(m.category == "ai_tool" for m in matches)
        
        if has_mcp:
            model_type = ModelType.MCP_SERVER
        elif has_agent:
            model_type = ModelType.AGENT
        elif has_tool:
            model_type = ModelType.TOOL
        elif has_llm:
            model_type = ModelType.GENERATIVE_AI
        elif has_ml:
            model_type = ModelType.MACHINE_LEARNING
        else:
            model_type = ModelType.RULES_BASED

        functional_area = _guess_functional_area(str(rel_path))

        if functional_area in ("credit_underwriting", "fraud_detection", "trading_signal_generation") and (has_llm or has_agent):
            risk_hint = RiskLevel.HIGH
        elif has_llm or has_ml or functional_area == "customer_chatbot":
            risk_hint = RiskLevel.MEDIUM
        else:
            risk_hint = RiskLevel.LOW

        confidence = "HIGH" if weight >= 5 else "MEDIUM" if weight >= 2 else "LOW"

        prompts_found, secrets_found = _scan_prompts_and_security(content)
        candidates.append(DiscoveredModelCandidate(
            suggested_name=_guess_name(rel_path),
            file_path=str(rel_path),
            model_type_guess=model_type,
            functional_area_guess=functional_area,
            risk_hint=risk_hint,
            confidence=confidence,
            domain_tags=_classify_domain(content, str(rel_path)),
            signals=matches[:10],   # cap per-file signal list for readability
            gaps=_assess_gaps(content, has_llm or has_ml, has_agent) + ast_gaps,
            description=_extract_description(content),
            prompts=prompts_found,
            secrets=secrets_found,
        ))

    # Highest-confidence, highest-risk candidates first.
    risk_order = {RiskLevel.HIGH: 0, RiskLevel.MEDIUM: 1, RiskLevel.LOW: 2}
    confidence_order = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}
    candidates.sort(key=lambda c: (risk_order[c.risk_hint], confidence_order[c.confidence]))
    return candidates
