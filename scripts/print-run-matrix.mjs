import { tasks } from '../experiments/github/tasks/index.ts';

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const runName = argValue('--run') ?? 'full-n5-YYYYMMDD';
const trials = Number(argValue('--trials') ?? 5);
const experiment = argValue('--experiment') ?? 'github';

if (!Number.isInteger(trials) || trials <= 0) {
  console.error('--trials must be a positive integer');
  process.exit(2);
}

const arms = ['baseline', 'local-stdio', 'remote-http'];

function tasksForArm(arm) {
  return tasks.filter((task) => !task.applicableArms || task.applicableArms.includes(arm));
}

const matrix = arms.map((arm) => {
  const armTasks = tasksForArm(arm);
  const byTier = new Map();
  for (const task of armTasks) {
    const list = byTier.get(task.tier) ?? [];
    list.push(task.id);
    byTier.set(task.tier, list);
  }
  return {
    arm,
    tasks: armTasks.length,
    trials: armTasks.length * trials,
    tiers: [...byTier.entries()]
      .sort(([a], [b]) => a - b)
      .map(([tier, taskIds]) => ({ tier, taskIds })),
  };
});

const totalTasks = matrix.reduce((sum, arm) => sum + arm.tasks, 0);
const totalTrials = matrix.reduce((sum, arm) => sum + arm.trials, 0);

console.log(`# ${experiment} run matrix`);
console.log('');
console.log(`Run: ${runName}`);
console.log(`Trials per task: ${trials}`);
console.log(`Task/arm cells: ${totalTasks}`);
console.log(`Trial result files expected: ${totalTrials}`);
console.log('');

for (const arm of matrix) {
  console.log(`## ${arm.arm}`);
  console.log('');
  for (const tier of arm.tiers) {
    console.log(`- Tier ${tier.tier}: ${tier.taskIds.join(', ')}`);
  }
  console.log('');
}

console.log('## Commands');
console.log('');
console.log('```bash');
console.log(`RUN=${runName}`);
console.log('npm run check:static');
console.log('npm run check:claude-auth');
console.log('npm run harness -- verify-arms --experiment github --output artifacts/verify-arms/github.json');
console.log('npm run harness -- run --experiment github --run latency-smoke --arm local-stdio --task tier1_pr_diff_answer --trials 1');
console.log('npm run harness -- run --experiment github --run latency-smoke --arm remote-http --task tier1_pr_diff_answer --trials 1');
console.log('npm run harness -- report --experiment github --run latency-smoke --all-tiers --crossover-analysis --include-cost --output "experiments/github/runs/latency-smoke/report.md"');
for (const arm of matrix) {
  for (const tier of arm.tiers) {
    console.log(`npm run harness -- run --experiment ${experiment} --run "$RUN" --arm ${arm.arm} --tier ${tier.tier} --trials ${trials}`);
  }
}
console.log(`npm run harness -- report --experiment ${experiment} --run "$RUN" --all-tiers --crossover-analysis --include-cost --output "experiments/${experiment}/runs/$RUN/report.md"`);
console.log(`npm run check:run -- --run "$RUN" --trials ${trials}`);
console.log(`npm run scan:secrets -- --path "experiments/${experiment}/runs/$RUN"`);
console.log(`npm run check:completion -- --run "$RUN" --trials ${trials}`);
console.log('```');
