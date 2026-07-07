"""
Codebase Discovery API — scans a local directory for AI/ML/LLM usage and
surfaces candidates + governance gaps that can be imported straight into
the Model Inventory (REC 23).

This complements, rather than replaces, manual registration: discovery
finds *candidates*; a human (or a follow-up review step) still confirms
risk level, ownership, and policy references before a model is treated
as fully governed.
"""

import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from sentrai.discovery.codebase_scanner import scan_directory
from sentrai.domain.enums import ModelLifecycleStage, ModelType, RiskLevel
from sentrai.domain.model_inventory import AIModelEntry, triage_ai_model
from sentrai.infrastructure.database import get_db
from sentrai.infrastructure.orm_models import AIModelORM, ModelLedgerEventORM, ProjectORM

router = APIRouter(prefix="/discovery", tags=["Codebase Discovery"])


async def _resolve_directory(db: AsyncSession, directory: str | None, project_id: uuid.UUID | None) -> tuple[str, ProjectORM | None]:
    """
    Either field can drive the scan: an explicit directory, or a project
    whose saved root_directory is used. If both are given, the explicit
    directory wins (lets you scan a subfolder without changing the project).
    """
    project: ProjectORM | None = None
    if project_id:
        project = await db.get(ProjectORM, project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
    if directory:
        return directory, project
    if project:
        return project.root_directory, project
    raise HTTPException(status_code=400, detail="Provide either a directory or a project_id")


class ScanRequest(BaseModel):
    directory: str | None = None
    project_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _require_one(self):
        if not self.directory and not self.project_id:
            raise ValueError("Provide either 'directory' or 'project_id'")
        return self


class DirectoryEntry(BaseModel):
    name: str
    path: str


class BrowseResponse(BaseModel):
    current_path: str
    parent_path: str | None
    directories: list[DirectoryEntry]


@router.get("/browse", response_model=BrowseResponse)
async def browse_directories(path: str | None = None) -> BrowseResponse:
    """
    Lists immediate subdirectories of `path` (defaults to the server process's
    home directory) so the UI can offer a click-to-navigate folder picker.

    Note: this reads the filesystem of the machine running this service, not
    the browser's filesystem — there is no way for a server to browse a
    client's local disk. Hidden directories (dotfiles) are omitted to keep
    the listing relevant for codebase navigation.
    """
    target = Path(path).expanduser().resolve() if path else Path.home()

    if not target.exists():
        raise HTTPException(status_code=404, detail=f"Path does not exist: {target}")
    if not target.is_dir():
        raise HTTPException(status_code=400, detail=f"Not a directory: {target}")

    try:
        entries = list(os.scandir(target))
    except PermissionError:
        raise HTTPException(status_code=403, detail=f"Permission denied: {target}")

    directories = sorted(
        (
            DirectoryEntry(name=e.name, path=str(target / e.name))
            for e in entries
            if e.is_dir(follow_symlinks=False) and not e.name.startswith(".")
        ),
        key=lambda d: d.name.lower(),
    )

    parent = target.parent
    parent_path = str(parent) if parent != target else None

    return BrowseResponse(current_path=str(target), parent_path=parent_path, directories=directories)


class ScanResponse(BaseModel):
    directory: str
    files_flagged: int
    candidates: list[dict]


class ImportRequest(BaseModel):
    directory: str | None = None
    project_id: uuid.UUID | None = None
    file_paths: list[str]            # which candidates (by file_path) to import
    owner_team: str = "UNASSIGNED — pending review"
    board_policy_ref: str = ""       # left blank intentionally surfaces as a gap
    overwrite: bool = False

    @model_validator(mode="after")
    def _require_one(self):
        if not self.directory and not self.project_id:
            raise ValueError("Provide either 'directory' or 'project_id'")
        return self


class ImportedModel(BaseModel):
    model_id: str
    name: str
    source_ref: str
    risk_level: RiskLevel
    remaining_gaps: list[str]


@router.post("/scan", response_model=ScanResponse)
async def scan_codebase(payload: ScanRequest, db: AsyncSession = Depends(get_db)) -> ScanResponse:
    """
    Static, read-only scan of a directory — either given explicitly or
    resolved from a project's saved root_directory. Does not execute any
    code in the target directory and does not write to the inventory —
    use /discovery/import to register selected candidates afterward.
    """
    directory, project = await _resolve_directory(db, payload.directory, payload.project_id)

    try:
        candidates = scan_directory(directory)
    except NotADirectoryError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except OSError as e:
        raise HTTPException(status_code=400, detail=f"Could not read directory: {e}")

    if project:
        project.last_scanned_at = datetime.now(timezone.utc)

    return ScanResponse(
        directory=directory,
        files_flagged=len(candidates),
        candidates=[c.as_dict() for c in candidates],
    )


@router.post("/import", response_model=list[ImportedModel])
async def import_candidates(
    payload: ImportRequest,
    db: AsyncSession = Depends(get_db),
) -> list[ImportedModel]:
    """
    Re-scans the directory (candidates are not persisted between calls) and
    registers the selected file_paths into the model inventory as DESIGN-stage
    entries with auto-triaged risk. Any field the scanner could not determine
    (owner, board policy, oversight posture) is left as an explicit gap for a
    human reviewer to close before the model can be promoted to DEPLOYED.
    If a project_id is given, every imported model is tagged to that project.
    """
    directory, project = await _resolve_directory(db, payload.directory, payload.project_id)

    try:
        candidates = scan_directory(directory)
    except (NotADirectoryError, OSError) as e:
        raise HTTPException(status_code=400, detail=str(e))

    wanted = set(payload.file_paths)
    selected = [c for c in candidates if c.file_path in wanted]
    if not selected:
        raise HTTPException(status_code=404, detail="None of the requested file_paths matched a current scan result")

    imported: list[ImportedModel] = []

    for cand in selected:
        # Prevent duplicate imports by checking if name or source_ref exists in the project
        existing = await db.execute(
            select(AIModelORM).where(
                AIModelORM.project_id == payload.project_id,
                (AIModelORM.name == cand.suggested_name) | (AIModelORM.source_ref == cand.file_path),
                AIModelORM.is_active.is_(True),
            )
        )
        existing_models = existing.scalars().all()
        if existing_models:
            if payload.overwrite:
                from sentrai.infrastructure.orm_models import AIAuditTrailORM, DriftReportORM, AIIncidentORM
                for existing_model in existing_models:
                    model_id = existing_model.id
                    await db.execute(
                        AIAuditTrailORM.__table__.delete().where(AIAuditTrailORM.model_id == model_id)
                    )
                    await db.execute(
                        DriftReportORM.__table__.delete().where(DriftReportORM.model_id == model_id)
                    )
                    await db.execute(
                        AIIncidentORM.__table__.delete().where(AIIncidentORM.model_id == model_id)
                    )
                    await db.execute(
                        ModelLedgerEventORM.__table__.delete().where(ModelLedgerEventORM.model_id == model_id)
                    )
                    await db.delete(existing_model)
                await db.flush()
            else:
                continue

        entry = AIModelEntry.create(
            name=cand.suggested_name,
            model_type=cand.model_type_guess,
            functional_area=cand.functional_area_guess,
            use_case_description=cand.description or (
                f"Auto-discovered via static codebase scan. Detected signals: "
                f"{', '.join(sorted({s.category for s in cand.signals}))}."
                + (f" Domain: {', '.join(cand.domain_tags)}." if cand.domain_tags else "")
            ),
            target_customer_segments=[],
            risk_level=RiskLevel.LOW,
            lifecycle_stage=ModelLifecycleStage.DESIGN,
            owner_team=payload.owner_team,
            developed_by="internal",
            deployment_date=None,
            dependencies=[],
            performance_benchmarks=[],
            sutras_alignment=[],
            human_oversight_required=True,
            autonomous_scope=None,
            board_policy_ref=payload.board_policy_ref,
            last_red_team_date=None,
            next_audit_due=None,
            source_ref=cand.file_path,
        )
        # Risk triage considers both the static hint and the rule-based engine;
        # take whichever is more conservative (higher).
        triaged = triage_ai_model(entry)
        risk_order = {RiskLevel.LOW: 0, RiskLevel.MEDIUM: 1, RiskLevel.HIGH: 2}
        final_risk = triaged if risk_order[triaged] >= risk_order[cand.risk_hint] else cand.risk_hint

        orm = AIModelORM(
            id=entry.model_id,
            project_id=payload.project_id,
            name=entry.name,
            model_type=entry.model_type.value,
            functional_area=entry.functional_area,
            use_case_description=entry.use_case_description,
            target_customer_segments=entry.target_customer_segments,
            risk_level=final_risk.value,
            lifecycle_stage=entry.lifecycle_stage.value,
            owner_team=entry.owner_team,
            developed_by=entry.developed_by,
            deployment_date=entry.deployment_date,
            dependencies=[],
            performance_benchmarks=[],
            sutras_alignment=[],
            human_oversight_required=entry.human_oversight_required,
            autonomous_scope=entry.autonomous_scope,
            board_policy_ref=entry.board_policy_ref,
            last_red_team_date=entry.last_red_team_date,
            next_audit_due=entry.next_audit_due,
            source_ref=entry.source_ref,
            registered_at=entry.registered_at,
            updated_at=entry.updated_at,
        )
        db.add(orm)

        if cand.prompts:
            from sentrai.infrastructure.orm_models import PromptORM
            for p_data in cand.prompts:
                p_orm = PromptORM(
                    id=uuid.uuid4(),
                    model_id=entry.model_id,
                    raw_text=p_data["raw_text"],
                    prompt_type=p_data["prompt_type"],
                    injection_risk=p_data["injection_risk"],
                    pii_detected=p_data["pii_detected"],
                )
                db.add(p_orm)

        db.add(ModelLedgerEventORM(
            model_id=entry.model_id,
            event_type="MODEL_DISCOVERED_AND_IMPORTED",
            event_data={
                "source_ref": cand.file_path,
                "static_risk_hint": cand.risk_hint.value,
                "triaged_risk_level": triaged.value,
                "final_risk_level": final_risk.value,
                "confidence": cand.confidence,
            },
            actor="codebase_scanner",
            occurred_at=entry.registered_at,
        ))

        imported.append(ImportedModel(
            model_id=str(entry.model_id),
            name=entry.name,
            source_ref=cand.file_path,
            risk_level=final_risk,
            remaining_gaps=cand.gaps,
        ))

    if project:
        project.last_scanned_at = datetime.now(timezone.utc)

    await db.flush()
    return imported


class RemoteScanRequest(BaseModel):
    provider: str
    owner: str | None = None
    repo: str | None = None
    project_id: str | None = None
    branch: str = "main"
    token: str | None = None
    host: str = "gitlab.com"


@router.post("/scan-remote")
async def scan_remote_repo(payload: RemoteScanRequest):
    from sentrai.discovery.connectors.repo_connector import RemoteRepoConnector
    from sentrai.discovery.agents.supervisor import SupervisorCoordinator
    from sentrai.discovery.agents.ast_parsing_agent import ASTParsingAgent
    from sentrai.discovery.agents.security_analysis_agent import SecurityAnalysisAgent
    import shutil
    
    try:
        if payload.provider.lower() == "github":
            if not payload.owner or not payload.repo:
                raise HTTPException(status_code=400, detail="owner and repo are required for github")
            temp_path = RemoteRepoConnector.download_github_repo(
                owner=payload.owner,
                repo=payload.repo,
                branch=payload.branch,
                token=payload.token
            )
        elif payload.provider.lower() == "gitlab":
            if not payload.project_id:
                raise HTTPException(status_code=400, detail="project_id is required for gitlab")
            temp_path = RemoteRepoConnector.download_gitlab_repo(
                project_id=payload.project_id,
                branch=payload.branch,
                token=payload.token,
                host=payload.host
            )
        else:
            raise HTTPException(status_code=400, detail="Unsupported remote provider. Use github or gitlab")

        candidates = scan_directory(temp_path)
        
        coord = SupervisorCoordinator()
        coord.register_agent(ASTParsingAgent())
        coord.register_agent(SecurityAnalysisAgent())
        
        context = await coord.coordinate_scan(temp_path)
        context["candidates"] = candidates
        await coord.coordinate_scan(temp_path)
        
        results = []
        for c in candidates:
            rel_path = c.file_path.replace(str(temp_path), "").lstrip("/")
            results.append({
                "name": c.suggested_name,
                "model_type": c.model_type_guess.value,
                "confidence": c.confidence,
                "file_path": rel_path,
                "risk_hint": c.risk_hint.value,
                "gaps": c.gaps,
                "prompts": c.prompts,
                "secrets": c.secrets
            })
            
        try:
            if "sentrai_scan_" in str(temp_path):
                shutil.rmtree(temp_path.parent)
        except Exception:
            pass
            
        return {"candidates": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Remote scan failed: {str(e)}")


class InfraScanRequest(BaseModel):
    provider: str
    namespace: str = "default"
    endpoint_url: str | None = None


@router.post("/scan-infrastructure")
async def scan_infrastructure(payload: InfraScanRequest):
    from sentrai.discovery.connectors.infra_connector import InfrastructureDiscoveryConnector
    if payload.provider.lower() == "kubernetes":
        results = await InfrastructureDiscoveryConnector.scan_kubernetes_namespaces(payload.namespace)
        return {"deployments": results}
    elif payload.provider.lower() == "triton":
        if not payload.endpoint_url:
            raise HTTPException(status_code=400, detail="endpoint_url is required for triton provider")
        results = await InfrastructureDiscoveryConnector.scan_triton_server(payload.endpoint_url)
        return {"models": results}
    else:
        raise HTTPException(status_code=400, detail="Unsupported infrastructure provider. Use kubernetes or triton")


