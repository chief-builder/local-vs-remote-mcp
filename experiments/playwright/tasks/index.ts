import type { Task } from '../../../harness/src/tasks.js';
import { tier1Tasks } from './tier1.js';
import { tier2Tasks } from './tier2.js';
import { tier3Tasks } from './tier3.js';

export const tasks: Task[] = [...tier1Tasks, ...tier2Tasks, ...tier3Tasks];
