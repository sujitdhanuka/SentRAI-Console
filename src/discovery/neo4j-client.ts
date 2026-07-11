import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import neo4j, { Driver } from 'neo4j-driver';

/**
 * Neo4j graph client. Port of infrastructure/neo4j_client.py — initialises a
 * driver, and if it cannot connect, runs in mock mode (queries are logged and
 * return []). Graph lineage is therefore optional.
 */
@Injectable()
export class Neo4jClient implements OnModuleDestroy {
  private readonly logger = new Logger(Neo4jClient.name);
  private driver: Driver | null = null;

  constructor(config: ConfigService) {
    const cfg = config.get<{ uri: string; user: string; password: string }>('neo4j')!;
    try {
      this.driver = neo4j.driver(cfg.uri, neo4j.auth.basic(cfg.user, cfg.password));
      this.logger.log('Neo4j driver initialized');
    } catch (e) {
      this.logger.warn(`Could not initialize Neo4j driver: ${String(e)}. Graph features run in mock mode.`);
      this.driver = null;
    }
  }

  async runQuery(query: string, parameters: Record<string, any> = {}): Promise<any[]> {
    if (!this.driver) {
      this.logger.debug(`Mock Neo4j executing: ${query}`);
      return [];
    }
    const session = this.driver.session();
    try {
      const result = await session.run(query, parameters);
      return result.records.map((r) => r.toObject());
    } catch (e) {
      this.logger.error(`Neo4j query execution failed: ${String(e)}`);
      return [];
    } finally {
      await session.close();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.driver) await this.driver.close();
  }
}
