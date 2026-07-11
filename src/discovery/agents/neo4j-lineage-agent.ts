import { Neo4jClient } from '../neo4j-client';
import { DiscoveryAgent, DiscoveryContext } from './supervisor';

/**
 * Writes project → model → prompt lineage to Neo4j. Port of
 * neo4j_lineage_agent.py. No-ops gracefully when Neo4j is in mock mode.
 */
export class Neo4jLineageAgent implements DiscoveryAgent {
  readonly name = 'Neo4j Lineage Agent';

  constructor(private readonly client: Neo4jClient) {}

  async process(context: DiscoveryContext): Promise<void> {
    const projName = context.projectName ?? 'Default Project';
    await this.client.runQuery('MERGE (p:Project {name: $name}) RETURN p', { name: projName });

    for (const candidate of context.candidates) {
      await this.client.runQuery(
        'MERGE (m:Model {id: $model_id}) ON CREATE SET m.name = $name, m.type = $type RETURN m',
        { model_id: candidate.filePath, name: candidate.suggestedName, type: candidate.modelTypeGuess },
      );
      await this.client.runQuery(
        'MATCH (p:Project {name: $proj_name}), (m:Model {id: $model_id}) MERGE (p)-[:RUNS]->(m)',
        { proj_name: projName, model_id: candidate.filePath },
      );
      for (let i = 0; i < candidate.prompts.length; i++) {
        const pr = candidate.prompts[i];
        const promptId = `${candidate.filePath}#prompt-${i}`;
        await this.client.runQuery(
          'MERGE (pr:Prompt {id: $prompt_id}) ON CREATE SET pr.type = $type, pr.text = $text RETURN pr',
          { prompt_id: promptId, type: pr.prompt_type, text: pr.raw_text },
        );
        await this.client.runQuery(
          'MATCH (m:Model {id: $model_id}), (pr:Prompt {id: $prompt_id}) MERGE (m)-[:USES]->(pr)',
          { model_id: candidate.filePath, prompt_id: promptId },
        );
      }
    }
  }
}
