import { createHash } from 'node:crypto';

/** Deterministic paired seed shared by every arm for the same task/trial. */
export function mkPairedSeed(experiment: string, runName: string, taskId: string, trialN: number): string {
  return createHash('sha256')
    .update(`${experiment}:${runName}:${taskId}:${trialN}`)
    .digest('hex')
    .slice(0, 16);
}
