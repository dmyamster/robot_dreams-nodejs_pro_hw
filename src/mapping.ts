/**
 * Translates Pulumi preview JSON (`plan.json`) resources into estimated monthly USD cost.
 *
 * Rates (AWS Fargate, eu-central-1, 730 hours/month):
 * - vCPU: $0.04656 / vCPU-hour ($33.9888 / vCPU-month)
 * - Memory: $0.00511 / GiB-hour ($3.7303 / GiB-month)
 * Source: https://aws.amazon.com/fargate/pricing/
 */

export const HOURS_PER_MONTH = 730;
export const VCPU_HOURLY_USD = 0.04656;
export const MEM_GIB_HOURLY_USD = 0.00511;

export interface ResourceCost {
  urn: string;
  type: string;
  op: string;
  monthlyUsd: number;
  deltaUsd: number;
}

export interface PlanCostEstimate {
  planUsd: number;
  deltaUsd: number;
  resources: ResourceCost[];
}

export function parseCpuCores(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  if (typeof raw !== 'string') return 0;
  const val = raw.trim();
  if (val.endsWith('m')) {
    return Number(val.slice(0, -1)) / 1000;
  }
  const num = Number(val);
  return Number.isFinite(num) ? num : 0;
}

export function parseMemoryGiB(raw: unknown): number {
  if (typeof raw === 'number') return raw / (1024 * 1024 * 1024);
  if (typeof raw !== 'string') return 0;
  const val = raw.trim();
  const units: Record<string, number> = {
    Ki: 1 / (1024 * 1024),
    Mi: 1 / 1024,
    Gi: 1,
    Ti: 1024,
    K: 1e3 / 1024 ** 3,
    M: 1e6 / 1024 ** 3,
    G: 1e9 / 1024 ** 3,
  };
  for (const [suffix, factor] of Object.entries(units)) {
    if (val.endsWith(suffix)) {
      const n = Number(val.slice(0, -suffix.length));
      return Number.isFinite(n) ? n * factor : 0;
    }
  }
  const bytes = Number(val);
  return Number.isFinite(bytes) ? bytes / 1024 ** 3 : 0;
}

function computeStateMonthlyUsd(state: Record<string, any> | undefined): number {
  if (!state || typeof state !== 'object') return 0;
  const type = state.type as string | undefined;
  const inputs = (state.inputs ?? {}) as Record<string, any>;

  if (type === 'kubernetes:apps/v1:Deployment') {
    const replicas = Number(inputs?.spec?.replicas ?? 1);
    const containers = Array.isArray(inputs?.spec?.template?.spec?.containers)
      ? inputs.spec.template.spec.containers
      : [];

    let totalVcpu = 0;
    let totalMemGiB = 0;
    for (const c of containers) {
      const req = c?.resources?.requests ?? c?.resources?.limits ?? {};
      totalVcpu += parseCpuCores(req.cpu ?? '0');
      totalMemGiB += parseMemoryGiB(req.memory ?? '0');
    }

    const hourly = totalVcpu * VCPU_HOURLY_USD + totalMemGiB * MEM_GIB_HOURLY_USD;
    return replicas * hourly * HOURS_PER_MONTH;
  }

  if (type === 'kubernetes:core/v1:Service' && inputs?.spec?.type === 'LoadBalancer') {
    // Classic/NLB hourly rate in eu-central-1: $0.027/hr
    return 0.027 * HOURS_PER_MONTH;
  }

  return 0;
}

export function estimatePlanCost(plan: Record<string, any>): PlanCostEstimate {
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  const resources: ResourceCost[] = [];
  let planUsd = 0;
  let deltaUsd = 0;

  for (const step of steps) {
    const op = String(step?.op ?? 'same');
    const oldCost = computeStateMonthlyUsd(step?.oldState);
    const newCost = op === 'delete' ? 0 : computeStateMonthlyUsd(step?.newState);
    const diff = newCost - oldCost;

    if (newCost > 0 || oldCost > 0) {
      resources.push({
        urn: String(step?.urn ?? ''),
        type: String(step?.newState?.type ?? step?.oldState?.type ?? ''),
        op,
        monthlyUsd: Number(newCost.toFixed(4)),
        deltaUsd: Number(diff.toFixed(4)),
      });
    }

    planUsd += newCost;
    deltaUsd += diff;
  }

  return {
    planUsd: Number(planUsd.toFixed(2)),
    deltaUsd: Number(deltaUsd.toFixed(2)),
    resources,
  };
}
