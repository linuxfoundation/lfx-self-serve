// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MktgRunActivityKind, MktgRunActivityPhaseDefinition } from '../interfaces';
import { BOILERPLATES_FINALIZE_TOOL, BOILERPLATES_QUESTIONS_CONTRACT_ID } from './boilerplates.constants';
import { BRAND_KIT_FINALIZE_TOOL, BRAND_KIT_INSPECT_LOGOS_TOOL, BRAND_KIT_QUESTIONS_CONTRACT_ID } from './brand-kit.constants';
import { FOUNDATION_MESSAGE_ASK_TOOL, FOUNDATION_MESSAGE_FINALIZE_TOOL, FOUNDATION_MESSAGE_QUESTIONS_CONTRACT_ID } from './foundation-message.constants';

// The live activity feed of an agent run: what the agent is doing while it
// works, built server-side from the session's raw events and shown on the run
// page as a timeline. Every label is a plain sentence written here — never a
// tool name, never anything a tool returned.

/** The feed's kinds, in the order a run moves through them; each one is also a phase of the header. */
export const MKTG_RUN_ACTIVITY_KINDS = ['reading', 'lfx', 'search', 'questions', 'writing', 'checking'] as const;

/**
 * The header's phases, in run order, each grouping the kinds of step it
 * covers: the web search and the LFX lookups are one stretch of research to
 * the requester, so they share a phase.
 */
export const MKTG_RUN_ACTIVITY_PHASES: readonly MktgRunActivityPhaseDefinition[] = [
  { id: 'reading', label: 'Reading sources', kinds: ['reading'] },
  { id: 'research', label: 'Searching the web and LFX', kinds: ['search', 'lfx'] },
  { id: 'questions', label: 'Questions', kinds: ['questions'] },
  { id: 'writing', label: 'Writing', kinds: ['writing'] },
  { id: 'checking', label: 'Checking', kinds: ['checking'] },
];

/** The tools the feed knows, by the name the session records. */
export const MKTG_RUN_ACTIVITY_TOOLS = {
  fetch: 'experimental_fetch_fetch',
  webSearch: 'web_search_web_search',
  lfxSearchProjects: 'lfx_mcp_search_projects',
  lfxGetProject: 'lfx_mcp_get_project',
  lfxSemanticLayer: 'lfx_mcp_query_lfx_semantic_layer',
  askRequester: FOUNDATION_MESSAGE_ASK_TOOL,
  finalize: FOUNDATION_MESSAGE_FINALIZE_TOOL,
  finalizeBrandKit: BRAND_KIT_FINALIZE_TOOL,
  finalizeBoilerplates: BOILERPLATES_FINALIZE_TOOL,
  inspectLogos: BRAND_KIT_INSPECT_LOGOS_TOOL,
} as const;

/** Every LFX MCP tool starts with this. */
export const MKTG_RUN_ACTIVITY_LFX_TOOL_PREFIX = 'lfx_mcp_';

/** The agents' finalize tools: the check of the document (the kit, the boilerplates) against its gates. */
export const MKTG_RUN_ACTIVITY_FINALIZE_TOOLS: readonly string[] = [
  MKTG_RUN_ACTIVITY_TOOLS.finalize,
  MKTG_RUN_ACTIVITY_TOOLS.finalizeBrandKit,
  MKTG_RUN_ACTIVITY_TOOLS.finalizeBoilerplates,
];

/**
 * Tools the agent runs inside its own code rather than through the platform:
 * they appear in the model's responses, not as tool tasks, so the feed reads
 * them from there.
 */
export const MKTG_RUN_ACTIVITY_AGENT_TOOLS: readonly string[] = [
  MKTG_RUN_ACTIVITY_TOOLS.askRequester,
  MKTG_RUN_ACTIVITY_TOOLS.inspectLogos,
  ...MKTG_RUN_ACTIVITY_FINALIZE_TOOLS,
];

/** Tools that never show in the feed: the agent talking to the page, and handing in its output. */
export const MKTG_RUN_ACTIVITY_HIDDEN_TOOLS: readonly string[] = ['ui_notify', 'ui_prompt', '__submit__'];

/** The fixed sentences of the feed. */
export const MKTG_RUN_ACTIVITY_LABELS = {
  readingPage: 'Reading a page',
  searchingWeb: 'Searching the web',
  lfxProjectRecord: 'Reading the LFX project record',
  lfxFigures: 'Pulling live LFX figures',
  lfxOther: 'Checking LFX',
  questions: 'Preparing a few questions for you',
  inspectingLogos: 'Inspecting the logo files',
  checking: 'Checking the framework',
  fixing: 'Fixing what the check found',
  writing: 'Writing the framework',
  checkingBrandKit: 'Checking the document against the template',
  writingBrandKit: 'Writing the document',
  checkingBoilerplates: 'Checking the boilerplates against their word limits',
  writingBoilerplates: 'Writing the boilerplates',
} as const;

/** Platform task statuses that mean the tool finished, and those that mean it did not. */
export const MKTG_RUN_ACTIVITY_DONE_STATUSES: readonly string[] = ['DONE', 'COMPLETED', 'SUCCEEDED', 'SUCCESS'];
export const MKTG_RUN_ACTIVITY_FAILED_STATUSES: readonly string[] = ['FAILED', 'ERROR', 'ERRORED', 'CANCELLED', 'CANCELED', 'TIMED_OUT', 'TIMEOUT', 'ABORTED'];

/** Longest search query shown as a step's detail, and longest project name in a label. */
export const MKTG_RUN_ACTIVITY_DETAIL_MAX_CHARS = 120;
export const MKTG_RUN_ACTIVITY_NAME_MAX_CHARS = 60;

/** Longest path segment kept in a "Reading <host>/<segment>" label. */
export const MKTG_RUN_ACTIVITY_PATH_SEGMENT_MAX_CHARS = 32;

/** Rows the feed shows before the older ones fold behind "Show all N steps". */
export const MKTG_RUN_ACTIVITY_VISIBLE_ROWS = 8;

/** Font Awesome icon per kind, as literal class names so Tailwind's content scan keeps them. */
export const MKTG_RUN_ACTIVITY_ICONS: Record<MktgRunActivityKind, string> = {
  reading: 'fa-light fa-globe',
  lfx: 'fa-light fa-database',
  search: 'fa-light fa-magnifying-glass',
  questions: 'fa-light fa-sparkles',
  writing: 'fa-light fa-pen-nib',
  checking: 'fa-light fa-circle-check',
};

/** Path segments that say nothing about a page ("wp-json", "api") — a "Reading <host>" label drops them. */
export const MKTG_RUN_ACTIVITY_OPAQUE_PATH_SEGMENTS: readonly string[] = ['wp-json', 'api', 'index.php', 'index.html'];

/** The contract ids a questions turn carries, one per agent that asks — where the writing stretch of a run begins. */
export const MKTG_RUN_ACTIVITY_QUESTIONS_MARKERS: readonly string[] = [
  FOUNDATION_MESSAGE_QUESTIONS_CONTRACT_ID,
  BRAND_KIT_QUESTIONS_CONTRACT_ID,
  BOILERPLATES_QUESTIONS_CONTRACT_ID,
];

/**
 * Most words of a question's label the stepper's chip shows. The agent's
 * labels come from its question ids ("Ranked goals", "Words to avoid") and are
 * shown whole up to this length; a longer one is cut, never on a connector.
 */
export const MKTG_RUN_QUESTION_CHIP_WORDS = 3;

/** Words a chip label never ends on: a cut there reads as a broken phrase ("Words to"). */
export const MKTG_RUN_QUESTION_CHIP_TRAILING_STOPWORDS: readonly string[] = [
  'a',
  'an',
  'and',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
];
