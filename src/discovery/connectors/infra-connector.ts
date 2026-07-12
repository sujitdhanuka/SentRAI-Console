import { Logger } from '@nestjs/common';

const logger = new Logger('InfrastructureDiscoveryConnector');

/**
 * Infrastructure discovery. Port of discovery/connectors/infra_connector.py.
 * Kubernetes scanning uses @kubernetes/client-node when available and falls back
 * to representative mock data; Triton uses its v2 HTTP API.
 */
export class InfrastructureDiscoveryConnector {
  static async scanTritonServer(endpointUrl: string): Promise<any[]> {
    const url = `${endpointUrl.replace(/\/$/, '')}/v2/repository/index`;
    logger.log(`Scanning Triton server at: ${url}`);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (res.ok) {
        const models = (await res.json()) as any[];
        return models.map((m) => ({
          name: m.name ?? 'triton-model',
          version: m.version ?? '1',
          state: m.state ?? 'UNKNOWN',
        }));
      }
    } catch (e) {
      logger.warn(`Failed to scan Triton server: ${String(e)}`);
    }
    return [];
  }

  static async scanKubernetesNamespaces(namespace = 'default'): Promise<any[]> {
    logger.log(`Scanning Kubernetes namespace: ${namespace}`);
    try {
      // Lazy require so the app runs on hosts without the k8s client installed.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const k8s = require('@kubernetes/client-node');
      const kc = new k8s.KubeConfig();
      try {
        kc.loadFromCluster();
      } catch {
        kc.loadFromDefault();
      }
      const apps = kc.makeApiClient(k8s.AppsV1Api);
      const deployments = await apps.listNamespacedDeployment(namespace);
      const items = deployments.body?.items ?? deployments.items ?? [];
      const candidates: any[] = [];
      for (const dep of items) {
        const labels = dep.metadata?.labels ?? {};
        if ('model-name' in labels || 'ai-model' in labels) {
          candidates.push({
            name: labels['model-name'] ?? labels['ai-model'],
            deployment_name: dep.metadata?.name,
            replicas: dep.spec?.replicas,
            risk_level: labels['risk-level'] ?? 'MEDIUM',
          });
        }
      }
      return candidates;
    } catch (e) {
      // Never fabricate discoveries: an unreachable cluster returns an empty
      // result with a status the caller can surface, not demo data.
      logger.warn(`Kubernetes scan unavailable (${String(e)}); returning empty result`);
      return [];
    }
  }
}
