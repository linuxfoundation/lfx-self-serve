// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The live activity feed of an agent run, built from the session's raw Guild
// events (chronological, user events already dropped by the BFF). Two shapes
// are read, both verified on a live Messaging Document 3.0.0 session:
//
//  - a platform tool call (fetch, web search, LFX MCP) is a `runtime_start`
//    event whose `task` is the tool task (`entity_type: 'EntTaskTool'`,
//    `tool_name`, `status`, `created_at`, `updated_at`) and whose `content`
//    is the tool INPUT; a `runtime_done` event for the same task marks it
//    finished;
//  - the agent's own local tools (`ask_requester`, the finalize tool) run
//    inside the agent and show only as `tool_use` blocks in an `llm_done`
//    event's raw response stream.
//
// Every label is written here. Nothing a tool RETURNED is ever read, and no
// tool name, id or model reasoning reaches the page: only a sentence, and for
// a web search the query the agent typed.

// Specific-file imports, not the barrels (see activity-feed.utils.ts).
import {
  MKTG_RUN_ACTIVITY_AGENT_TOOLS,
  MKTG_RUN_ACTIVITY_DETAIL_MAX_CHARS,
  MKTG_RUN_ACTIVITY_DONE_STATUSES,
  MKTG_RUN_ACTIVITY_FAILED_STATUSES,
  MKTG_RUN_ACTIVITY_HIDDEN_TOOLS,
  MKTG_RUN_ACTIVITY_LABELS,
  MKTG_RUN_ACTIVITY_KINDS,
  MKTG_RUN_ACTIVITY_LFX_TOOL_PREFIX,
  MKTG_RUN_ACTIVITY_NAME_MAX_CHARS,
  MKTG_RUN_ACTIVITY_OPAQUE_PATH_SEGMENTS,
  MKTG_RUN_ACTIVITY_PATH_SEGMENT_MAX_CHARS,
  MKTG_RUN_ACTIVITY_PHASES,
  MKTG_RUN_ACTIVITY_QUESTIONS_MARKER,
  MKTG_RUN_ACTIVITY_TOOLS,
  MKTG_RUN_QUESTION_SHORT_LABELS,
} from '../constants/mktg-run-activity.constants';
import type { MktgRunActivity, MktgRunActivityKind, MktgRunActivityPhase, MktgRunActivityStatus } from '../interfaces';

type UnknownRecord = Record<string, unknown>;

/** One step before ids are assigned. */
type Step = Omit<MktgRunActivity, 'id'>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function parseEvent(payload: string): UnknownRecord | null {
  try {
    const parsed: unknown = JSON.parse(payload);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** The sentence for a page the agent read, from its URL alone. */
export function mktgRunActivityReadingLabel(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return MKTG_RUN_ACTIVITY_LABELS.readingPage;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return MKTG_RUN_ACTIVITY_LABELS.readingPage;
  }
  const host = url.hostname.replace(/^www\./, '');
  const segments = url.pathname.split('/').filter((segment) => segment.length > 0);

  if (host === 'raw.githubusercontent.com' && segments.length >= 2) {
    const repo = `${segments[0]}/${segments[1]}`;
    return /readme/i.test(segments.at(-1) ?? '') ? `Reading the ${repo} README` : `Reading ${repo} on GitHub`;
  }
  if (host === 'api.github.com') {
    if ((segments[0] === 'orgs' || segments[0] === 'users') && segments[1]) {
      return `Looking through ${segments[1]} on GitHub`;
    }
    if (segments[0] === 'repos' && segments[1] && segments[2]) {
      return `Reading ${segments[1]}/${segments[2]} on GitHub`;
    }
  }
  if (host === 'github.com' && segments[0]) {
    return segments[1] ? `Reading ${segments[0]}/${segments[1]} on GitHub` : `Looking through ${segments[0]} on GitHub`;
  }
  const first = segments[0];
  if (!first || MKTG_RUN_ACTIVITY_OPAQUE_PATH_SEGMENTS.includes(first.toLowerCase())) {
    return `Reading ${host}`;
  }
  return `Reading ${host}/${clip(decodeURIComponentSafe(first), MKTG_RUN_ACTIVITY_PATH_SEGMENT_MAX_CHARS)}`;
}

function decodeURIComponentSafe(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Where a platform tool task stands, from its status and whether its `runtime_done` arrived. */
function taskStatus(rawStatus: string, finished: boolean): MktgRunActivityStatus {
  const status = rawStatus.toUpperCase();
  if (MKTG_RUN_ACTIVITY_FAILED_STATUSES.includes(status)) {
    return 'failed';
  }
  if (finished || MKTG_RUN_ACTIVITY_DONE_STATUSES.includes(status)) {
    return 'done';
  }
  return 'running';
}

/** The step for one platform tool call, or null when the feed does not show it. */
function platformStep(toolName: string, input: UnknownRecord, startedAt: string, status: MktgRunActivityStatus, endedAt: string): Step | null {
  if (MKTG_RUN_ACTIVITY_HIDDEN_TOOLS.includes(toolName) || MKTG_RUN_ACTIVITY_AGENT_TOOLS.includes(toolName)) {
    return null;
  }
  const timing = { status, startedAt, ...(status !== 'running' && endedAt && { endedAt }) };
  if (toolName === MKTG_RUN_ACTIVITY_TOOLS.fetch) {
    return { kind: 'reading', label: mktgRunActivityReadingLabel(asString(input['url'])), ...timing };
  }
  if (toolName === MKTG_RUN_ACTIVITY_TOOLS.webSearch) {
    const body = isRecord(input['body']) ? input['body'] : input;
    const query = clip(asString(body['query']), MKTG_RUN_ACTIVITY_DETAIL_MAX_CHARS);
    return { kind: 'search', label: MKTG_RUN_ACTIVITY_LABELS.searchingWeb, ...(query && { detail: `“${query}”` }), ...timing };
  }
  if (toolName.startsWith(MKTG_RUN_ACTIVITY_LFX_TOOL_PREFIX)) {
    let label: string = MKTG_RUN_ACTIVITY_LABELS.lfxOther;
    if (toolName === MKTG_RUN_ACTIVITY_TOOLS.lfxSearchProjects) {
      const name = clip(asString(input['name']), MKTG_RUN_ACTIVITY_NAME_MAX_CHARS);
      label = name ? `Finding ${name} in LFX` : MKTG_RUN_ACTIVITY_LABELS.lfxOther;
    } else if (toolName === MKTG_RUN_ACTIVITY_TOOLS.lfxGetProject) {
      label = MKTG_RUN_ACTIVITY_LABELS.lfxProjectRecord;
    } else if (toolName === MKTG_RUN_ACTIVITY_TOOLS.lfxSemanticLayer || toolName.includes('metric')) {
      label = MKTG_RUN_ACTIVITY_LABELS.lfxFigures;
    }
    return { kind: 'lfx', label, ...timing };
  }
  // A tool the feed has no sentence for is left out rather than shown by name.
  return null;
}

/** The agent's own tool calls in one `llm_done` response stream, in order. */
function localToolCalls(event: UnknownRecord): string[] {
  const body = asString(event['body']) || JSON.stringify(event['content'] ?? '');
  const calls: string[] = [];
  const pattern = /"type"\s*:\s*"tool_use"\s*,\s*"id"\s*:\s*"[^"]*"\s*,\s*"name"\s*:\s*"([^"]+)"/g;
  for (let match = pattern.exec(body); match !== null; match = pattern.exec(body)) {
    if (MKTG_RUN_ACTIVITY_AGENT_TOOLS.includes(match[1])) {
      calls.push(match[1]);
    }
  }
  return calls;
}

/** True when an agent output event carries the questions turn. */
function isQuestionsTurn(event: UnknownRecord): boolean {
  const type = asString(event['type']);
  if (type !== 'agent_notification_message' && type !== 'agent_notification_progress') {
    return false;
  }
  return JSON.stringify(event['content'] ?? '').includes(MKTG_RUN_ACTIVITY_QUESTIONS_MARKER);
}

/**
 * The run's activity so far, oldest first, from the session's raw event
 * payloads (chronological). Pure: the same payloads always give the same
 * feed, and ids are positional, so they stay stable while the run appends.
 */
export function buildMktgRunActivity(payloads: string[]): MktgRunActivity[] {
  const events = payloads.map(parseEvent).filter((event): event is UnknownRecord => event !== null);

  const finishedTasks = new Set<string>();
  for (const event of events) {
    const task = isRecord(event['task']) ? event['task'] : null;
    if (event['type'] === 'runtime_done' && task) {
      finishedTasks.add(asString(task['id']));
    }
  }

  const steps: Step[] = [];
  const seenTasks = new Set<string>();
  let finalizeCount = 0;
  let questionsAt = -1;
  let writingStart = '';
  let firstFinalizeAfterQuestions = '';
  /** Local-tool steps still open: done once any later event arrives. */
  const openLocal: Step[] = [];

  for (const [index, event] of events.entries()) {
    const type = asString(event['type']);
    const createdAt = asString(event['created_at']);
    const task = isRecord(event['task']) ? event['task'] : null;

    for (const open of openLocal.splice(0)) {
      open.status = 'done';
      open.endedAt = createdAt || open.startedAt;
    }

    if (type === 'runtime_start' && task && asString(task['entity_type']) === 'EntTaskTool') {
      const taskId = asString(task['id']);
      if (seenTasks.has(taskId)) {
        continue;
      }
      seenTasks.add(taskId);
      const input = isRecord(event['content']) ? event['content'] : {};
      const status = taskStatus(asString(task['status']), finishedTasks.has(taskId));
      const step = platformStep(asString(task['tool_name']), input, asString(task['created_at']) || createdAt, status, asString(task['updated_at']));
      if (step) {
        steps.push(step);
      }
      continue;
    }

    if (type === 'llm_start' && questionsAt >= 0 && !writingStart) {
      writingStart = createdAt;
      continue;
    }

    if (type === 'llm_done') {
      for (const tool of localToolCalls(event)) {
        let step: Step;
        if (tool === MKTG_RUN_ACTIVITY_TOOLS.askRequester) {
          step = { kind: 'questions', label: MKTG_RUN_ACTIVITY_LABELS.questions, status: 'running', startedAt: createdAt };
        } else {
          finalizeCount += 1;
          if (questionsAt >= 0 && !firstFinalizeAfterQuestions) {
            firstFinalizeAfterQuestions = createdAt;
          }
          step = {
            kind: 'checking',
            label: finalizeCount === 1 ? MKTG_RUN_ACTIVITY_LABELS.checking : MKTG_RUN_ACTIVITY_LABELS.fixing,
            status: 'running',
            startedAt: createdAt,
          };
        }
        steps.push(step);
        openLocal.push(step);
      }
      continue;
    }

    if (isQuestionsTurn(event)) {
      questionsAt = index;
    }
  }

  // The stretch between the answers and the first check is the agent writing:
  // no tool marks it, so the feed adds it, running until the check starts.
  if (writingStart) {
    steps.push({
      kind: 'writing',
      label: MKTG_RUN_ACTIVITY_LABELS.writing,
      status: firstFinalizeAfterQuestions ? 'done' : 'running',
      startedAt: writingStart,
      ...(firstFinalizeAfterQuestions && { endedAt: firstFinalizeAfterQuestions }),
    });
  }

  const ordered = steps
    .map((step, order) => ({ step, order }))
    .sort((a, b) => Date.parse(a.step.startedAt) - Date.parse(b.step.startedAt) || a.order - b.order)
    .map(({ step }) => step);
  return collapseRepeatedReads(ordered).map((step, position) => ({ id: step.kind === 'writing' ? 'writing' : `step-${position + 1}`, ...step }));
}

/**
 * Back-to-back reads with the same sentence (the agent reading several pages
 * of one site) become one row that says how many pages; the row runs until
 * the last of them ends.
 */
function collapseRepeatedReads(steps: Step[]): Step[] {
  const rows: { step: Step; pages: number }[] = [];
  for (const step of steps) {
    const last = rows.at(-1);
    if (
      last &&
      step.kind === 'reading' &&
      last.step.kind === 'reading' &&
      last.step.label === step.label &&
      last.step.status !== 'failed' &&
      step.status !== 'failed'
    ) {
      last.pages += 1;
      last.step = {
        ...last.step,
        status: last.step.status === 'running' || step.status === 'running' ? 'running' : 'done',
        ...(step.endedAt && { endedAt: step.endedAt }),
      };
      continue;
    }
    rows.push({ step: { ...step }, pages: 1 });
  }
  return rows.map(({ step, pages }) => (pages > 1 ? { ...step, detail: `${pages} pages` } : step));
}

/** The feed header's phases: under way, done, passed over, or not reached yet. */
export function mktgRunActivityPhases(activity: MktgRunActivity[]): MktgRunActivityPhase[] {
  const phaseOf = (kind: MktgRunActivityKind): number => MKTG_RUN_ACTIVITY_PHASES.findIndex((phase) => phase.kinds.includes(kind));
  const lastReached = Math.max(-1, ...activity.map((step) => phaseOf(step.kind)));
  return MKTG_RUN_ACTIVITY_PHASES.map((phase, position) => {
    const steps = activity.filter((step) => phase.kinds.includes(step.kind));
    let state: MktgRunActivityPhase['state'];
    if (steps.some((step) => step.status === 'running')) {
      state = 'active';
    } else if (steps.length > 0) {
      state = 'done';
    } else {
      state = position < lastReached ? 'skipped' : 'pending';
    }
    return { id: phase.id, label: phase.label, state };
  });
}

/** The short chip label of a question in the stepper ("Vision", "Proof points"). */
export function mktgRunQuestionShortLabel(key: string, label: string): string {
  return MKTG_RUN_QUESTION_SHORT_LABELS[key] ?? label.split(/\s+/).slice(0, 2).join(' ');
}

/** True for any of the kinds the feed knows — for callers narrowing untyped input. */
export function isMktgRunActivityKind(value: string): value is MktgRunActivityKind {
  return (MKTG_RUN_ACTIVITY_KINDS as readonly string[]).includes(value);
}
