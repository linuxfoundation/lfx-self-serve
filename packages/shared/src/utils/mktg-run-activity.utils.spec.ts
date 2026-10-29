// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { MKTG_RUN_ACTIVITY_HIDDEN_TOOLS, MKTG_RUN_ACTIVITY_TOOLS, MKTG_RUN_ACTIVITY_AGENT_TOOL_TABLES } from '../constants/mktg-run-activity.constants';
import { agentActivityReplay } from './__fixtures__/agent-activity.fixture';
import { MEMBER_360_ACTIVITY_LABELS, MEMBER_360_ACTIVITY_TOOLS } from '../constants/member-360.constants';
import { member360ActivityReplay } from './__fixtures__/member-360-activity.fixture';
import { noQuestionsActivityPayloads } from './__fixtures__/mktg-run-activity.no-questions';
import type { MktgRunActivity } from '../interfaces';
import { AEO_GEO_FINALIZE_TOOL } from '../constants/aeo-geo.constants';
import { aeoGeoQuestionsEventFixture } from './aeo-geo.fixture';
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
    event['type'] === 'llm_start' && events.slice(0, index).some((earlier) => JSON.stringify(earlier).includes('messaging-framework-questions/v1'))
);
const labels = (activity: MktgRunActivity[]): string[] => activity.map((step) => step.label);

it('does not let reasoning MIME create a questions step or leak into the activity feed', () => {
  const reasoning = JSON.stringify({
    type: 'agent_notification_progress',
    created_at: '2026-10-19T10:00:00Z',
    content: { type: 'application/guild-reasoning-progress', data: 'messaging-framework-questions/v1 Private reasoning' },
  });
  expect(buildMktgRunActivity([reasoning])).toEqual([]);
  expect(buildMktgRunActivity([...payloads(), reasoning])).toEqual(buildMktgRunActivity(payloads()));
});

describe('every registered agent advances from event evidence', () => {
  it.each(Object.keys(MKTG_RUN_ACTIVITY_AGENT_TOOL_TABLES))(
    'replays the synthetic %s real-tool sequence through Checking before root completion',
    (agentKey) => {
      const replay = agentActivityReplay(agentKey);
      const table = MKTG_RUN_ACTIVITY_AGENT_TOOL_TABLES[agentKey];
      const pending = buildMktgRunActivity(replay.slice(0, -1));
      const kinds = pending.map((step) => step.kind);
      expect(kinds).toContain('reading');
      expect(kinds).toContain('lfx');
      expect(kinds).toContain('search');
      expect(kinds.indexOf('writing')).toBeLessThan(kinds.indexOf('checking'));
      expect(pending.filter((step) => step.kind === 'writing')).toHaveLength(1);
      expect(pending.find((step) => step.kind === 'writing')?.status).toBe('done');
      expect(pending.at(-1)).toMatchObject({ kind: 'checking', status: 'running' });
      expect(mktgRunActivityPhases(pending).find((phase) => phase.id === 'checking')?.state).toBe('active');
      expect(kinds.includes('questions')).toBe(Object.values(table).some((tool) => tool.kind === 'questions'));
      const complete = buildMktgRunActivity(replay);
      expect(complete.at(-1)?.status).toBe('done');
      for (const name of Object.keys(table)) expect(JSON.stringify(complete)).not.toContain(name);
    }
  );
  it.each(Object.keys(MKTG_RUN_ACTIVITY_AGENT_TOOL_TABLES))('maps %s finalize from a platform tool_start without reading its arguments', (agentKey) => {
    const table = MKTG_RUN_ACTIVITY_AGENT_TOOL_TABLES[agentKey];
    const finalize = Object.entries(table).find(([, definition]) => definition.kind === 'checking');
    if (!finalize) throw new Error('Missing synthetic finalize mapping');
    const activity = buildMktgRunActivity([
      JSON.stringify({ type: 'llm_start', created_at: '2026-10-29T10:00:00Z' }),
      JSON.stringify({ type: 'tool_start', name: finalize[0], created_at: '2026-10-29T10:00:02Z', input: { note: 'PRIVATE-FIXTURE-SENTINEL' } }),
    ]);
    expect(activity.map((step) => [step.kind, step.status])).toEqual([
      ['writing', 'done'],
      ['checking', 'running'],
    ]);
    expect(activity.at(-1)?.label).toBe(finalize[1].label);
    expect(JSON.stringify(activity)).not.toContain('PRIVATE-FIXTURE');
  });
  it('keeps prompt-driven ICP writing grounded in its model turn when finalize is its first tool', () => {
    const activity = buildMktgRunActivity([
      JSON.stringify({ type: 'llm_start', created_at: '2026-10-29T10:00:00Z' }),
      JSON.stringify({
        type: 'llm_done',
        created_at: '2026-10-29T10:00:02Z',
        body: JSON.stringify({ type: 'tool_use', id: 'icp', name: 'finalize_icp_document' }),
      }),
    ]);
    expect(activity).toEqual([
      { id: 'writing', kind: 'writing', label: 'Writing', status: 'done', startedAt: '2026-10-29T10:00:00Z', endedAt: '2026-10-29T10:00:02Z' },
      { id: 'step-2', kind: 'checking', label: 'Checking', status: 'running', startedAt: '2026-10-29T10:00:02Z' },
    ]);
  });
  it.each(['experimental_fetch_fetch', 'web_search_jina_web_search', 'lfx_mcp_get_project'])(
    'advances unknown tool work after %s with a fixed generic label',
    (researchTool) => {
      const activity = buildMktgRunActivity([
        JSON.stringify({
          type: 'runtime_start',
          created_at: '2026-10-29T10:00:00Z',
          task: { id: 'research', entity_type: 'EntTaskTool', tool_name: researchTool, status: 'DONE' },
        }),
        JSON.stringify({ type: 'tool_start', created_at: '2026-10-29T10:00:01Z', name: 'unknown_synthetic_work', input: { note: 'PRIVATE-FIXTURE-SENTINEL' } }),
        JSON.stringify({
          type: 'llm_done',
          created_at: '2026-10-29T10:00:02Z',
          body: JSON.stringify({ type: 'tool_use', id: 'future', name: 'finalize_future_agent', input: { note: 'PRIVATE-FIXTURE-SENTINEL' } }),
        }),
      ]);
      expect(activity.filter((step) => step.kind === 'writing' || step.kind === 'checking').map((step) => [step.label, step.status])).toEqual([
        ['Writing', 'done'],
        ['Checking', 'running'],
      ]);
      expect(JSON.stringify(activity)).not.toMatch(/PRIVATE-FIXTURE|unknown_synthetic_work|finalize_future_agent/);
    }
  );
  it('does not turn prose or hidden UI tools into generic Writing evidence', () => {
    const activity = buildMktgRunActivity([
      JSON.stringify({ type: 'agent_notification_progress', content: { type: 'text', data: 'Writing checking finalize_the_document' } }),
      JSON.stringify({ type: 'tool_start', name: 'ui_notify', created_at: '2026-10-29T10:00:00Z' }),
      JSON.stringify({ type: 'tool_start', name: 'unknown_before_research', created_at: '2026-10-29T10:00:01Z' }),
    ]);
    expect(activity).toEqual([]);
  });
  it.each(['lfx_mcp_search_members', 'lfx_mcp_get_member_membership', 'lfx_mcp_read_lfx_standard_metrics_guidance', 'lfx_mcp_query_lfx_standard_metrics'])(
    'uses the prefix rule for %s',
    (name) => {
      expect(buildMktgRunActivity([JSON.stringify({ type: 'tool_start', name, created_at: '2026-10-29T10:00:00Z', status: 'DONE' })])[0]).toMatchObject({
        kind: 'lfx',
      });
    }
  );
  it.each([false, true])('keeps mixed FAQ price lookup/finalize in research (explicit table=%s)', (explicit) => {
    const table = explicit ? MKTG_RUN_ACTIVITY_AGENT_TOOL_TABLES['faq'] : undefined;
    const mixed = JSON.stringify({
      type: 'llm_done',
      created_at: '2026-10-29T10:00:02Z',
      body: JSON.stringify([
        { type: 'tool_use', id: 'price', name: 'membership_tier_prices' },
        { type: 'tool_use', id: 'premature-finalize', name: 'finalize_faq' },
      ]),
    });
    const prefix = [JSON.stringify({ type: 'llm_start', created_at: '2026-10-29T10:00:01Z' }), mixed];
    const researching = buildMktgRunActivity(prefix, table);
    expect(researching).toEqual([expect.objectContaining({ kind: 'lfx', status: 'running' })]);
    expect(researching.some((step) => step.kind === 'writing' || step.kind === 'checking')).toBe(false);
    const finalized = buildMktgRunActivity(
      [
        ...prefix,
        JSON.stringify({ type: 'llm_done', created_at: '2026-10-29T10:00:03Z', body: JSON.stringify({ type: 'tool_use', id: 'final', name: 'finalize_faq' }) }),
      ],
      table
    );
    expect(finalized.find((step) => step.kind === 'lfx')?.status).toBe('done');
    expect(finalized.find((step) => step.kind === 'writing')?.status).toBe('done');
    expect(finalized.at(-1)).toMatchObject({ kind: 'checking', status: 'running' });
  });
  it('shows FAQ price lookups as LFX and Jina searches without sending their query', () => {
    const activity = buildMktgRunActivity([
      JSON.stringify({
        type: 'llm_done',
        created_at: '2026-10-29T10:00:00Z',
        body: JSON.stringify({ type: 'tool_use', id: 'price', name: 'membership_tier_prices' }),
      }),
      JSON.stringify({
        type: 'tool_start',
        name: 'web_search_jina_web_search',
        created_at: '2026-10-29T10:00:01Z',
        content: { query: 'PRIVATE-FIXTURE-SENTINEL' },
      }),
    ]);
    expect(activity.map((step) => step.kind)).toEqual(['lfx', 'search']);
    expect(JSON.stringify(activity)).not.toContain('PRIVATE-FIXTURE');
  });
});

describe('Member 360 event-backed activity', () => {
  const local = (name: string, second = 1) =>
    JSON.stringify({
      type: 'llm_done',
      created_at: `2026-10-29T10:00:0${second}Z`,
      body: JSON.stringify({ type: 'tool_use', id: 'synthetic', name, input: { private: 'do-not-display' } }),
    });
  it('starts Writing at score_member_360, never earlier model or English prose', () => {
    const before = [
      JSON.stringify({ type: 'llm_start', created_at: '2026-10-29T10:00:00Z' }),
      JSON.stringify({ type: 'agent_notification_progress', content: { type: 'text', data: 'Writing and checking the report' } }),
    ];
    expect(buildMktgRunActivity(before, MEMBER_360_ACTIVITY_TOOLS)).toEqual([]);
    expect(buildMktgRunActivity([...before, local('score_member_360')], MEMBER_360_ACTIVITY_TOOLS)).toEqual([
      { id: 'writing', kind: 'writing', label: MEMBER_360_ACTIVITY_LABELS.writing, status: 'running', startedAt: '2026-10-29T10:00:01Z' },
    ]);
  });
  it('collapses forty record_member_actions calls into one running Writing stretch', () => {
    const activity = buildMktgRunActivity(
      Array.from({ length: 40 }, () => local('record_member_actions')),
      MEMBER_360_ACTIVITY_TOOLS
    );
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ kind: 'writing', label: MEMBER_360_ACTIVITY_LABELS.writing, status: 'running' });
    expect(JSON.stringify(activity)).not.toMatch(/do-not-display|record_member_actions/);
  });
  it('maps judge_member_slice to the same Writing stretch and surfaces slice checking without tool data', () => {
    const activity = buildMktgRunActivity([local('judge_member_slice'), local('finalize_member_slice', 2)], MEMBER_360_ACTIVITY_TOOLS);
    expect(activity.map((step) => [step.kind, step.label, step.status])).toEqual([
      ['writing', MEMBER_360_ACTIVITY_LABELS.writing, 'done'],
      ['checking', MEMBER_360_ACTIVITY_LABELS.checking, 'running'],
    ]);
    expect(JSON.stringify(activity)).not.toMatch(/do-not-display|judge_member_slice|finalize_member_slice/);
  });
  it('maps ask_requester to Questions without inventing a Writing step', () => {
    const activity = buildMktgRunActivity(
      [local('ask_requester'), JSON.stringify({ type: 'llm_start', created_at: '2026-10-29T10:00:02Z' })],
      MEMBER_360_ACTIVITY_TOOLS
    );
    expect(activity.map((step) => [step.kind, step.label, step.status])).toEqual([['questions', MEMBER_360_ACTIVITY_LABELS.questions, 'done']]);
  });
  it('maps finalize_member_360 to Checking and ends Writing at that call', () => {
    const activity = buildMktgRunActivity([local('score_member_360'), local('finalize_member_360', 2)], MEMBER_360_ACTIVITY_TOOLS);
    expect(activity.map((step) => [step.kind, step.label, step.status])).toEqual([
      ['writing', MEMBER_360_ACTIVITY_LABELS.writing, 'done'],
      ['checking', MEMBER_360_ACTIVITY_LABELS.checking, 'running'],
    ]);
    expect(activity[0]?.endedAt).toBe('2026-10-29T10:00:02Z');
  });
  it('recognises platform tool fields and the registered Member tools without an explicit table', () => {
    const start = JSON.stringify({
      type: 'runtime_start',
      created_at: '2026-10-29T10:00:01Z',
      task: { id: 'score', entity_type: 'EntTaskTool', tool_name: 'score_member_360', status: 'DONE' },
      content: { private: 'do-not-display' },
    });
    expect(buildMktgRunActivity([start], MEMBER_360_ACTIVITY_TOOLS)[0]).toMatchObject({ kind: 'writing', status: 'running' });
    expect(buildMktgRunActivity([start, local('finalize_member_360', 2)]).map((step) => step.kind)).toEqual(['writing', 'checking']);
    expect(buildMktgRunActivity(payloads())).toEqual(buildMktgRunActivity(payloads(), undefined));
  });
  it('replays the synthetic roster/contacts/score/40-actions/finalize order through every stage', () => {
    const replay = member360ActivityReplay();
    const beforeScore = replay.findIndex((event) => event.includes('score_member_360'));
    const finalize = replay.findIndex((event) => event.includes('finalize_member_360'));
    expect(buildMktgRunActivity(replay.slice(0, beforeScore), MEMBER_360_ACTIVITY_TOOLS).some((step) => step.kind === 'writing')).toBe(false);
    const scoring = buildMktgRunActivity(replay.slice(0, beforeScore + 1), MEMBER_360_ACTIVITY_TOOLS);
    expect(mktgRunActivityPhases(scoring).find((phase) => phase.id === 'writing')?.state).toBe('active');
    const actions = buildMktgRunActivity(replay.slice(0, finalize), MEMBER_360_ACTIVITY_TOOLS);
    expect(actions.filter((step) => step.kind === 'writing')).toHaveLength(1);
    expect(actions.find((step) => step.kind === 'writing')?.status).toBe('running');
    const checking = buildMktgRunActivity(replay.slice(0, finalize + 1), MEMBER_360_ACTIVITY_TOOLS);
    expect(mktgRunActivityPhases(checking).find((phase) => phase.id === 'checking')?.state).toBe('active');
    const activity = buildMktgRunActivity(replay, MEMBER_360_ACTIVITY_TOOLS);
    expect(activity.map((step) => [step.kind, step.status])).toEqual([
      ['reading', 'done'],
      ['lfx', 'done'],
      ['lfx', 'done'],
      ['writing', 'done'],
      ['checking', 'done'],
    ]);
    expect(activity.slice(-2).map((step) => step.label)).toEqual([MEMBER_360_ACTIVITY_LABELS.writing, MEMBER_360_ACTIVITY_LABELS.checking]);
    expect(JSON.stringify(activity)).not.toMatch(/never-render|record_member_actions|score_member_360|finalize_member_360/);
  });
});

describe('buildMktgRunActivity — the live feed from a real session', () => {
  it('reuses the generic phases with LinkedIn-specific writing/checking labels after its gap round', () => {
    const activity = buildMktgRunActivity([
      JSON.stringify({
        type: 'agent_notification_message',
        created_at: '2026-10-19T10:00:00Z',
        content: { type: 'text', data: 'LINKEDIN POST — QUESTIONS (linkedin-post-questions/v1)' },
      }),
      JSON.stringify({ type: 'llm_start', created_at: '2026-10-19T10:00:01Z' }),
      JSON.stringify({
        type: 'llm_done',
        created_at: '2026-10-19T10:00:02Z',
        body: JSON.stringify({ type: 'tool_use', id: 'check-1', name: 'finalize_linkedin_post' }),
      }),
    ]);
    expect(labels(activity)).toEqual(['Writing three post options', 'Checking the post options']);
    expect(activity.map((step) => step.status)).toEqual(['done', 'running']);
  });

  it('never infers writing or checking from any recorded prefix through the questions marker', () => {
    const marker = events.findIndex((event) => JSON.stringify(event['content'] ?? '').includes('messaging-framework-questions/v1'));
    expect(marker).toBeGreaterThan(0);
    // Includes every between-rounds start/completion and the pre-marker window:
    // payloads15/24/31, 14..17, 23..26, 30..33 and37..45.
    for (let n = 1; n <= marker + 1; n++) {
      expect(
        buildMktgRunActivity(payloads(n)).some((step) => step.kind === 'writing' || step.kind === 'checking'),
        `recorded prefix ${n}`
      ).toBe(false);
    }
  });

  it('keeps every research round of a recorded no-questions variant on the run feed until finalize', () => {
    let researchEnd = -1;
    for (const [index, event] of events.entries()) {
      const task = event['task'];
      if (
        index < afterAnswers &&
        event['type'] === 'runtime_done' &&
        typeof task === 'object' &&
        task !== null &&
        'tool_name' in task &&
        typeof task.tool_name === 'string' &&
        !MKTG_RUN_ACTIVITY_HIDDEN_TOOLS.includes(task.tool_name)
      ) {
        researchEnd = index;
      }
    }
    expect(researchEnd).toBeGreaterThan(0);
    const direct = [...events.slice(0, researchEnd + 1), ...events.slice(afterAnswers)];
    const finalizeAt = direct.findIndex((event) => event['type'] === 'llm_done' && String(event['body']).includes(MKTG_RUN_ACTIVITY_TOOLS.finalize));
    expect(finalizeAt).toBeGreaterThan(researchEnd);
    // Covers model starts AND completions between every observed research batch.
    for (let n = 1; n <= finalizeAt; n++) {
      expect(
        buildMktgRunActivity(direct.slice(0, n).map((event) => JSON.stringify(event))).some((step) => step.kind === 'writing' || step.kind === 'checking'),
        `no-questions prefix ${n}`
      ).toBe(false);
    }
    const modelStart = direct
      .slice(0, finalizeAt)
      .reverse()
      .find((event) => event['type'] === 'llm_start');
    expect(modelStart).toBeDefined();
    const checked = buildMktgRunActivity(direct.slice(0, finalizeAt + 1).map((event) => JSON.stringify(event)));
    expect(checked.find((step) => step.kind === 'writing')).toMatchObject({
      id: 'writing',
      status: 'done',
      startedAt: modelStart?.['created_at'],
      endedAt: direct[finalizeAt]['created_at'],
    });
    expect(checked.some((step) => step.kind === 'checking')).toBe(true);
    expect(checked.some((step) => step.kind === 'questions')).toBe(false);
  });

  it.each([false, true])('does not label multi-round synthetic research or a model call as writing (kit:%s)', (brandKit) => {
    for (const phase of ['research', 'between-rounds', 'writing'] as const) {
      expect(buildMktgRunActivity(noQuestionsActivityPayloads(phase, brandKit)).some((step) => step.kind === 'writing' || step.kind === 'checking')).toBe(
        false
      );
    }
    const checked = buildMktgRunActivity(noQuestionsActivityPayloads('checked', brandKit));
    expect(checked.find((step) => step.kind === 'writing')).toMatchObject({
      status: 'done',
      startedAt: '2026-10-20T10:00:09Z',
      endedAt: '2026-10-20T10:00:12Z',
    });
    expect(checked.some((step) => step.kind === 'checking')).toBe(true);
  });
  it.each([
    MKTG_RUN_ACTIVITY_TOOLS.fetch,
    MKTG_RUN_ACTIVITY_TOOLS.webSearch,
    MKTG_RUN_ACTIVITY_TOOLS.lfxGetProject,
    MKTG_RUN_ACTIVITY_TOOLS.inspectLogos,
    MKTG_RUN_ACTIVITY_TOOLS.askRequester,
  ])('does not admit a finalize completion that also issues %s', (otherTool) => {
    const body = [otherTool, MKTG_RUN_ACTIVITY_TOOLS.finalize]
      .map(
        (name) =>
          `data: ${JSON.stringify({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: `synthetic-${name}`, name, input: {} } })}`
      )
      .join('\n');
    const activity = buildMktgRunActivity([
      ...noQuestionsActivityPayloads('writing'),
      JSON.stringify({ type: 'llm_done', created_at: '2026-10-20T10:00:12Z', body }),
    ]);
    expect(activity.some((step) => step.kind === 'writing' || step.kind === 'checking')).toBe(false);
  });

  it.each([...MKTG_RUN_ACTIVITY_HIDDEN_TOOLS, 'synthetic_unmapped_tool'])('does not classify hidden or unmapped %s as research', (otherTool) => {
    const body = [otherTool, MKTG_RUN_ACTIVITY_TOOLS.finalize]
      .map((name) => JSON.stringify({ type: 'tool_use', id: `synthetic-${name}`, name, input: {} }))
      .join('\n');
    const activity = buildMktgRunActivity([
      ...noQuestionsActivityPayloads('writing'),
      JSON.stringify({ type: 'llm_done', created_at: '2026-10-20T10:00:12Z', body }),
    ]);
    expect(activity.some((step) => step.kind === 'checking')).toBe(true);
    expect(JSON.stringify(activity)).not.toContain(otherTool);
  });

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
    expect(writing.at(-1)).toMatchObject({ id: 'writing', kind: 'writing', label: 'Writing the framework', status: 'running' });

    const whole = buildMktgRunActivity(payloads());
    expect(whole.slice(-2).map((step) => [step.kind, step.label, step.status])).toEqual([
      ['writing', 'Writing the framework', 'done'],
      ['checking', 'Checking the framework', 'done'],
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

  it('names a Brand Kit run by its own sentences, not the framework’s', () => {
    const toolCall = (createdAt: string, name: string): string =>
      JSON.stringify({
        type: 'llm_done',
        created_at: createdAt,
        body: `data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_x","name":"${name}","input":{}}}`,
      });
    const brandKitRun = [
      toolCall('2026-10-16T08:00:00Z', 'inspect_logo_files'),
      JSON.stringify({
        type: 'agent_notification_progress',
        created_at: '2026-10-16T08:01:00Z',
        content: { type: 'text', data: 'BRAND KIT — QUESTIONS (brand-kit-questions/v1)' },
      }),
      JSON.stringify({ type: 'llm_start', created_at: '2026-10-16T08:02:00Z' }),
      toolCall('2026-10-16T08:03:00Z', 'finalize_brand_kit'),
      JSON.stringify({ type: 'llm_start', created_at: '2026-10-16T08:04:00Z' }),
    ];
    expect(buildMktgRunActivity(brandKitRun).map((step) => [step.kind, step.label, step.status])).toEqual([
      ['reading', 'Inspecting the logo files', 'done'],
      ['writing', 'Writing the document', 'done'],
      ['checking', 'Checking the document against the template', 'done'],
    ]);
  });

  it('names a Boilerplates run by its own sentences, and a second finalize as the fix', () => {
    const toolCall = (createdAt: string, name: string): string =>
      JSON.stringify({
        type: 'llm_done',
        created_at: createdAt,
        body: `data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_x","name":"${name}","input":{}}}`,
      });
    const boilerplatesRun = [
      toolCall('2026-10-19T08:00:00Z', 'ask_requester'),
      JSON.stringify({
        type: 'agent_notification_message',
        created_at: '2026-10-19T08:01:00Z',
        content: { type: 'text', data: 'BOILERPLATES — QUESTIONS (boilerplates-questions/v1)' },
      }),
      JSON.stringify({ type: 'llm_start', created_at: '2026-10-19T08:02:00Z' }),
      toolCall('2026-10-19T08:03:00Z', 'finalize_boilerplates'),
      toolCall('2026-10-19T08:04:00Z', 'finalize_boilerplates'),
      JSON.stringify({ type: 'llm_start', created_at: '2026-10-19T08:05:00Z' }),
    ];
    expect(buildMktgRunActivity(boilerplatesRun).map((step) => [step.kind, step.label, step.status])).toEqual([
      ['questions', 'Preparing a few questions for you', 'done'],
      ['writing', 'Writing the boilerplates', 'done'],
      ['checking', 'Checking the boilerplates against their word limits', 'done'],
      ['checking', 'Fixing what the check found', 'done'],
    ]);
  });

  it('names an FAQ run by its own sentences: its questions turn and its finalize tool', () => {
    const toolCall = (createdAt: string, name: string): string =>
      JSON.stringify({
        type: 'llm_done',
        created_at: createdAt,
        body: `data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_x","name":"${name}","input":{}}}`,
      });
    const faqRun = [
      toolCall('2026-10-19T08:00:00Z', 'ask_requester'),
      JSON.stringify({
        type: 'agent_notification_message',
        created_at: '2026-10-19T08:01:00Z',
        content: { type: 'text', data: 'FAQ — QUESTIONS (faq-questions/v1)' },
      }),
      JSON.stringify({ type: 'llm_start', created_at: '2026-10-19T08:02:00Z' }),
      toolCall('2026-10-19T08:03:00Z', 'finalize_faq'),
      toolCall('2026-10-19T08:04:00Z', 'finalize_faq'),
      JSON.stringify({ type: 'llm_start', created_at: '2026-10-19T08:05:00Z' }),
    ];
    expect(buildMktgRunActivity(faqRun).map((step) => [step.kind, step.label, step.status])).toEqual([
      ['questions', 'Preparing a few questions for you', 'done'],
      ['writing', 'Writing the FAQ', 'done'],
      ['checking', 'Checking the FAQ', 'done'],
      ['checking', 'Fixing what the check found', 'done'],
    ]);
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

  it('keeps the furthest phase under way between its waves, so a read in batches never flickers done and back', () => {
    const betweenWaves = mktgRunActivityPhases([
      { id: 'step-1', kind: 'reading', label: 'Reading aaif.io', status: 'done', startedAt: '2026-10-29T08:00:00Z', endedAt: '2026-10-29T08:00:03Z' },
      { id: 'step-2', kind: 'reading', label: 'Reading aaif.io/about', status: 'done', startedAt: '2026-10-29T08:00:01Z', endedAt: '2026-10-29T08:00:04Z' },
    ]);
    expect(betweenWaves.map((phase) => phase.state)).toEqual(['active', 'pending', 'pending', 'pending', 'pending']);
    const nextWave = mktgRunActivityPhases([
      { id: 'step-1', kind: 'reading', label: 'Reading aaif.io', status: 'done', startedAt: '2026-10-29T08:00:00Z', endedAt: '2026-10-29T08:00:03Z' },
      { id: 'step-3', kind: 'reading', label: 'Reading aaif.io/members', status: 'running', startedAt: '2026-10-29T08:00:09Z' },
    ]);
    expect(nextWave[0].state).toBe('active');
    // A later phase starting is what closes it, and a late page read does not reopen it.
    const later = mktgRunActivityPhases([
      { id: 'step-1', kind: 'reading', label: 'Reading aaif.io', status: 'done', startedAt: '2026-10-29T08:00:00Z', endedAt: '2026-10-29T08:00:03Z' },
      {
        id: 'step-4',
        kind: 'lfx',
        label: 'Reading the LFX project record',
        status: 'done',
        startedAt: '2026-10-29T08:00:10Z',
        endedAt: '2026-10-29T08:00:12Z',
      },
      { id: 'step-5', kind: 'reading', label: 'Reading aaif.io/events', status: 'running', startedAt: '2026-10-29T08:00:13Z' },
    ]);
    expect(later.map((phase) => phase.state)).toEqual(['done', 'active', 'pending', 'pending', 'pending']);
    // A failed step with nothing running closes the phase: the feed a failed run leaves behind is not "under way".
    const failed = mktgRunActivityPhases([
      { id: 'step-1', kind: 'reading', label: 'Reading aaif.io', status: 'done', startedAt: '2026-10-29T08:00:00Z', endedAt: '2026-10-29T08:00:03Z' },
      { id: 'step-6', kind: 'writing', label: 'Writing the framework', status: 'failed', startedAt: '2026-10-29T08:01:00Z', endedAt: '2026-10-29T08:01:30Z' },
    ]);
    expect(failed.map((phase) => phase.state)).toEqual(['done', 'skipped', 'skipped', 'done', 'pending']);
  });
});

describe('AEO/GEO session activity', () => {
  it('uses the common questions, writing and finalize phases for the audit round', () => {
    const activity = buildMktgRunActivity([
      JSON.stringify({
        type: 'llm_done',
        created_at: '2026-10-19T10:00:00Z',
        body: JSON.stringify({ type: 'tool_use', id: 'synthetic-ask', name: 'ask_requester' }),
      }),
      aeoGeoQuestionsEventFixture(),
      JSON.stringify({ type: 'llm_start', created_at: '2026-10-19T10:01:00Z' }),
      JSON.stringify({
        type: 'llm_done',
        created_at: '2026-10-19T10:01:05Z',
        body: JSON.stringify({ type: 'tool_use', id: 'synthetic-finalize', name: AEO_GEO_FINALIZE_TOOL }),
      }),
    ]);
    expect(activity.map((step) => step.kind)).toEqual(['questions', 'writing', 'checking']);
    expect(mktgRunActivityPhases(activity).find((phase) => phase.id === 'questions')?.state).toBe('done');
  });
});

describe('mktgRunQuestionShortLabel', () => {
  it('shows a short label whole and cuts a long one without ending on a connector (hand test, 18 Oct: "Words to")', () => {
    expect(mktgRunQuestionShortLabel('Tagline')).toBe('Tagline');
    expect(mktgRunQuestionShortLabel('Words to avoid')).toBe('Words to avoid');
    expect(mktgRunQuestionShortLabel('Ranked goals')).toBe('Ranked goals');
    expect(mktgRunQuestionShortLabel('Proof points to confirm')).toBe('Proof points');
    expect(mktgRunQuestionShortLabel('Tagline, CTAs and constraints')).toBe('Tagline, CTAs');
    expect(mktgRunQuestionShortLabel('Something entirely new and long')).toBe('Something entirely new');
  });
});
