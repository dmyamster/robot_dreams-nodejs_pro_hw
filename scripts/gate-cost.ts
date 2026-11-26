import fs from 'node:fs';
import path from 'node:path';
import { estimatePlanCost } from '../src/mapping.ts';

const planPath = path.resolve(process.env.PLAN_JSON || process.argv[2] || 'plan.json');
const budgetUsd = Number(process.env.COST_BUDGET_USD ?? '10');
const bypass = process.env.COST_BYPASS === 'true' || process.env.COST_BYPASS === '1';

if (Number.isNaN(budgetUsd)) {
  console.error(`Invalid COST_BUDGET_USD: ${process.env.COST_BUDGET_USD}`);
  process.exit(1);
}

if (!fs.existsSync(planPath)) {
  console.error(`Plan file not found: ${planPath}`);
  process.exit(1);
}

const raw = fs.readFileSync(planPath, 'utf8');
const plan = JSON.parse(raw);
const estimate = estimatePlanCost(plan);

const pass = bypass || estimate.planUsd <= budgetUsd;

console.log(`budget-usd=${budgetUsd}`);
console.log(`plan-usd=${estimate.planUsd}`);
console.log(`delta-usd=${estimate.deltaUsd}`);
console.log(`bypass=${bypass ? 1 : 0}`);
console.log(`gate=${pass ? 'pass' : 'fail'}`);

process.exit(pass ? 0 : 1);
