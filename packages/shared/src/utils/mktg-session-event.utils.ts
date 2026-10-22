// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Reads one raw Guild session event for what the AGENT said and what its
// TOOLS returned, told apart by where each sits in the event. The agents
// fetch user-supplied links and research the open web themselves, and every
// page they read comes back as a tool result in the same event stream — so a
// consumer that scans whole payloads for a contract id would take a block a
// third-party page planted for the agent's own. Platform-neutral: no hashing,
// no validation; callers validate what comes out.
//
// Shapes read (what Guild records; marketing-os-agents guild skill, "Where
// the envelope is"): an `llm_start` event's `payload.messages` is the full
// Anthropic request — `assistant` messages with `text` and `tool_use` blocks,
// `user` messages with `tool_result` blocks keyed by `tool_use_id` — and an
// `agent_notification_message` carries the runtime's output as
// `content.data`. The SDK's persisted transcript parts (`tool-call` /
// `tool-result` with `toolCallId`, `toolName`, `output`) are read the same
// way, in case an event carries them instead. A platform tool's own events
// (`runtime_start` with the tool's input, `runtime_done` with its output —
// the fetched page itself) are never entered: a page that is JSON would
// otherwise be walked like a transcript, and a call-and-result pair written
// into it would pass for the agent's. Inside a transcript, the readers only
// ever descend through message and content wrappers; a block is read for
// what it is (a text, a call, a result) and never entered, since its body
// is prose, a tool's input or a tool's output — all of which can carry a
// fetched page, quoted or failed, and none of which is the transcript.

import {
  MKTG_ENVELOPE_EXTRACTION_MAX_DEPTH,
  MKTG_SESSION_AGENT_OUTPUT_EVENT_TYPES,
  MKTG_SESSION_PLATFORM_TOOL_EVENT_TYPES,
  MKTG_SESSION_EVENTS_TRUNCATED,
  MKTG_SESSION_TURN_STARTED,
  MKTG_SESSION_REASONING_CONTENT_TYPE,
} from '../constants/mktg-run.constants';
import type { MktgSessionOutcome } from '../interfaces/mktg-document-run.interface';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A string that looks like a JSON object or array, parsed; undefined otherwise. */
function parseEmbeddedJson(value: string): unknown {
  const trimmed = value.trimStart();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

/** Ignore reasoning before walking any content, including embedded transcript-shaped JSON. */
export function isMktgReasoningEvent(event: unknown): boolean {
  return isRecord(event) && isRecord(event['content']) && event['content']['type'] === MKTG_SESSION_REASONING_CONTENT_TYPE;
}

/** Only agent events worth reading, never a platform tool's input/output or model reasoning. */
function readableEvent(payload: string): unknown {
  const event = parseEmbeddedJson(payload);
  if (isMktgReasoningEvent(event) || (isRecord(event) && (MKTG_SESSION_PLATFORM_TOOL_EVENT_TYPES as readonly unknown[]).includes(event['type']))) {
    return undefined;
  }
  return event;
}

/**
 * Walk a parsed event depth-first, calling `visit` on every record. A visit
 * returning false stops the descent below that record; strings that are JSON
 * themselves (the `payload` of a stream event) are parsed and walked too.
 */
function walk(value: unknown, depth: number, visit: (record: UnknownRecord) => boolean): void {
  if (depth > MKTG_ENVELOPE_EXTRACTION_MAX_DEPTH) {
    return;
  }
  if (typeof value === 'string') {
    const embedded = parseEmbeddedJson(value);
    if (embedded !== undefined) {
      walk(embedded, depth + 1, visit);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => walk(entry, depth + 1, visit));
    return;
  }
  if (!isRecord(value) || !visit(value)) {
    return;
  }
  Object.values(value).forEach((child) => walk(child, depth + 1, visit));
}

function isToolResultBlock(record: UnknownRecord): boolean {
  return record['type'] === 'tool_result' || record['type'] === 'tool-result';
}

function isToolCallBlock(record: UnknownRecord): boolean {
  return record['type'] === 'tool_use' || record['type'] === 'tool-call';
}

/**
 * A message whose `content` is one string rather than blocks: the
 * requester's own text, or prose the model wrote as a whole turn. Prose is
 * never a transcript, however it is shaped.
 */
function isProseMessage(record: UnknownRecord): boolean {
  return typeof record['role'] === 'string' && typeof record['content'] === 'string';
}

/** The runtime's output (the agent's final text, a progress notice): what the model wrote, whatever its shape. */
function isAgentOutput(record: UnknownRecord): boolean {
  return (MKTG_SESSION_AGENT_OUTPUT_EVENT_TYPES as readonly unknown[]).includes(record['type']);
}

/** The text of a tool result's content: a string, the joined text blocks, or the JSON of anything else. */
function toolResultText(content: unknown): string | null {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    const texts = content.filter((block): block is UnknownRecord => isRecord(block) && block['type'] === 'text' && typeof block['text'] === 'string');
    return texts.length === 0 ? null : texts.map((block) => block['text'] as string).join('');
  }
  if (isRecord(content)) {
    // The SDK wraps a recorded output as { type: 'json' | 'text', value }; an error output is never a result.
    if (content['type'] === 'error-text' || content['type'] === 'error-json') {
      return null;
    }
    if ((content['type'] === 'json' || content['type'] === 'text') && 'value' in content) {
      return toolResultText(content['value']);
    }
    return JSON.stringify(content);
  }
  return null;
}

/**
 * The texts the AGENT itself wrote in one raw session event: assistant `text`
 * blocks (the model's own turns, the `ui_prompt` it pauses on included) and
 * the runtime's text output (`agent_notification_message` content). Nothing
 * inside a `tool_result` block or a `user`-role message is ever returned —
 * that is where fetched pages, search results and the requester's own
 * messages sit — nor the input of a tool call, which the agent fills from
 * what it has read, nor anything in a platform tool's own event. A payload
 * that is not JSON yields nothing: free text is never attributed to the
 * agent.
 */
export function extractMktgAgentTexts(payload: string): string[] {
  const event = readableEvent(payload);
  if (event === undefined) {
    return [];
  }
  const texts: string[] = [];
  walk(event, 0, (record) => {
    if (isToolResultBlock(record) || isToolCallBlock(record) || record['role'] === 'user') {
      return false;
    }
    if (record['type'] === 'agent_notification_message' && typeof record['content'] === 'string') {
      texts.push(record['content']);
      return false;
    }
    if (record['type'] === 'text') {
      // An Anthropic text block ({ type: 'text', text }) or a notification's content ({ type: 'text', data }).
      const text = typeof record['text'] === 'string' ? record['text'] : record['data'];
      if (typeof text === 'string') {
        texts.push(text);
      }
      return false;
    }
    return true;
  });
  return texts;
}

/**
 * The result texts of every successful call to `toolName` recorded in one raw
 * session event, in order. A result is paired with its call by id — Anthropic
 * `tool_use.id` / `tool_result.tool_use_id`, or the SDK's `toolCallId` — so a
 * result block that no call of that tool explains is not returned, and an
 * error result (`is_error`, an SDK error output) never is. Every `llm_start`
 * event repeats the whole request so far, so the call and its result sit in
 * the same event; the same result found in later events is returned again
 * and callers de-duplicate by content (the latest valid one wins). A
 * platform tool's own event is never read: its content is what the tool
 * returned, where a pair of blocks shaped like a call and its result proves
 * nothing. Nor is a pair read out of the BODY of any block — a text block,
 * a call's input (any tool's), a result's content (any tool's, failed or
 * not) or a message written as one string: each is read for what it is and
 * never entered, so a page the agent quoted, passed to a tool, or had a
 * fetch fail on cannot plant the pair where only a transcript block counts.
 * Nor is the runtime's output (`agent_notification_message`, a progress
 * notice) ever entered: it is what the model wrote, so an envelope or a
 * call-and-result pair it spells out is not the finalize tool's result.
 */
export function extractMktgToolResults(payload: string, toolName: string): string[] {
  return extractToolResultEntries(payload, toolName).map((result) => result.text);
}

/** Agent text from the current queued turn only; old assistant text echoed by a transcript is not a new question or refusal. */
export function extractMktgCurrentTurnAgentTexts(payloads: string[]): string[] {
  const previous = new Set<string>();
  const previousEvents = new Set<string>();
  const currentEvents = new Set<string>();
  let current: string[] = [];
  for (const payload of payloads) {
    const event = parseEmbeddedJson(payload);
    if (isRecord(event) && event['type'] === MKTG_SESSION_TURN_STARTED) {
      current.forEach((text) => previous.add(text));
      currentEvents.forEach((identity) => previousEvents.add(identity));
      currentEvents.clear();
      current = [];
    } else {
      const texts = extractMktgAgentTexts(payload);
      let identity: string | undefined;
      if (isRecord(event) && event['type'] === 'agent_notification_message') {
        if (typeof event['id'] === 'string' && event['id']) {
          identity = `id:${event['id']}`;
        } else if (typeof event['created_at'] === 'string' && event['created_at']) {
          identity = JSON.stringify([event['created_at'], texts]);
        }
      }
      if (identity) {
        if (!previousEvents.has(identity)) {
          current.push(...texts);
          currentEvents.add(identity);
        }
      } else {
        // Transcript snapshots echo old text; their outer id/time is not a new assistant reply.
        current.push(...texts.filter((text) => !previous.has(text)));
      }
    }
  }
  return current;
}

/** An idle runtime fails only when a real final reply follows its latest unanswered questions (or no questions exist). */
export function mktgFailureAfterQuestions(payloads: string[], isQuestions: (text: string) => boolean): MktgSessionOutcome | null {
  const outcome = getMktgSessionOutcome(payloads);
  if (!outcome.ended || isQuestions(outcome.replyText)) {
    return null;
  }
  const texts = extractMktgCurrentTurnAgentTexts(payloads).map((text) => text.trim());
  const questionsIndex = texts.reduce((latest, text, index) => (isQuestions(text) ? index : latest), -1);
  if (!outcome.replyText) {
    return questionsIndex < 0 ? outcome : null;
  }
  return questionsIndex < 0 || texts.lastIndexOf(outcome.replyText) > questionsIndex ? outcome : null;
}

/** Latest queued turn only: transcript replays of earlier finalize call ids cannot finish a follow-up. */
export function extractMktgCurrentTurnToolResults(payloads: string[], toolName: string): string[] {
  const priorCallIds = new Set<string>();
  let current: { id: string; text: string }[] = [];
  for (const payload of payloads) {
    const event = parseEmbeddedJson(payload);
    if (isRecord(event) && event['type'] === MKTG_SESSION_TURN_STARTED) {
      current.forEach((result) => priorCallIds.add(result.id));
      current = [];
    } else {
      current.push(...extractToolResultEntries(payload, toolName).filter((result) => !priorCallIds.has(result.id)));
    }
  }
  return current.map((result) => result.text);
}

function extractToolResultEntries(payload: string, toolName: string): { id: string; text: string }[] {
  const event = readableEvent(payload);
  if (event === undefined) {
    return [];
  }
  const callIds = new Set<string>();
  const results: { id: string; text: string }[] = [];
  walk(event, 0, (record) => {
    if (isProseMessage(record) || record['type'] === 'text' || isAgentOutput(record)) {
      return false;
    }
    if (isToolCallBlock(record)) {
      const id = record['type'] === 'tool_use' ? record['id'] : record['toolCallId'];
      const name = record['type'] === 'tool_use' ? record['name'] : record['toolName'];
      if (name === toolName && typeof id === 'string') {
        callIds.add(id);
      }
      return false;
    }
    if (isToolResultBlock(record)) {
      const id = record['type'] === 'tool_result' ? record['tool_use_id'] : record['toolCallId'];
      const output = record['type'] === 'tool_result' ? record['content'] : record['output'];
      if (typeof id === 'string' && record['is_error'] !== true) {
        const text = toolResultText(output);
        if (text !== null) {
          results.push({ id, text });
        }
      }
      return false;
    }
    return true;
  });
  return results.filter((result) => callIds.has(result.id));
}

/**
 * Only an agent runtime completion with no pending task ends a turn. Queued
 * turns, newer runtime/LLM work and capped pages cannot prove completion.
 * Reads root event metadata only; tool/user bodies cannot forge completion.
 */
export function getMktgSessionOutcome(payloads: string[]): MktgSessionOutcome {
  const active = new Set<string>();
  let ended = false;
  let awaitingRuntime = false;
  let replyText = '';
  for (const payload of payloads) {
    const event = parseEmbeddedJson(payload);
    if (!isRecord(event) || isMktgReasoningEvent(event)) {
      continue;
    }
    if (event['type'] === MKTG_SESSION_EVENTS_TRUNCATED) {
      return { ended: false, replyText };
    }
    if (event['type'] === MKTG_SESSION_TURN_STARTED) {
      ended = false;
      awaitingRuntime = true;
      replyText = '';
      continue;
    }
    const task = isRecord(event['task']) ? event['task'] : null;
    const id = task?.['id'];
    const agent = task?.['entity_type'] === 'EntTaskAgent';
    if (event['type'] === 'runtime_start' && typeof id === 'string') {
      active.add(id);
      ended = false;
      if (agent) {
        awaitingRuntime = false;
        replyText = '';
      }
    } else if (event['type'] === 'runtime_done' && typeof id === 'string') {
      active.delete(id);
      if (agent && !awaitingRuntime) {
        ended = true;
      }
    } else if (event['type'] === 'llm_start') {
      ended = false;
    }
    if (event['type'] === 'agent_notification_message') {
      const content = event['content'];
      if (typeof content === 'string') {
        replyText = content.trim();
      } else if (isRecord(content) && content['type'] === 'text' && typeof content['data'] === 'string') {
        replyText = content['data'].trim();
      }
    }
  }
  return { ended: ended && !awaitingRuntime && active.size === 0, replyText };
}
