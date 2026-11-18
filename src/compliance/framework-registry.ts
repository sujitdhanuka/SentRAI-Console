/**
 * Framework plugin registry. Port of src/sentrai/compliance/framework_registry.py.
 */
import { ComplianceFrameworkPlugin, PluginComplianceReport } from './plugins/base-plugin';
import { RBIFreeAIPlugin } from './plugins/rbi-free-ai.plugin';
import { ISO42001Plugin } from './plugins/iso-42001.plugin';
import { EUAIActPlugin } from './plugins/eu-ai-act.plugin';
import { getFeatureFlags } from '../common/feature-flags';
import { evaluatePluginViaPack, PLUGIN_PACKS } from '../governance/packs/plugin-adapter';
import { packRegistry } from '../governance/packs/pack-loader';

const REGISTRY = new Map<string, ComplianceFrameworkPlugin>([
  ['RBI_FREE_AI', new RBIFreeAIPlugin()],
  ['ISO_42001', new ISO42001Plugin()],
  ['EU_AI_ACT', new EUAIActPlugin()],
]);

export function listFrameworks(): Array<{ framework_id: string; framework_name: string; framework_version: string }> {
  // E1.1: with the pack engine on, the registry lists the packs in force.
  if (getFeatureFlags().packEngine) {
    return Object.entries(PLUGIN_PACKS).map(([fid, packId]) => {
      const v = packRegistry().versionAt(packId)!;
      return { framework_id: fid, framework_name: v.definition.name, framework_version: v.definition.version };
    });
  }
  return [...REGISTRY.values()].map((p) => ({
    framework_id: p.frameworkId,
    framework_name: p.frameworkName,
    framework_version: p.frameworkVersion,
  }));
}

export function evaluate(asset: Record<string, any>, frameworkId: string): PluginComplianceReport {
  const flags = getFeatureFlags();
  if (flags.packEngine && PLUGIN_PACKS[frameworkId.toUpperCase()]) {
    return evaluatePluginViaPack(frameworkId.toUpperCase(), asset, flags);
  }
  const plugin = REGISTRY.get(frameworkId.toUpperCase());
  if (!plugin) {
    throw new Error(
      `Unknown compliance framework: '${frameworkId}'. Available: ${[...REGISTRY.keys()].join(', ')}`,
    );
  }
  return plugin.evaluate(asset);
}

export function evaluateAll(asset: Record<string, any>): PluginComplianceReport[] {
  const flags = getFeatureFlags();
  if (flags.packEngine) return Object.keys(PLUGIN_PACKS).map((fid) => evaluatePluginViaPack(fid, asset, flags));
  return [...REGISTRY.values()].map((p) => p.evaluate(asset));
}

export function registerFramework(frameworkId: string, plugin: ComplianceFrameworkPlugin): void {
  REGISTRY.set(frameworkId.toUpperCase(), plugin);
}
