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
 * Gathers GPU stats via nvidia-smi. Hosts without GPU tooling report an empty
 * list — real telemetry or nothing. Port of monitoring/gpu_monitor.py.
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
    // no GPU tooling on this host
  }

  // Never fabricate hardware: no nvidia-smi means no GPUs to report.
  return [];
}

export interface GpuPowerSample {
  gpu_id: number;
  power_w: number;
  at: string;
}

/**
 * Current power draw per GPU from nvidia-smi (governance E3.5). Empty on
 * hosts without GPU tooling: real readings or nothing.
 */
export function getGpuPower(): GpuPowerSample[] {
  try {
    const out = execFileSync('nvidia-smi', ['--query-gpu=index,power.draw', '--format=csv,noheader,nounits'], { encoding: 'utf-8' });
    const at = new Date().toISOString();
    return out
      .trim()
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => l.split(',').map((s) => s.trim()))
      .filter((p) => Number.isFinite(parseFloat(p[1])))
      .map((p) => ({ gpu_id: parseInt(p[0], 10), power_w: parseFloat(p[1]), at }));
  } catch {
    return [];
  }
}
