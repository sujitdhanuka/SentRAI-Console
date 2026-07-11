import { Injectable } from '@nestjs/common';
import { BCPFallbackState, newBcpState } from '../domain/monitoring';

/**
 * In-memory BCP fallback state, keyed by model id. Mirrors the module-level
 * _bcp_states dict in api/v1/monitoring.py (single-instance only; in production
 * this would be Redis-backed).
 */
@Injectable()
export class BcpStateStore {
  private readonly states = new Map<string, BCPFallbackState>();

  get(modelId: string): BCPFallbackState | undefined {
    return this.states.get(modelId);
  }

  getOrCreate(modelId: string): BCPFallbackState {
    let state = this.states.get(modelId);
    if (!state) {
      state = newBcpState(modelId);
      this.states.set(modelId, state);
    }
    return state;
  }
}
