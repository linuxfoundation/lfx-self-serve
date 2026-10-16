// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { MktgRunActivity } from '../interfaces';
import { buildMktgRunActivity, mktgRunActivityPhases, mktgRunActivityReadingLabel, mktgRunQuestionShortLabel } from './mktg-run-activity.utils';

// A live Messaging Document 3.0.0 session (OpenSearch, 15 Oct 2026), trimmed:
// the tool inputs, task metadata and timings as Guild recorded them; every
// tool output, prompt and model text removed. User events are left out, as
// the BFF's getRawEventPayloads drops them.
const fixture = JSON.parse(readFileSync(new URL('./__fixtures__/mktg-run-activity.session.json', import.meta.url), 'utf8')) as {
  events: Record<string, unknown>[];
};
const events = fixture.events;
const payloads = (upTo = events.length): string[] => events.slice(0, upTo).map((event) => JSON.stringify(event));
/** Index of the first event after the questions turn that starts a model call — the answers arrived just before it. */
const afterAnswers = events.findIndex(
  (event, index) =>
    event['type'] === 'llm_start' && events.slice(0, index).some((earlier) => JSON.stringify(earlier).includes('messaging-document-questions/v1'))
);
const labels = (activity: MktgRunActivity[]): string[] => activity.map((step) => step.label);

describe('buildMktgRunActivity — the live feed from a real session', () => {
  it('reads the research in order, in plain sentences, ending with the questions', () => {
    const activity = buildMktgRunActivity(payloads(afterAnswers));

    expect(labels(activity)).toEqual([
      'Reading opensearch.org',
      'Reading linuxfoundation.org/press',
      'Reading opensearch.org/trademark-brand-policy',
      'Reading the opensearch-project/OpenSearch README',
      'Finding OpenSearch in LFX',
      'Reading opensearch.org',
      'Searching the web',
      'Searching the web',
      'Pulling live LFX figures',
      'Reading opensearch.org/announcements',
      'Reading the LFX project record',
      'Preparing a few questions for you',
    ]);
    expect(activity.every((step) => step.status === 'done')).toBe(true);
    expect(activity.find((step) => step.kind === 'search')?.detail).toBe('“Elasticsearch AGPL open source again OpenSearch comparison 2024”');
  });

  it('collapses back-to-back pages of one site into one row that says how many', () => {
    const activity = buildMktgRunActivity(payloads(afterAnswers));
    const site = activity.filter((step) => step.label === 'Reading opensearch.org');
    expect(site.map((step) => step.detail)).toEqual([undefined, '2 pages']);
  });

  it('adds the writing stretch after the answers, running until the check, then the check itself', () => {
    const writing = buildMktgRunActivity(payloads(afterAnswers + 1));
    expect(writing.at(-1)).toMatchObject({ id: 'writing', kind: 'writing', label: 'Writing the document', status: 'running' });

    const whole = buildMktgRunActivity(payloads());
    expect(whole.slice(-2).map((step) => [step.kind, step.label, step.status])).toEqual([
      ['writing', 'Writing the document', 'done'],
      ['checking', 'Checking the document against the template', 'done'],
    ]);
  });

  it('never lets a tool name, an id, a uid or anything a tool returned reach the page', () => {
    const shown = JSON.stringify(buildMktgRunActivity(payloads()));
    for (const leak of [
      'experimental_fetch',
      'web_search_web_search',
      'lfx_mcp',
      'ask_requester',
      'finalize_messaging_document',
      'ui_notify',
      'toolu_',
      'trimmed',
    ]) {
      expect(shown).not.toContain(leak);
    }
    // The LFX record's uid, and the semantic layer's project slug, are inputs the feed must not echo.
    expect(shown).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    expect(shown).not.toContain('opensearch-foundation');
  });

  it('keeps step ids stable as the run appends, so the page never re-renders old rows', () => {
    const early = buildMktgRunActivity(payloads(afterAnswers));
    const late = buildMktgRunActivity(payloads());
    expect(late.slice(0, early.length).map((step) => step.id)).toEqual(early.map((step) => step.id));
  });

  it('shows a tool call still under way as running', () => {
    const running = {
      type: 'runtime_start',
      created_at: '2026-10-16T08:00:00Z',
      task: { entity_type: 'EntTaskTool', id: 't-1', tool_name: 'experimental_fetch_fetch', status: 'RUNNING', created_at: '2026-10-16T08:00:00Z' },
      content: { url: 'https://aaif.io/about' },
    };
    expect(buildMktgRunActivity([JSON.stringify(running)])).toEqual([
      { id: 'step-1', kind: 'reading', label: 'Reading aaif.io/about', status: 'running', startedAt: '2026-10-16T08:00:00Z' },
    ]);
  });

  it('skips a payload that is not JSON and a tool it has no sentence for', () => {
    const unknown = {
      type: 'runtime_start',
      created_at: '2026-10-16T08:00:00Z',
      task: { entity_type: 'EntTaskTool', id: 't-2', tool_name: 'some_new_tool', status: 'DONE' },
      content: {},
    };
    expect(buildMktgRunActivity(['not json', JSON.stringify(unknown)])).toEqual([]);
  });
});

describe('mktgRunActivityReadingLabel', () => {
  it('names GitHub pages by what they are, and other pages by site and section', () => {
    expect(mktgRunActivityReadingLabel('https://github.com/aaif')).toBe('Looking through aaif on GitHub');
    expect(mktgRunActivityReadingLabel('https://api.github.com/orgs/aaif/repos?per_page=100')).toBe('Looking through aaif on GitHub');
    expect(mktgRunActivityReadingLabel('https://github.com/aaif/technical-committee')).toBe('Reading aaif/technical-committee on GitHub');
    expect(mktgRunActivityReadingLabel('https://raw.githubusercontent.com/aaif/foundation/main/README.md')).toBe('Reading the aaif/foundation README');
    expect(mktgRunActivityReadingLabel('https://www.aaif.io/brand')).toBe('Reading aaif.io/brand');
    expect(mktgRunActivityReadingLabel('https://opensearch.org/wp-json/wp/v2/pages/6')).toBe('Reading opensearch.org');
    expect(mktgRunActivityReadingLabel('not a url')).toBe('Reading a page');
  });
});

describe('mktgRunActivityPhases', () => {
  it('marks the phase under way and the ones done, with the web search and LFX as one phase', () => {
    const phases = mktgRunActivityPhases([
      { id: 'step-1', kind: 'reading', label: 'Reading a page', status: 'done', startedAt: '2026-10-16T08:00:00Z' },
      { id: 'step-2', kind: 'search', label: 'Searching the web', status: 'running', startedAt: '2026-10-16T08:00:01Z' },
    ]);
    expect(phases.map((phase) => [phase.label, phase.state])).toEqual([
      ['Reading sources', 'done'],
      ['Searching the web and LFX', 'active'],
      ['Questions', 'pending'],
      ['Writing', 'pending'],
      ['Checking', 'pending'],
    ]);
  });
});

describe('mktgRunQuestionShortLabel', () => {
  it('gives each of the ten questions a short chip label, and any other its first two words', () => {
    expect(mktgRunQuestionShortLabel('tagline_ctas_constraints', 'Tagline, CTAs and constraints')).toBe('Tagline');
    expect(mktgRunQuestionShortLabel('proof_points', 'Proof points to confirm')).toBe('Proof points');
    expect(mktgRunQuestionShortLabel('something_new', 'Something entirely new')).toBe('Something entirely');
  });
});
