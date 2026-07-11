import { execFileSync } from 'child_process';

export interface GpuStat {
  gpu_id: number;
  name: string;
  utilization_pct: number;
  memory_used_mb: number;
  memory_total_mb: number;
  temperature_c: number;
}

/**
 * Gathers GPU stats via nvidia-smi, with a mock fallback when no GPU tooling is
 * present. Port of monitoring/gpu_monitor.py (NVML is unavailable on Node, so we
 * go straight to nvidia-smi then mock).
 */
export function getGpuUtilization(): GpuStat[] {
  try {
    const out = execFileSync(
      'nvidia-smi',
      [
        '--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu',
        '--format=csv,noheader,nounits',
      ],
      { encoding: 'utf-8' },
    );
    const gpus: GpuStat[] = [];
    for (const line of out.trim().split('\n')) {
      if (!line.trim()) continue;
      const p = line.split(',').map((s) => s.trim());
      gpus.push({
        gpu_id: parseInt(p[0], 10),
        name: p[1],
        utilization_pct: parseFloat(p[2]),
        memory_used_mb: parseFloat(p[3]),
        memory_total_mb: parseFloat(p[4]),
        temperature_c: parseFloat(p[5]),
      });
    }
    if (gpus.length) return gpus;
  } catch {
    // fall through to mock
  }

  return [
    {
      gpu_id: 0,
      name: 'NVIDIA H100 PCIe 80GB',
      utilization_pct: 78.5,
      memory_used_mb: 42100.0,
      memory_total_mb: 81920.0,
      temperature_c: 64.0,
    },
  ];
}
