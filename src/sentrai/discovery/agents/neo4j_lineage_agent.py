from typing import Any
from sentrai.discovery.agents.base_agent import BaseDiscoveryAgent
from sentrai.infrastructure.neo4j_client import Neo4jClient

class Neo4jLineageAgent(BaseDiscoveryAgent):
    def __init__(self):
        self.client = Neo4jClient()

    @property
    def name(self) -> str:
        return "Neo4j Lineage Agent"

    async def process(self, context: dict[str, Any]) -> None:
        # Create Project node first
        proj_name = context.get("project_name", "Default Project")
        self.client.run_query(
            "MERGE (p:Project {name: $name}) RETURN p",
            {"name": proj_name}
        )

        for candidate in context.get("candidates", []):
            # MERGE Model node
            self.client.run_query(
                "MERGE (m:Model {id: $model_id}) "
                "ON CREATE SET m.name = $name, m.type = $type "
                "RETURN m",
                {
                    "model_id": candidate.file_path,
                    "name": candidate.suggested_name,
                    "type": candidate.model_type_guess.value
                }
            )

            # Relate Project -> Model
            self.client.run_query(
                "MATCH (p:Project {name: $proj_name}), (m:Model {id: $model_id}) "
                "MERGE (p)-[:RUNS]->(m)",
                {"proj_name": proj_name, "model_id": candidate.file_path}
            )

            # Create Prompt nodes and relationships
            for i, pr in enumerate(candidate.prompts):
                prompt_id = f"{candidate.file_path}#prompt-{i}"
                self.client.run_query(
                    "MERGE (pr:Prompt {id: $prompt_id}) "
                    "ON CREATE SET pr.type = $type, pr.text = $text "
                    "RETURN pr",
                    {
                        "prompt_id": prompt_id,
                        "type": pr["prompt_type"],
                        "text": pr["raw_text"]
                    }
                )
                self.client.run_query(
                    "MATCH (m:Model {id: $model_id}), (pr:Prompt {id: $prompt_id}) "
                    "MERGE (m)-[:USES]->(pr)",
                    {"model_id": candidate.file_path, "prompt_id": prompt_id}
                )
