from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from sentrai.domain.enums import RiskLevel, ModelType
from sentrai.domain.model_inventory import AIModelEntry

@dataclass
class FrameworkCheck:
    control_code: str
    name: str
    passed: bool
    evidence: str
    gap: str = ""
    mandatory: bool = True

@dataclass
class FrameworkComplianceReport:
    framework_name: str
    model_id: Any
    model_name: str
    checks: list[FrameworkCheck] = field(default_factory=list)
    risk_tier: str = "Minimal"

    @property
    def overall_pass(self) -> bool:
        mandatory_failed = [c for c in self.checks if c.mandatory and not c.passed]
        return len(mandatory_failed) == 0

    @property
    def blocking_gaps(self) -> list[str]:
        return [c.gap for c in self.checks if c.mandatory and not c.passed and c.gap]

    def as_dict(self) -> dict:
        return {
            "framework_name": self.framework_name,
            "model_id": str(self.model_id),
            "model_name": self.model_name,
            "risk_tier": self.risk_tier,
            "overall_pass": self.overall_pass,
            "blocking_gaps": self.blocking_gaps,
            "checks": [
                {
                    "control_code": c.control_code,
                    "name": c.name,
                    "passed": c.passed,
                    "evidence": c.evidence,
                    "gap": c.gap,
                    "mandatory": c.mandatory,
                }
                for c in self.checks
            ],
        }

def validate_nist_rmf(entry: AIModelEntry) -> FrameworkComplianceReport:
    checks = []
    
    # 1. Govern (GV-1.1): Clear ownership assigned
    owner_str = entry.owner_team or ""
    has_owner = bool(owner_str) and "unassigned" not in owner_str.lower()
    checks.append(FrameworkCheck(
        control_code="GOVERN-1.1",
        name="Organizational Ownership & Responsibility",
        passed=bool(has_owner),
        evidence=f"Owner team: {entry.owner_team}" if has_owner else "No owner team assigned",
        gap="Organizational governance requires a designated owner team."
    ))

    # 2. Map (MAP-1.1): Board approved policy mapping
    has_policy = bool(entry.board_policy_ref and entry.board_policy_ref.strip())
    checks.append(FrameworkCheck(
        control_code="MAP-1.1",
        name="Board Policy Alignment",
        passed=has_policy,
        evidence=f"Board policy reference: {entry.board_policy_ref}" if has_policy else "No board policy reference provided",
        gap="Model context must align with a board-approved AI policy reference."
    ))

    # 3. Measure (MEASURE-2.1): Regular Red Teaming / Assessment
    has_red_team = False
    evidence_rt = "No red teaming date recorded"
    if entry.last_red_team_date:
        days_since = (datetime.now(timezone.utc) - entry.last_red_team_date).days
        if days_since < 365:
            has_red_team = True
            evidence_rt = f"Last red teamed {days_since} days ago ({entry.last_red_team_date.strftime('%Y-%m-%d')})"
        else:
            evidence_rt = f"Red teaming stale: last performed {days_since} days ago"
            
    checks.append(FrameworkCheck(
        control_code="MEASURE-2.1",
        name="Security Red Teaming & Bias Auditing",
        passed=has_red_team,
        evidence=evidence_rt,
        gap="Measure stage requires a bias audit / red teaming review within the last 12 months."
    ))

    # 4. Manage (MANAGE-1.1): Risk mitigation/Human oversight
    has_oversight = not (entry.risk_level == RiskLevel.HIGH and not entry.human_oversight_required)
    checks.append(FrameworkCheck(
        control_code="MANAGE-1.1",
        name="Human Oversight Controls",
        passed=has_oversight,
        evidence="High risk model has human-in-the-loop oversight enabled" if entry.human_oversight_required else "No oversight controls required (Low/Medium risk)",
        gap="High-risk decisions require a human-in-the-loop oversight control."
    ))

    return FrameworkComplianceReport(
        framework_name="NIST AI RMF",
        model_id=entry.model_id,
        model_name=entry.name,
        checks=checks
    )

def validate_eu_ai_act(entry: AIModelEntry) -> FrameworkComplianceReport:
    checks = []
    
    # Risk Tier Classification based on functional area and model type
    fa = (entry.functional_area or "").lower()
    is_high_risk_domain = fa in ("credit_underwriting", "loan_decisioning", "fund_movement")
    
    if is_high_risk_domain:
        risk_tier = "High Risk"
    elif entry.model_type == ModelType.GENERATIVE_AI or "chatbot" in fa:
        risk_tier = "Limited Risk"
    else:
        risk_tier = "Minimal Risk"

    # Requirements for High Risk
    if risk_tier == "High Risk":
        # 1. Detailed Logging & Documentation (Article 12)
        has_source = bool(entry.source_ref)
        checks.append(FrameworkCheck(
            control_code="Art-12",
            name="Traceability & Technical Documentation",
            passed=has_source,
            evidence=f"Source codebase ref: {entry.source_ref}" if has_source else "Missing repository codebase reference",
            gap="High-risk AI systems must have complete source file traceability."
        ))

        # 2. Human Oversight (Article 14)
        checks.append(FrameworkCheck(
            control_code="Art-14",
            name="Human Oversight Gate",
            passed=entry.human_oversight_required,
            evidence="Human-in-the-loop is active" if entry.human_oversight_required else "Oversight deactivated",
            gap="High-risk systems require explicit human-in-the-loop oversight gates."
        ))
    
    # Requirements for Limited Risk (Transparency, Article 52)
    elif risk_tier == "Limited Risk":
        desc_str = entry.use_case_description or ""
        has_desc = len(desc_str) > 10
        checks.append(FrameworkCheck(
            control_code="Art-52",
            name="Transparency & Disclosure",
            passed=has_desc,
            evidence=f"Use case transparency text: {desc_str[:100]}..." if has_desc else "No transparency statement",
            gap="Limited risk systems must provide clear use case descriptions for user transparency."
        ))
    
    else:
        # Minimal Risk checks
        checks.append(FrameworkCheck(
            control_code="Art-Minimal",
            name="General Compliance Guidelines",
            passed=True,
            evidence="Minimal risk model. Complies by default.",
            gap=""
        ))

    return FrameworkComplianceReport(
        framework_name="EU AI Act",
        model_id=entry.model_id,
        model_name=entry.name,
        checks=checks,
        risk_tier=risk_tier
    )

def validate_iso_42001(entry: AIModelEntry) -> FrameworkComplianceReport:
    checks = []

    # 1. Clause 6.1.2: AI Risk Assessment
    has_risk = entry.risk_level in (RiskLevel.LOW, RiskLevel.MEDIUM, RiskLevel.HIGH)
    checks.append(FrameworkCheck(
        control_code="AIMS-6.1.2",
        name="AI System Risk Assessment",
        passed=has_risk,
        evidence=f"System evaluated risk tier: {entry.risk_level.value}" if has_risk else "Risk level unclassified",
        gap="ISO 42001 requires systematic risk classification for each AI system."
    ))

    # 2. Clause 8.2: AI System Impact Assessment
    has_impact = bool(entry.use_case_description and len(entry.use_case_description) > 10)
    checks.append(FrameworkCheck(
        control_code="AIMS-8.2",
        name="AI System Impact Assessment",
        passed=has_impact,
        evidence=f"Impact assessment description provided ({len(entry.use_case_description or '')} chars)" if has_impact else "No impact description recorded",
        gap="Clause 8.2 requires documented AI system impact assessments."
    ))

    # 3. Clause 8.3: Data Governance for AI
    has_data_gov = bool(entry.source_ref or entry.dependencies)
    checks.append(FrameworkCheck(
        control_code="AIMS-8.3",
        name="Data & Codebase Governance",
        passed=has_data_gov,
        evidence=f"Source/data references tracked: {entry.source_ref or 'Dependencies list'}" if has_data_gov else "No codebase or data dependencies registered",
        gap="AIMS Data Governance requires tracking source repository or third-party dependencies."
    ))

    return FrameworkComplianceReport(
        framework_name="ISO 42001",
        model_id=entry.model_id,
        model_name=entry.name,
        checks=checks
    )
