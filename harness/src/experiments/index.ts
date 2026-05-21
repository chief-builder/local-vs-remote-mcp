import { githubExperiment } from './github.js';
import type { ExperimentSpec } from '../experiment.js';

export type ExperimentName = 'github';

export const experiments: Record<ExperimentName, ExperimentSpec> = {
  github: githubExperiment,
};

export function getExperiment(name: string): ExperimentSpec {
  if (!(name in experiments)) {
    throw new Error(`Unknown experiment "${name}". Known: ${Object.keys(experiments).join(', ')}`);
  }
  return experiments[name as ExperimentName];
}
