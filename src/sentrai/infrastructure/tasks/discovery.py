import logging
from pathlib import Path
from sentrai.infrastructure.celery_app import celery_app
from sentrai.infrastructure.database import AsyncSessionLocal
from sentrai.infrastructure.repositories.project_repository import SQLAlchemyProjectRepository
from sentrai.discovery.codebase_scanner import scan_directory

logger = logging.getLogger(__name__)

@celery_app.task
def run_periodic_scans():
    """
    Synchronous Celery task wrapper that runs codebase discovery scans on all projects.
    """
    import asyncio
    asyncio.run(_scan_all_projects())

async def _scan_all_projects():
    async with AsyncSessionLocal() as session:
        repo = SQLAlchemyProjectRepository(session)
        projects = await repo.list_all()
        for proj in projects:
            logger.info(f"Starting periodic scan for project: {proj.name}")
            try:
                root_path = Path(proj.root_directory)
                if root_path.is_dir():
                    candidates = scan_directory(root_path)
                    logger.info(f"Scan finished. Found {len(candidates)} model candidates.")
                else:
                    logger.warning(f"Root directory {proj.root_directory} not found for project {proj.name}")
            except Exception as e:
                logger.error(f"Error scanning project {proj.name}: {e}")
