import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Task, TaskContext, SuccessResult } from '../../../harness/src/tasks.js';

interface Todo {
  id: number;
  title: string;
  priority: 'low' | 'medium' | 'high';
  completed: boolean;
}

interface FormPersistenceState {
  expectedTitle: string;
  store: {
    todos: Todo[];
    nextId: number;
  };
}

function hexFromSeed(seed: string, salt: string, length = 6): string {
  let acc = 0n;
  for (const ch of `${seed}:${salt}`) acc = (acc * 1099511628211n) ^ BigInt(ch.charCodeAt(0));
  return acc.toString(16).padStart(length, '0').slice(-length);
}

async function readJsonIfExists<T>(path: string): Promise<T | null> {
  try {
    const text = await readFile(path, 'utf-8');
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function renderTodosList(s: FormPersistenceState, editId: number | null): string {
  const rows = s.store.todos.map((t) => {
    const status = t.completed ? '<span class="done">complete</span>' : '<span class="open">open</span>';
    return [
      `<li id="todo-${t.id}">`,
      `<span class="title">${escapeHtml(t.title)}</span>`,
      ` — priority: <span class="priority">${t.priority}</span>`,
      ` — ${status}`,
      ` <a class="edit-link" href="/todos?edit=${t.id}">Edit</a>`,
      `<form class="complete-form" action="/todos/${t.id}/complete" method="POST" style="display:inline">`,
      `<button type="submit">Mark complete</button>`,
      `</form>`,
      `</li>`,
    ].join('');
  }).join('\n');

  let editForm = '';
  if (editId !== null) {
    const target = s.store.todos.find((t) => t.id === editId);
    if (target) {
      editForm = [
        '<h2>Edit todo</h2>',
        `<form id="edit-form" action="/todos/${target.id}" method="POST">`,
        `  <label>Title: <input type="text" name="title" id="edit-title" value="${escapeHtml(target.title)}"></label>`,
        '  <label>Priority:',
        '    <select name="priority" id="edit-priority">',
        ['low', 'medium', 'high'].map((p) =>
          `<option value="${p}"${target.priority === p ? ' selected' : ''}>${p}</option>`,
        ).join(''),
        '    </select>',
        '  </label>',
        '  <button type="submit" id="edit-submit">Save</button>',
        '</form>',
      ].join('\n');
    }
  }

  return [
    '<!doctype html>',
    '<html><head><title>Todos</title></head><body>',
    '<h1>Todos</h1>',
    rows ? `<ul id="todo-list">${rows}</ul>` : '<p id="empty">No todos yet.</p>',
    '<h2>Add new</h2>',
    '<form id="add-form" action="/todos" method="POST">',
    '  <label>Title: <input type="text" name="title" id="add-title"></label>',
    '  <label>Priority:',
    '    <select name="priority" id="add-priority">',
    '      <option value="low">low</option>',
    '      <option value="medium" selected>medium</option>',
    '      <option value="high">high</option>',
    '    </select>',
    '  </label>',
    '  <button type="submit" id="add-submit">Add</button>',
    '</form>',
    editForm,
    '</body></html>',
  ].join('\n');
}

/**
 * tier2_form_persistence — agent must create a todo, edit its priority,
 * and mark it complete. State is held in an in-memory store on `task.state`,
 * mutated by `renderResponse`, and queried by `successCheck` at trial end.
 *
 * Mirrors github's Tier 2 mutation pattern: real state changes that persist
 * across tool calls and can be verified independently of the agent's
 * self-report. ~12–15 tool calls per trial — cold-start tax fully amortized.
 */
export const tier2_form_persistence: Task = {
  id: 'tier2_form_persistence',
  tier: 2,

  setup: async (seed: string) => {
    return {
      expectedTitle: `Task-${hexFromSeed(seed, 'title', 8).toUpperCase()}`,
      store: { todos: [], nextId: 1 },
    } satisfies FormPersistenceState;
  },

  renderResponse: (state, req, res, body) => {
    const s = state as FormPersistenceState | null;
    if (!s) return false;
    const rawUrl = req.url ?? '';
    const [pathPart, queryPart] = rawUrl.split('?');
    const url = pathPart ?? '';

    if (req.method === 'GET' && url === '/todos') {
      const params = new URLSearchParams(queryPart ?? '');
      const editRaw = params.get('edit');
      const editId = editRaw && /^\d+$/.test(editRaw) ? Number(editRaw) : null;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderTodosList(s, editId));
      return true;
    }

    if (req.method === 'POST' && url === '/todos') {
      const params = new URLSearchParams(body.toString('utf-8'));
      const title = (params.get('title') ?? '').trim();
      const priority = (params.get('priority') ?? 'medium') as Todo['priority'];
      if (title) {
        s.store.todos.push({ id: s.store.nextId++, title, priority, completed: false });
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderTodosList(s, null));
      return true;
    }

    const editMatch = url.match(/^\/todos\/(\d+)$/);
    if (req.method === 'POST' && editMatch) {
      const id = Number(editMatch[1]);
      const target = s.store.todos.find((t) => t.id === id);
      if (target) {
        const params = new URLSearchParams(body.toString('utf-8'));
        const title = params.get('title');
        const priority = params.get('priority') as Todo['priority'] | null;
        if (title !== null && title.trim() !== '') target.title = title.trim();
        if (priority && ['low', 'medium', 'high'].includes(priority)) target.priority = priority;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderTodosList(s, null));
      return true;
    }

    const completeMatch = url.match(/^\/todos\/(\d+)\/complete$/);
    if (req.method === 'POST' && completeMatch) {
      const id = Number(completeMatch[1]);
      const target = s.store.todos.find((t) => t.id === id);
      if (target) target.completed = true;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderTodosList(s, null));
      return true;
    }

    return false;
  },

  prompt: (ctx: TaskContext) => {
    const s = ctx.state as FormPersistenceState;
    return `
You will complete a multi-step todo workflow in the browser.

Open this URL:
  ${ctx.fixturesUrl}/todos

Step 1. Add a new todo with these exact values:
  - Title:    "${s.expectedTitle}"
  - Priority: medium

Step 2. After the todo appears in the list, open its edit form (the Edit
        link next to it). Change its priority from "medium" to "high" and
        save the change.

Step 3. With the priority now "high", mark the todo complete (click its
        "Mark complete" button).

When all three steps are done, write a JSON file at:
  ${ctx.outputDir}/done.json
with the single field {"done": true}.
    `.trim();
  },

  successCheck: async (ctx: TaskContext): Promise<SuccessResult> => {
    const s = ctx.state as FormPersistenceState;
    const donePath = join(ctx.outputDir, 'done.json');
    const doneFile = await readJsonIfExists<{ done?: unknown }>(donePath);

    const doneOk = doneFile?.done === true;
    const todos = s.store.todos;
    const target = todos.find((t) => t.title === s.expectedTitle);
    const titleOk = !!target;
    const priorityOk = target?.priority === 'high';
    const completedOk = target?.completed === true;
    const onlyOne = todos.length === 1;

    const checks = [doneOk, titleOk, priorityOk, completedOk, onlyOne];
    const matched = checks.filter(Boolean).length;
    return {
      pass: matched === checks.length,
      score: matched / checks.length,
      notes: matched === checks.length
        ? 'form workflow correct: one todo, exact title, priority=high, completed'
        : `done=${doneOk} title=${titleOk} priority=${priorityOk} completed=${completedOk} only-one=${onlyOne} (todos=${todos.length})`,
      extras: {
        expectedTitle: s.expectedTitle,
        actualTodos: todos,
      },
    };
  },
};

export const tier2Tasks: Task[] = [tier2_form_persistence];
