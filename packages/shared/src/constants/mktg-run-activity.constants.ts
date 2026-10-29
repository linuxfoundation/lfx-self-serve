// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LINKEDIN_QUESTIONS_CONTRACT, LINKEDIN_FINALIZE_TOOL } from './linkedin-post.constants';
import type { MktgRunActivityKind, MktgRunActivityPhaseDefinition, MktgRunActivityToolDefinition } from '../interfaces';
import { ICP_FINALIZE_TOOL } from './icp.constants';
import { AEO_GEO_FINALIZE_TOOL, AEO_GEO_QUESTIONS_CONTRACT } from './aeo-geo.constants';
import { BOILERPLATES_FINALIZE_TOOL, BOILERPLATES_QUESTIONS_CONTRACT_ID } from './boilerplates.constants';
import { BRAND_KIT_FINALIZE_TOOL, BRAND_KIT_INSPECT_LOGOS_TOOL, BRAND_KIT_QUESTIONS_CONTRACT_ID } from './brand-kit.constants';
import { FAQ_FINALIZE_TOOL, FAQ_QUESTIONS_CONTRACT_ID } from './faq.constants';
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
  webSearchJina: 'web_search_jina_web_search',
  lfxSearchProjects: 'lfx_mcp_search_projects',
  lfxGetProject: 'lfx_mcp_get_project',
  lfxSemanticLayer: 'lfx_mcp_query_lfx_semantic_layer',
  askRequester: FOUNDATION_MESSAGE_ASK_TOOL,
  finalize: FOUNDATION_MESSAGE_FINALIZE_TOOL,
  finalizeBrandKit: BRAND_KIT_FINALIZE_TOOL,
  finalizeBoilerplates: BOILERPLATES_FINALIZE_TOOL,
  finalizeFaq: FAQ_FINALIZE_TOOL,
  finalizeLinkedinPost: LINKEDIN_FINALIZE_TOOL,
  inspectLogos: BRAND_KIT_INSPECT_LOGOS_TOOL,
} as const;

/** Every LFX MCP tool starts with this. */
export const MKTG_RUN_ACTIVITY_LFX_TOOL_PREFIX = 'lfx_mcp_';

/** The agents' finalize tools: the check of the document (the kit, the boilerplates, the FAQ) against its gates. */
export const MKTG_RUN_ACTIVITY_FINALIZE_TOOLS: readonly string[] = [
  MKTG_RUN_ACTIVITY_TOOLS.finalize,
  MKTG_RUN_ACTIVITY_TOOLS.finalizeBrandKit,
  MKTG_RUN_ACTIVITY_TOOLS.finalizeBoilerplates,
  MKTG_RUN_ACTIVITY_TOOLS.finalizeFaq,
  MKTG_RUN_ACTIVITY_TOOLS.finalizeLinkedinPost,
  AEO_GEO_FINALIZE_TOOL,
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
  checkingFaq: 'Checking the FAQ',
  writingFaq: 'Writing the FAQ',
  checkingLinkedinPost: 'Checking the post options',
  writingLinkedinPost: 'Writing three post options',
  writingGeneric: 'Writing',
  checkingGeneric: 'Checking',
} as const;

/** Fixed Member report copy; header phase labels stay shared. */
export const MEMBER_360_ACTIVITY_LABELS = {
  writing: 'Writing the report',
  checking: 'Checking the report',
  questions: MKTG_RUN_ACTIVITY_LABELS.questions,
} as const;
export const MEMBER_360_ACTIVITY_TOOLS: Readonly<Record<string, MktgRunActivityToolDefinition>> = {
  score_member_360: { kind: 'writing', label: MEMBER_360_ACTIVITY_LABELS.writing },
  record_member_actions: { kind: 'writing', label: MEMBER_360_ACTIVITY_LABELS.writing },
  judge_member_slice: { kind: 'writing', label: MEMBER_360_ACTIVITY_LABELS.writing },
  ask_requester: { kind: 'questions', label: MEMBER_360_ACTIVITY_LABELS.questions },
  finalize_member_360: { kind: 'checking', label: MEMBER_360_ACTIVITY_LABELS.checking },
  finalize_member_slice: { kind: 'checking', label: MEMBER_360_ACTIVITY_LABELS.checking },
};

/** The shared requester tool has one fixed sentence for every agent that offers it. */
export const MKTG_RUN_ACTIVITY_QUESTION_TOOLS = { [FOUNDATION_MESSAGE_ASK_TOOL]: { kind: 'questions', label: MKTG_RUN_ACTIVITY_LABELS.questions } } as const;

/** Verified agent-owned tools; shared platform names/prefixes keep one classification path. */
export const MKTG_RUN_ACTIVITY_AGENT_TOOL_TABLES: Readonly<Record<string, Readonly<Record<string, MktgRunActivityToolDefinition>>>> = {
  'brand-kit': {
    ...MKTG_RUN_ACTIVITY_QUESTION_TOOLS,
    [BRAND_KIT_INSPECT_LOGOS_TOOL]: { kind: 'reading', label: MKTG_RUN_ACTIVITY_LABELS.inspectingLogos },
    [BRAND_KIT_FINALIZE_TOOL]: { kind: 'checking', label: MKTG_RUN_ACTIVITY_LABELS.checkingBrandKit, writingLabel: MKTG_RUN_ACTIVITY_LABELS.writingBrandKit },
  },
  'foundation-message': {
    ...MKTG_RUN_ACTIVITY_QUESTION_TOOLS,
    [FOUNDATION_MESSAGE_FINALIZE_TOOL]: { kind: 'checking', label: MKTG_RUN_ACTIVITY_LABELS.checking, writingLabel: MKTG_RUN_ACTIVITY_LABELS.writing },
  },
  boilerplates: {
    ...MKTG_RUN_ACTIVITY_QUESTION_TOOLS,
    [BOILERPLATES_FINALIZE_TOOL]: {
      kind: 'checking',
      label: MKTG_RUN_ACTIVITY_LABELS.checkingBoilerplates,
      writingLabel: MKTG_RUN_ACTIVITY_LABELS.writingBoilerplates,
    },
  },
  faq: {
    ...MKTG_RUN_ACTIVITY_QUESTION_TOOLS,
    membership_tier_prices: { kind: 'lfx', label: MKTG_RUN_ACTIVITY_LABELS.lfxOther },
    [FAQ_FINALIZE_TOOL]: { kind: 'checking', label: MKTG_RUN_ACTIVITY_LABELS.checkingFaq, writingLabel: MKTG_RUN_ACTIVITY_LABELS.writingFaq },
  },
  'linkedin-post': {
    ...MKTG_RUN_ACTIVITY_QUESTION_TOOLS,
    [LINKEDIN_FINALIZE_TOOL]: {
      kind: 'checking',
      label: MKTG_RUN_ACTIVITY_LABELS.checkingLinkedinPost,
      writingLabel: MKTG_RUN_ACTIVITY_LABELS.writingLinkedinPost,
    },
  },
  'aeo-geo': {
    ...MKTG_RUN_ACTIVITY_QUESTION_TOOLS,
    [AEO_GEO_FINALIZE_TOOL]: { kind: 'checking', label: MKTG_RUN_ACTIVITY_LABELS.checking, writingLabel: MKTG_RUN_ACTIVITY_LABELS.writing },
  },
  icp: { [ICP_FINALIZE_TOOL]: { kind: 'checking', label: MKTG_RUN_ACTIVITY_LABELS.checkingGeneric, writingLabel: MKTG_RUN_ACTIVITY_LABELS.writingGeneric } },
  'member-360': MEMBER_360_ACTIVITY_TOOLS,
};

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
  FAQ_QUESTIONS_CONTRACT_ID,
  LINKEDIN_QUESTIONS_CONTRACT,
  AEO_GEO_QUESTIONS_CONTRACT,
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

/** What the starting row says while the agent spins up, one line every few seconds, before its first real step arrives. */
export const MKTG_RUN_ACTIVITY_STARTING_LINES = [
  'Waking the agent up',
  'Handing it your project brief',
  'Pouring it a coffee',
  'Sharpening its pencils',
  'Reading the room',
  'Lining up the sources',
  'Warming up the writing muscles',
  'Almost there: the first step is on its way',
];
/** How long each starting line stays up. */
export const MKTG_RUN_ACTIVITY_LINE_MS = 3500;
