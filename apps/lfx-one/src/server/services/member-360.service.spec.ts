// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MEMBER_360_FINALIZE_TOOL, MEMBER_360_REDACTED_SUMMARY, MEMBER_360_INVALID_RESULT } from '@lfx-one/shared/constants';
import { envelopeSchema } from '@lfx-one/shared/server';
import { createHash } from 'node:crypto';
import { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { member360Fixture } from '../../../e2e/fixtures/mock-data/member-360.mock';
import { Member360Service } from './member-360.service';
import { buildMktgRunDocumentId } from '../utils/mktg-document-store.util';

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  getRawEventPayloads: vi.fn(),
  getProjectById: vi.fn(),
  listDocuments: vi.fn(),
  getRevision: vi.fn(),
  recordGeneration: vi.fn(),
  available: true,
}));
vi.mock('@lfx-one/shared/constants', async () => {
  const actual = await vi.importActual<typeof import('@lfx-one/shared/constants')>('@lfx-one/shared/constants');
  return {
    ...actual,
    MKTG_AGENTS: actual.MKTG_AGENTS.map((agent) =>
      agent.id === 'member-360'
        ? {
            ...agent,
            get status() {
              return mocks.available ? 'active' : 'coming-soon';
            },
            guildAgentHandle: 'member-360',
          }
        : agent
    ),
  };
});
vi.mock('./guild.service', () => ({
  GuildService: class {
    createSession = mocks.createSession;
    getRawEventPayloads = mocks.getRawEventPayloads;
  },
}));
vi.mock('./project.service', () => ({
  ProjectService: class {
    getProjectById = mocks.getProjectById;
  },
}));
vi.mock('./mktg-document-store.service', () => ({
  MktgDocumentStoreService: class {
    listDocuments = mocks.listDocuments;
    getRevision = mocks.getRevision;
    recordGeneration = mocks.recordGeneration;
  },
}));
vi.mock('./logger.service', () => ({ logger: { debug: vi.fn(), warning: vi.fn() } }));

// SDK persisted tool-call/result transcript parts, paired by call id.
function finalized(envelope: unknown): string {
  return JSON.stringify({
    type: 'llm_start',
    payload: {
      messages: [
        { type: 'tool-call', toolCallId: 'final', toolName: MEMBER_360_FINALIZE_TOOL },
        { type: 'tool-result', toolCallId: 'final', output: { envelope_json: JSON.stringify(envelope) } },
      ],
    },
  });
}
const req = {} as Request;
describe('Member 360 entitlement and generation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.available = true;
    mocks.getProjectById.mockResolvedValue({ uid: 'sample-project', name: 'Sample Foundation', slug: 'sample-foundation', writer: true });
    mocks.listDocuments.mockResolvedValue({ groups: [] });
    mocks.createSession.mockResolvedValue('session-1');
    mocks.recordGeneration.mockResolvedValue({ record: { documentId: 'run-0123456789abcdef01234567' } });
  });
  afterEach(() => vi.useRealTimers());
  it.each(['schema', 'hash', 'project', 'raw', 'other-tool', 'unpaired', 'failed'])('never stores a rejected %s candidate', async (mode) => {
    const envelope = member360Fixture();
    if (mode === 'schema') Object.assign(envelope, { kind: 'invalid' });
    if (mode === 'hash') envelope.content_sha256 = '0'.repeat(64);
    if (mode === 'project') envelope.project_uid = 'other-project';
    let payload = finalized(envelope);
    if (mode === 'raw') payload = JSON.stringify(envelope);
    if (mode === 'other-tool') payload = payload.replace(MEMBER_360_FINALIZE_TOOL, 'web_search');
    if (mode === 'unpaired') {
      payload = JSON.stringify({ type: 'llm_start', payload: { messages: [{ type: 'tool-result', toolCallId: 'missing', output: envelope }] } });
    }
    if (mode === 'failed') {
      payload = JSON.stringify({
        type: 'llm_start',
        payload: {
          messages: [
            { type: 'tool-call', toolCallId: 'final', toolName: MEMBER_360_FINALIZE_TOOL },
            { type: 'tool-result', toolCallId: 'final', is_error: true, output: { envelope_json: JSON.stringify(envelope) } },
          ],
        },
      });
    }
    mocks.getRawEventPayloads.mockResolvedValue([payload]);
    expect(await new Member360Service().result(req, 'session-1', 'sample-project')).toMatchObject({ status: 'pending' });
    expect(mocks.recordGeneration).not.toHaveBeenCalled();
  });
  it.each([
    ['2026-03-31', '6', '2025-10-01'],
    ['2026-03-31', '12', '2025-04-01'],
    ['2026-03-31', 'year', '2026-01-01'],
    ['2028-02-29', '6', '2027-08-30'],
    ['2028-02-29', '12', '2027-03-01'],
    ['2028-02-29', 'year', '2028-01-01'],
    ['2026-01-01', '6', '2025-07-02'],
    ['2026-01-01', '12', '2025-01-02'],
    ['2026-01-01', 'year', '2026-01-01'],
  ] as const)('renders the exact inclusive window at %s for %s', async (end, window, start) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${end}T12:00:00Z`));
    await new Member360Service().start(req, { project: 'sample-project', window });
    expect(mocks.createSession.mock.calls[0][1].message).toContain(`ANALYSIS WINDOW: ${start} to ${end} (inclusive)`);
  });
  it('loads the previous stored ranking for trends, not caller-supplied scores', async () => {
    mocks.listDocuments.mockResolvedValue({
      groups: [{ type: { agentKey: 'member-360' }, documents: [{ documentId: 'previous', latestRevisionId: 'revision' }] }],
    });
    mocks.getRevision.mockResolvedValue({ member360: member360Fixture() });
    await new Member360Service().start(req, { project: 'sample-project' });
    expect(mocks.createSession.mock.calls[0][1].message).toContain('PRIOR MEMBER 360 RUN (period 2026-Q3');
  });
  it('classifies an unavailable comparison without starting Guild', async () => {
    mocks.listDocuments.mockRejectedValue(new Error('store read failed'));
    await expect(new Member360Service().start(req, { project: 'sample-project' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'MEMBER_360_COMPARISON_UNAVAILABLE',
    });
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.listDocuments).toHaveBeenCalledWith(req, 'sample-project', 'member-360');
  });
  it('gates unavailable agents in the service and classifies unsafe project identity', async () => {
    mocks.available = false;
    await expect(new Member360Service().start(req, { project: 'sample-project' })).rejects.toMatchObject({ statusCode: 400, code: 'MEMBER_360_UNAVAILABLE' });
    mocks.available = true;
    mocks.getProjectById.mockResolvedValue({ uid: 'sample-project', writer: true, name: 'unsafe\nheader', slug: 'sample' });
    await expect(new Member360Service().start(req, { project: 'sample-project' })).rejects.toMatchObject({ statusCode: 400 });
  });
  it('does not spend a traversal-shaped uid upstream', async () => {
    await expect(new Member360Service().start(req, { project: '../other' })).rejects.toThrow();
    expect(mocks.getProjectById).not.toHaveBeenCalled();
  });
  it('redacts top-level project names after validating scope', async () => {
    const envelope = member360Fixture();
    envelope.project_name = envelope.lfx_project_name = 'Sample Foundation owner@example.test';
    mocks.getProjectById.mockResolvedValue({ uid: 'sample-project', name: envelope.project_name, slug: 'sample-foundation', writer: true });
    mocks.getRawEventPayloads.mockResolvedValue([finalized(envelope)]);
    await new Member360Service().result(req, 'session-1', 'sample-project');
    const stored = mocks.recordGeneration.mock.calls[0][3].member360;
    expect(stored.project_name).toBe('Sample Foundation [contact redacted]');
    expect(stored.lfx_project_name).toBe('Sample Foundation [contact redacted]');
  });
  it('fixes project identity server-side and starts with a rendered form', async () => {
    const started = await new Member360Service().start(req, { project: 'sample-project' });
    expect(started).toEqual({ sessionId: 'session-1', documentId: buildMktgRunDocumentId('session-1') });
    expect(mocks.getProjectById).toHaveBeenCalledWith(req, 'sample-project', true);
    const message = mocks.createSession.mock.calls[0][1].message;
    expect(message).toContain('MEMBER 360 RUN REQUEST');
    expect(message).toContain('  LFX project UID: sample-project (authoritative');
    expect(message).toMatch(/ANALYSIS WINDOW: \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/);
  });
  it('refuses non-writers before any Guild or document calls', async () => {
    mocks.getProjectById.mockResolvedValue({ uid: 'sample-project', writer: false });
    await expect(new Member360Service().start(req, { project: 'sample-project' })).rejects.toThrow('write access');
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.listDocuments).not.toHaveBeenCalled();
  });
  it('selects only schema-valid, hash-valid, project-matching finalized output', async () => {
    const valid = member360Fixture();
    const tampered = { ...valid, version: 2, content_sha256: '0'.repeat(64) };
    mocks.getRawEventPayloads.mockResolvedValue([finalized(valid), finalized(tampered)]);
    expect(await new Member360Service().result(req, 'session-1', 'sample-project')).toMatchObject({ status: 'ready', stored: true });
    const stored = mocks.recordGeneration.mock.calls[0][3];
    expect(stored.member360.version).toBe(1);
    expect(stored).not.toHaveProperty('tabs');
    expect(stored).not.toHaveProperty('contract');
    expect(stored.member360.content_sha256).toBe(createHash('sha256').update(JSON.stringify(stored.member360.tabs)).digest('hex'));
    expect(stored.content_sha256).toBe(createHash('sha256').update(valid.summary_markdown).digest('hex'));
  });
  it.each([false, true])('stores valid contact-free tabs after pending; summary contracts: %s', async (shortSummary) => {
    const envelope = member360Fixture();
    envelope.tabs.member_ranking[0].key_contact = 'opaque-person-1, team role, contact@example.test';
    envelope.tabs.evidence[0].description = 'Meeting with opaque-person-1, team role, contact@example.test and other@example.test.';
    envelope.summary_markdown = shortSummary
      ? `${envelope.tabs.member_ranking[0].key_contact} `.repeat(3)
      : `${envelope.summary_markdown}\nContact: opaque-person-1, team role, contact@example.test; email other@example.test.`;
    const contact = envelope.tabs.member_ranking[0].key_contact;
    Object.assign(envelope.tabs.member_ranking[0], { recommended_next_action: contact, top_gaps: [contact], last_meaningful_engagement: contact });
    Object.assign(envelope.tabs.actions_by_team[0], { recommended_action: contact, supporting_rationale: contact });
    Object.assign(envelope.tabs.method, { notes: [contact], overrides: [contact] });
    envelope.content_sha256 = createHash('sha256').update(JSON.stringify(envelope.tabs)).digest('hex');
    mocks.getRawEventPayloads.mockResolvedValueOnce([]).mockResolvedValueOnce([finalized(envelope)]);
    const service = new Member360Service();
    expect(await service.result(req, 'session-1', 'sample-project')).toMatchObject({ status: 'pending' });
    expect(mocks.recordGeneration).not.toHaveBeenCalled();
    expect(await service.result(req, 'session-1', 'sample-project')).toMatchObject({ status: 'ready', stored: true });
    const bundle = mocks.recordGeneration.mock.calls[0][3];
    const stored = bundle.member360;
    expect(stored.tabs.evidence[0].description).toBe('Meeting with [contact redacted] and [contact redacted].');
    if (shortSummary) expect(stored.summary_markdown).toBe(MEMBER_360_REDACTED_SUMMARY);
    else expect(stored.summary_markdown).toContain('Contact: [contact redacted]; email [contact redacted].');
    expect(envelopeSchema.safeParse(stored).success).toBe(true);
    expect(bundle.document_markdown).toBe(stored.summary_markdown);
    expect(bundle.content_sha256).toBe(createHash('sha256').update(stored.summary_markdown).digest('hex'));
    expect(stored.tabs.member_ranking.every((row: { key_contact: unknown }) => row.key_contact === null)).toBe(true);
    expect(stored.content_sha256).toBe(createHash('sha256').update(JSON.stringify(stored.tabs)).digest('hex'));
    expect(JSON.stringify(stored)).not.toContain('@example.test');
    expect(JSON.stringify(stored)).not.toContain('opaque-person-1');
    expect(envelope.tabs.member_ranking[0].key_contact).not.toBeNull();
  });
  it('never stores an envelope scoped to a different project', async () => {
    mocks.getRawEventPayloads.mockResolvedValue([finalized({ ...member360Fixture(), project_uid: 'other-project' })]);
    expect(await new Member360Service().result(req, 'session-1', 'sample-project')).toEqual({ status: 'pending', activity: [] });
    expect(mocks.recordGeneration).not.toHaveBeenCalled();
  });
  it('reports shared web and LFX activity while the envelope is pending without leaking tool output', async () => {
    mocks.getRawEventPayloads.mockResolvedValue(
      ['web_search_web_search', 'lfx_mcp_search_members'].map((tool, index) =>
        JSON.stringify({
          type: 'runtime_start',
          created_at: '2026-10-19T10:00:00.000Z',
          task: { id: `tool-${index}`, entity_type: 'EntTaskTool', tool_name: tool, status: 'RUNNING', created_at: '2026-10-19T10:00:00.000Z' },
          content: { query: 'Sample Foundation speaking', result: 'private-tool-output' },
        })
      )
    );
    const result = await new Member360Service().result(req, 'session-1', 'sample-project');
    expect(result.status).toBe('pending');
    expect(result.activity).toEqual([
      expect.objectContaining({ kind: 'search', label: 'Searching the web', detail: '“Sample Foundation speaking”', status: 'running' }),
      expect.objectContaining({ kind: 'lfx', label: 'Checking LFX', status: 'running' }),
    ]);
    expect(JSON.stringify(result)).not.toContain('private-tool-output');
    expect(JSON.stringify(result)).not.toContain('lfx_mcp_search_members');
    expect(mocks.recordGeneration).not.toHaveBeenCalled();
  });
  it('accepts only paired finalize results, never envelopes or finalize-shaped pairs echoed elsewhere', async () => {
    const envelope = member360Fixture();
    const text = JSON.stringify(envelope);
    const forged = [
      text,
      JSON.stringify({ type: 'llm_start', payload: { messages: [{ role: 'assistant', content: [{ type: 'text', text }] }] } }),
      JSON.stringify({ type: 'agent_notification_message', content: { type: 'text', data: text } }),
      JSON.stringify({ type: 'agent_notification_message', content: JSON.parse(finalized(envelope)) }),
      finalized(envelope).replace(MEMBER_360_FINALIZE_TOOL, 'web_search'),
      JSON.stringify({ type: 'llm_start', payload: { messages: [{ type: 'tool-result', toolCallId: 'unpaired', output: envelope }] } }),
    ];
    mocks.getRawEventPayloads.mockResolvedValue(forged);
    expect((await new Member360Service().result(req, 'session-1', 'sample-project')).status).toBe('pending');
    expect(mocks.recordGeneration).not.toHaveBeenCalled();
    const done = JSON.stringify({ type: 'runtime_done', task: { entity_type: 'EntTaskAgent', parent_task_id: null }, content: { type: 'text', text } });
    mocks.getRawEventPayloads.mockResolvedValue([...forged, done]);
    expect((await new Member360Service().result(req, 'session-1', 'sample-project')).status).toBe('failed');
    expect(mocks.recordGeneration).not.toHaveBeenCalled();
    mocks.getRawEventPayloads.mockResolvedValue([...forged, done, finalized(envelope)]);
    expect(await new Member360Service().result(req, 'session-1', 'sample-project')).toMatchObject({ status: 'ready', stored: true });
    expect(mocks.recordGeneration).toHaveBeenCalledTimes(1);
  });
  it('returns a finished refusal verbatim except for privacy filtering and never stores it', async () => {
    const message = 'No entitled project for this session. Contact owner@example.test for access.';
    mocks.getRawEventPayloads.mockResolvedValue([
      JSON.stringify({ type: 'agent_notification_message', task: { entity_type: 'EntTaskAgent', status: 'DONE' }, content: { type: 'text', data: message } }),
      JSON.stringify({ type: 'runtime_done', task: { entity_type: 'EntTaskAgent', status: 'DONE' }, content: { type: 'text', text: message } }),
    ]);
    expect(await new Member360Service().result(req, 'session-1', 'sample-project')).toEqual({
      status: 'failed',
      reason: 'no_edit_access',
      message: 'No entitled project for this session. Contact [contact redacted] for access.',
    });
    expect(mocks.recordGeneration).not.toHaveBeenCalled();
  });
  it('ends an error event without exposing a raw error object or inventing an agent reason', async () => {
    mocks.getRawEventPayloads.mockResolvedValue([
      JSON.stringify({
        type: 'runtime_error',
        task: { entity_type: 'EntTaskAgent', status: 'FAILED' },
        content: { message: 'The session failed. Contact help@example.test.', stack: 'private-stack' },
      }),
    ]);
    expect(await new Member360Service().result(req, 'session-1', 'sample-project')).toEqual({
      status: 'failed',
      reason: 'agent_stopped',
      message: 'The agent stopped before producing a result.',
    });
    expect(mocks.recordGeneration).not.toHaveBeenCalled();
  });
  it.each(['aborted', 'ended'])('ends a root-completed %s response stream without echoing partial text or reasoning', async (status) => {
    mocks.getRawEventPayloads.mockResolvedValue([
      JSON.stringify({ type: 'agent_notification_progress', content: { type: 'application/guild-reasoning-progress', text: 'private-reasoning' } }),
      JSON.stringify({ type: 'agent_notification_message', content: { type: 'application/guild-response-stream', status, text: 'unfinished-private-chunk' } }),
      JSON.stringify({ type: 'runtime_done', task: { entity_type: 'EntTaskAgent', parent_task_id: null, status: 'DONE' }, content: {} }),
    ]);
    expect(await new Member360Service().result(req, 'session-1', 'sample-project')).toEqual({
      status: 'failed',
      reason: 'agent_stopped',
      message: 'The run ended without a Member 360 result.',
    });
    expect(mocks.recordGeneration).not.toHaveBeenCalled();
  });
  it('ends a done root task without an envelope rather than polling forever', async () => {
    mocks.getRawEventPayloads.mockResolvedValue([JSON.stringify({ type: 'runtime_done', task: { entity_type: 'EntTaskAgent', status: 'DONE' }, content: {} })]);
    expect(await new Member360Service().result(req, 'session-1', 'sample-project')).toEqual({
      status: 'failed',
      reason: 'agent_stopped',
      message: 'The run ended without a Member 360 result.',
    });
    expect(mocks.recordGeneration).not.toHaveBeenCalled();
  });
  it('keeps tool completion and model-turn completion pending, ignoring tool data and nested terminal lookalikes', async () => {
    mocks.getRawEventPayloads.mockResolvedValue([
      JSON.stringify({
        type: 'runtime_done',
        task: { entity_type: 'EntTaskTool', status: 'DONE' },
        content: { type: 'text', text: 'private-tool-data', session: { status: 'DONE' } },
      }),
      JSON.stringify({ type: 'runtime_error', task: { entity_type: 'EntTaskTool', status: 'FAILED' }, content: { message: 'recoverable-tool-error' } }),
      JSON.stringify({ type: 'llm_done', task: { entity_type: 'EntTaskAgent', parent_task_id: null, status: 'DONE' }, content: {} }),
      JSON.stringify({ type: 'runtime_done', task: { entity_type: 'EntTaskAgent', parent_task_id: 'root-task', status: 'DONE' }, content: {} }),
      JSON.stringify({ type: 'agent_notification_message', content: { type: 'application/guild-response-stream', status: 'aborted', text: '' } }),
      JSON.stringify({ type: 'agent_notification_message', content: { type: 'application/guild-response-stream', status: 'done', text: 'partial-tool-turn' } }),
    ]);
    expect(await new Member360Service().result(req, 'session-1', 'sample-project')).toEqual({ status: 'pending', activity: [] });
  });
  it('prefers a valid envelope over terminal metadata, even after an aborted stream', async () => {
    mocks.getRawEventPayloads.mockResolvedValue([
      JSON.stringify({ type: 'agent_notification_message', content: { type: 'application/guild-response-stream', status: 'aborted' } }),
      finalized(member360Fixture()),
      JSON.stringify({ type: 'runtime_done', task: { entity_type: 'EntTaskAgent', status: 'DONE' } }),
    ]);
    expect(await new Member360Service().result(req, 'session-1', 'sample-project')).toMatchObject({ status: 'ready', stored: true });
    expect(mocks.recordGeneration).toHaveBeenCalledTimes(1);
  });
  it.each(['schema', 'project'])('redacts contacts from a candidate rejected for %s before surfacing root prose', async (rejection) => {
    const candidate =
      rejection === 'schema'
        ? { contract: 'member-360-output/v1', tabs: { member_ranking: [{ key_contact: 'opaque-contact-2' }] } }
        : { ...member360Fixture(), project_uid: 'other-project' };
    candidate.tabs.member_ranking[0].key_contact = 'opaque-contact-2';
    if ('content_sha256' in candidate) candidate.content_sha256 = createHash('sha256').update(JSON.stringify(candidate.tabs)).digest('hex');
    const message = 'Cannot complete this run; contact opaque-contact-2 or owner@example.test.';
    mocks.getRawEventPayloads.mockResolvedValue([
      JSON.stringify(candidate),
      JSON.stringify({
        type: 'runtime_done',
        task: { entity_type: 'EntTaskAgent', parent_task_id: null, status: 'DONE' },
        content: { type: 'text', text: message },
      }),
    ]);
    expect(await new Member360Service().result(req, 'session-1', 'sample-project')).toEqual({
      status: 'failed',
      reason: 'agent_stopped',
      message: 'Cannot complete this run; contact [contact redacted] or [contact redacted].',
    });
    expect(mocks.recordGeneration).not.toHaveBeenCalled();
  });
  it('caps the redacted message after removing exact known contacts from an invalid candidate', async () => {
    const envelope = member360Fixture();
    envelope.tabs.member_ranking[0].key_contact = 'opaque-contact-1';
    envelope.content_sha256 = '0'.repeat(64); // Invalid hash: never stored, but known contact must still be removed.
    const message = `opaque-contact-1 ${'a'.repeat(570)} boundary@example.test ${'b'.repeat(100)}`;
    mocks.getRawEventPayloads.mockResolvedValue([
      JSON.stringify(envelope),
      JSON.stringify({
        type: 'runtime_done',
        task: { entity_type: 'EntTaskAgent', parent_task_id: null, status: 'DONE' },
        content: { type: 'text', text: message },
      }),
    ]);
    const result = await new Member360Service().result(req, 'session-1', 'sample-project');
    expect(result.status).toBe('failed');
    expect(result.message).toHaveLength(600);
    expect(result.message).toContain('[contact redacted]');
    expect(result.message).not.toContain('opaque-contact-1');
    expect(result.message).not.toContain('boundary@');
    expect(mocks.recordGeneration).not.toHaveBeenCalled();
  });
  it('keeps storage failure retryable instead of declaring the run stored', async () => {
    mocks.getRawEventPayloads.mockResolvedValue([finalized(member360Fixture())]);
    mocks.recordGeneration.mockRejectedValue(new Error('temporary storage failure'));
    expect(await new Member360Service().result(req, 'session-1', 'sample-project')).toEqual({ status: 'ready', stored: false });
  });
  it('strips additive 2.0 metadata and row keys but requires the 1.0 fields', async () => {
    const candidate = { ...member360Fixture(), future_metadata: true };
    Object.assign(candidate.inputs, {
      research: {
        fetches: [{ url: 'https://sample.example', ok: true, status: 200, final_url: 'https://sample.example' }],
        searches: ['synthetic query'],
        lfx_reads: ['project record'],
        questions: [],
        answers: [],
      },
    });
    for (const row of [
      candidate.tabs.member_ranking[0],
      candidate.tabs.evidence[0],
      candidate.tabs.actions_by_team[0],
      candidate.tabs.category_detail[0],
      candidate.tabs.method.data_sources[0],
    ])
      Object.assign(row, { future_metadata: true });
    candidate.content_sha256 = createHash('sha256').update(JSON.stringify(candidate.tabs)).digest('hex');
    expect(envelopeSchema.safeParse(candidate).success).toBe(true);
    expect(envelopeSchema.safeParse({ ...candidate, project_name: undefined }).success).toBe(false);
    mocks.getRawEventPayloads.mockResolvedValue([finalized(candidate)]);
    expect(await new Member360Service().result(req, 'session-1', 'sample-project')).toMatchObject({ status: 'ready', stored: true });
    const stored = mocks.recordGeneration.mock.calls[0][3].member360;
    expect(JSON.stringify(stored)).not.toContain('future_metadata');
    expect(stored.inputs).not.toHaveProperty('research');
    expect(stored.tabs.member_ranking[0].member_organization).toBe(candidate.tabs.member_ranking[0].member_organization);
  });
  it.each(['member-360-questions/v1', 'MEMBER 360 — QUESTIONS (member-360-questions/v1)'])(
    'recognizes %s without exposing question text or persisting',
    async (header) => {
      const questions = {
        project: 'Sample Foundation',
        questions: [
          {
            id: 'priority',
            question: 'Which outreach should lead this run?',
            why: 'The sources do not name a priority.',
            suggested_answer: 'Renewal outreach.',
            basis: 'inferred',
          },
        ],
      };
      const questionsText = `${header}\n\`\`\`json\n${JSON.stringify(questions)}\n\`\`\``;
      mocks.getRawEventPayloads.mockResolvedValue([
        JSON.stringify({ type: 'agent_notification_message', content: `  ${questionsText}  ` }),
        JSON.stringify({ type: 'runtime_done', task: { entity_type: 'EntTaskAgent', status: 'DONE' } }),
      ]);
      expect(await new Member360Service().result(req, 'session-1', 'sample-project')).toEqual({ status: 'needs_input', activity: [] });
      expect(mocks.recordGeneration).not.toHaveBeenCalled();
    }
  );
  it('does not let short or placeholder contact rows damage report prose', async () => {
    const envelope = member360Fixture();
    envelope.tabs.member_ranking[0].key_contact = '—';
    envelope.tabs.member_ranking[1].key_contact = 'TBD';
    envelope.summary_markdown = 'Annual report — the next action is TBD. '.repeat(3);
    envelope.content_sha256 = createHash('sha256').update(JSON.stringify(envelope.tabs)).digest('hex');
    mocks.getRawEventPayloads.mockResolvedValue([finalized(envelope)]);
    await new Member360Service().result(req, 'session-1', 'sample-project');
    expect(mocks.recordGeneration.mock.calls[0][3].document_markdown).toBe(envelope.summary_markdown);
  });
  it('preserves organization and project identity while still redacting their email addresses', async () => {
    const envelope = member360Fixture(),
      name = envelope.tabs.member_ranking[0].member_organization;
    envelope.project_name = envelope.lfx_project_name = 'Sample Foundation owner@example.test';
    mocks.getProjectById.mockResolvedValue({ uid: 'sample-project', name: envelope.project_name, slug: 'sample-foundation', writer: true });
    envelope.tabs.member_ranking[0].key_contact = name;
    envelope.tabs.member_ranking[0].member_organization = envelope.tabs.summary.project_name = `${name} contact@example.test`;
    envelope.content_sha256 = createHash('sha256').update(JSON.stringify(envelope.tabs)).digest('hex');
    mocks.getRawEventPayloads.mockResolvedValue([finalized(envelope)]);
    await new Member360Service().result(req, 'session-1', 'sample-project');
    const stored = mocks.recordGeneration.mock.calls[0][3].member360;
    expect(stored.tabs.member_ranking[0].member_organization).toBe(`${name} [contact redacted]`);
    expect(stored.tabs.summary.project_name).toBe(`${name} [contact redacted]`);
    expect(stored.project_name).toBe('Sample Foundation [contact redacted]');
    expect(stored.lfx_project_name).toBe('Sample Foundation [contact redacted]');
  });
  it('fails fast without storing when the neutral fallback still fails validation', async () => {
    const envelope = member360Fixture();
    const valid = envelopeSchema.safeParse(envelope),
      invalid = envelopeSchema.safeParse({});
    const parse = vi.spyOn(envelopeSchema, 'safeParse').mockReturnValueOnce(valid).mockReturnValue(invalid);
    mocks.getRawEventPayloads.mockResolvedValue([finalized(envelope)]);
    try {
      await expect(new Member360Service().result(req, 'session-1', 'sample-project')).rejects.toMatchObject({
        statusCode: 400,
        code: MEMBER_360_INVALID_RESULT,
      });
      expect(mocks.recordGeneration).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  });
});
