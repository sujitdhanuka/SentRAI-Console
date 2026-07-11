import { DiscoveredCandidate } from '../codebase-scanner';

export interface DiscoveryContext {
  rootPath: string;
  projectName?: string;
  candidates: DiscoveredCandidate[];
  [key: string]: any;
}

/** A discovery agent operating on a shared scan context. Port of base_agent.py. */
export interface DiscoveryAgent {
  readonly name: string;
  process(context: DiscoveryContext): Promise<void>;
}

/** Coordinates registered discovery agents sequentially. Port of supervisor.py. */
export class SupervisorCoordinator {
  private readonly agents: DiscoveryAgent[] = [];

  registerAgent(agent: DiscoveryAgent): void {
    this.agents.push(agent);
  }

  async coordinateScan(context: DiscoveryContext): Promise<DiscoveryContext> {
    for (const agent of this.agents) {
      await agent.process(context);
    }
    return context;
  }
}
