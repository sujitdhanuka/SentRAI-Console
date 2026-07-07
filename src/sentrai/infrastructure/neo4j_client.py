import logging
from sentrai.config import settings

logger = logging.getLogger(__name__)

class Neo4jClient:
    def __init__(self):
        self.driver = None
        self._initialize_driver()

    def _initialize_driver(self):
        try:
            from neo4j import GraphDatabase
            self.driver = GraphDatabase.driver(
                settings.neo4j_uri,
                auth=(settings.neo4j_user, settings.neo4j_password)
            )
            logger.info("Neo4j driver initialized successfully.")
        except Exception as e:
            logger.warning(f"Could not initialize Neo4j driver: {e}. Graph features will run in fallback/mock mode.")
            self.driver = None

    def close(self):
        if self.driver:
            self.driver.close()

    def run_query(self, query: str, parameters: dict = None) -> list:
        if not self.driver:
            logger.debug(f"Mock Neo4j executing: {query} with params {parameters}")
            return []
            
        with self.driver.session() as session:
            try:
                result = session.run(query, parameters or {})
                return [record.data() for record in result]
            except Exception as e:
                logger.error(f"Neo4j query execution failed: {e}")
                return []
