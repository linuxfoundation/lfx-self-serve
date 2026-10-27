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
  MKTG_RUN_ACTIVITY_QUESTIONS_MARKERS,
  MKTG_RUN_ACTIVITY_TOOLS,
  MKTG_RUN_QUESTION_CHIP_TRAILING_STOPWORDS,
  MKTG_RUN_QUESTION_CHIP_WORDS,
} from '../constants/mktg-run-activity.constants';
import { LINKEDIN_QUESTIONS_CONTRACT } from '../constants/linkedin-post.constants';
import { BOILERPLATES_QUESTIONS_CONTRACT_ID } from '../constants/boilerplates.constants';
import { BRAND_KIT_QUESTIONS_CONTRACT_ID } from '../constants/brand-kit.constants';
import { FAQ_QUESTIONS_CONTRACT_ID } from '../constants/faq.constants';
import type { MktgRunActivity, MktgRunActivityKind, MktgRunActivityPhase, MktgRunActivityStatus } from '../interfaces';
import { isMktgReasoningEvent } from './mktg-session-event.utils';

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

/** Research calls prevent a mixed finalize response from authorizing the asset handoff. */
function isResearchTool(toolName: string): boolean {
  if (toolName === MKTG_RUN_ACTIVITY_TOOLS.inspectLogos) return true;
  if (MKTG_RUN_ACTIVITY_HIDDEN_TOOLS.includes(toolName) || MKTG_RUN_ACTIVITY_AGENT_TOOLS.includes(toolName)) return false;
  return toolName === MKTG_RUN_ACTIVITY_TOOLS.fetch || toolName === MKTG_RUN_ACTIVITY_TOOLS.webSearch || toolName.startsWith(MKTG_RUN_ACTIVITY_LFX_TOOL_PREFIX);
}

/** Tool names in one model response, for classification only — never feed labels. */
function toolCalls(event: UnknownRecord): string[] {
  const body = asString(event['body']) || JSON.stringify(event['content'] ?? '');
  const calls: string[] = [];
  const pattern = /"type"\s*:\s*"tool_use"\s*,\s*"id"\s*:\s*"[^"]*"\s*,\s*"name"\s*:\s*"([^"]+)"/g;
  for (let match = pattern.exec(body); match !== null; match = pattern.exec(body)) {
    calls.push(match[1]);
  }
  return calls;
}

/** True when an agent output event carries the questions turn. */
function isQuestionsTurn(event: UnknownRecord): boolean {
  const type = asString(event['type']);
  if (type !== 'agent_notification_message' && type !== 'agent_notification_progress') {
    return false;
  }
  const content = JSON.stringify(event['content'] ?? '');
  return MKTG_RUN_ACTIVITY_QUESTIONS_MARKERS.some((marker) => content.includes(marker));
}

/**
 * The run's activity so far, oldest first, from the session's raw event
 * payloads (chronological). Pure: the same payloads always give the same
 * feed, and ids are positional, so they stay stable while the run appends.
 */
export function buildMktgRunActivity(payloads: string[]): MktgRunActivity[] {
  const events = payloads.map(parseEvent).filter((event): event is UnknownRecord => event !== null && !isMktgReasoningEvent(event));

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
  let modelStart = '';
  let firstWritingCheck = '';
  /**
   * The run's own writing and first-check sentences: the framework's, until
   * the run shows it is the Brand Kit's (its logo tool, its finalize tool or
   * its questions turn), the Boilerplates' or the FAQ's (its finalize tool or
   * its questions turn). The first agent the run shows is the one it stays.
   */
  let runLabels: { checking: string; writing: string } = { checking: MKTG_RUN_ACTIVITY_LABELS.checking, writing: MKTG_RUN_ACTIVITY_LABELS.writing };
  let identified = false;
  const identify = (checking: string, writing: string): void => {
    if (!identified) {
      identified = true;
      runLabels = { checking, writing };
    }
  };
  const identifyBrandKit = (): void => identify(MKTG_RUN_ACTIVITY_LABELS.checkingBrandKit, MKTG_RUN_ACTIVITY_LABELS.writingBrandKit);
  const identifyBoilerplates = (): void => identify(MKTG_RUN_ACTIVITY_LABELS.checkingBoilerplates, MKTG_RUN_ACTIVITY_LABELS.writingBoilerplates);
  const identifyFaq = (): void => identify(MKTG_RUN_ACTIVITY_LABELS.checkingFaq, MKTG_RUN_ACTIVITY_LABELS.writingFaq);
  const identifyLinkedin = (): void => identify(MKTG_RUN_ACTIVITY_LABELS.checkingLinkedinPost, MKTG_RUN_ACTIVITY_LABELS.writingLinkedinPost);
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

    if (type === 'llm_start') {
      modelStart = createdAt;
      if (questionsAt >= 0 && !writingStart) writingStart = createdAt;
      continue;
    }

    if (type === 'llm_done') {
      const tools = toolCalls(event);
      const stillResearching = tools.some(isResearchTool);
      const asksQuestions = tools.includes(MKTG_RUN_ACTIVITY_TOOLS.askRequester);
      for (const tool of tools) {
        if (!MKTG_RUN_ACTIVITY_AGENT_TOOLS.includes(tool)) continue;
        let step: Step;
        if (tool === MKTG_RUN_ACTIVITY_TOOLS.askRequester) {
          step = { kind: 'questions', label: MKTG_RUN_ACTIVITY_LABELS.questions, status: 'running', startedAt: createdAt };
        } else if (tool === MKTG_RUN_ACTIVITY_TOOLS.inspectLogos) {
          // The Brand Kit decodes the uploaded artwork inside the agent: reading, like a fetched page.
          identifyBrandKit();
          step = { kind: 'reading', label: MKTG_RUN_ACTIVITY_LABELS.inspectingLogos, status: 'running', startedAt: createdAt };
        } else {
          // Mixed research/questions calls cannot authorize the handoff, even
          // when they also name finalize. Wait for an unambiguous completion.
          if (stillResearching || asksQuestions) continue;
          if (!writingStart) writingStart = modelStart || createdAt;
          finalizeCount += 1;
          if (tool === MKTG_RUN_ACTIVITY_TOOLS.finalizeBrandKit) {
            identifyBrandKit();
          } else if (tool === MKTG_RUN_ACTIVITY_TOOLS.finalizeBoilerplates) {
            identifyBoilerplates();
          } else if (tool === MKTG_RUN_ACTIVITY_TOOLS.finalizeFaq) {
            identifyFaq();
          } else if (tool === MKTG_RUN_ACTIVITY_TOOLS.finalizeLinkedinPost) {
            identifyLinkedin();
          }
          if (writingStart && !firstWritingCheck) {
            firstWritingCheck = createdAt;
          }
          step = {
            kind: 'checking',
            label: finalizeCount === 1 ? runLabels.checking : MKTG_RUN_ACTIVITY_LABELS.fixing,
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
      const content = JSON.stringify(event['content'] ?? '');
      if (content.includes(BRAND_KIT_QUESTIONS_CONTRACT_ID)) {
        identifyBrandKit();
      } else if (content.includes(BOILERPLATES_QUESTIONS_CONTRACT_ID)) {
        identifyBoilerplates();
      } else if (content.includes(FAQ_QUESTIONS_CONTRACT_ID)) {
        identifyFaq();
      } else if (content.includes(LINKEDIN_QUESTIONS_CONTRACT)) {
        identifyLinkedin();
      }
    }
  }

  // After questions, answers start writing as before. Without questions, only
  // an observed finalize confirms writing, retroactively for the feed.
  if (writingStart) {
    steps.push({
      kind: 'writing',
      label: runLabels.writing,
      status: firstWritingCheck ? 'done' : 'running',
      startedAt: writingStart,
      ...(firstWritingCheck && { endedAt: firstWritingCheck }),
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

/**
 * The short chip label of a question in the stepper: the label itself when it
 * has at most {@link MKTG_RUN_QUESTION_CHIP_WORDS} words ("Words to avoid"),
 * else its first words without a trailing connector ("Proof points to
 * confirm" → "Proof points"). The hand test of 18 Oct showed "Words to".
 */
export function mktgRunQuestionShortLabel(label: string): string {
  const words = label
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '');
  if (words.length <= MKTG_RUN_QUESTION_CHIP_WORDS) {
    return words.join(' ');
  }
  const cut = words.slice(0, MKTG_RUN_QUESTION_CHIP_WORDS);
  while (cut.length > 1 && MKTG_RUN_QUESTION_CHIP_TRAILING_STOPWORDS.includes(cut[cut.length - 1].toLowerCase().replace(/[^a-z]/g, ''))) {
    cut.pop();
  }
  return cut.join(' ').replace(/[,;:]$/, '');
}

/** True for any of the kinds the feed knows — for callers narrowing untyped input. */
export function isMktgRunActivityKind(value: string): value is MktgRunActivityKind {
  return (MKTG_RUN_ACTIVITY_KINDS as readonly string[]).includes(value);
}
