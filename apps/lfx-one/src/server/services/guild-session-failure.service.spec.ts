// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';
import { MKTG_AGENT_INTAKES } from '@lfx-one/shared/constants';
import { getMktgSessionOutcome } from '@lfx-one/shared/utils';
import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./logger.service', () => ({ logger: { debug: vi.fn(), warning: vi.fn() } }));
import { GuildService } from './guild.service';
import { logger } from './logger.service';

const old = new Date(Date.now() - 60_000).toISOString();
const error = { type: 'runtime_error', created_at: old, content: { error: 'PRIVATE fetch failed' } };
function request(path = Object.values(MKTG_AGENT_INTAKES)[0].endpoints.result): Request {
  return { originalUrl: path } as Request;
}
function ok(items: unknown[]): Response {
  return { ok: true, json: async () => ({ items }) } as Response;
}

describe('shared Guild outcome service (synthetic event replay, no session metadata probe)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubEnv('GUILD_API_KEY', 'synthetic-test-key');
    vi.stubEnv('GUILD_API_URL', 'https://guild.test');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });
  for (const intake of Object.values(MKTG_AGENT_INTAKES)) {
    it(`resolves ${intake.agentId} before logging, reusing its authenticated event read`, async () => {
      const req = request(intake.endpoints.result);
      fetchMock.mockResolvedValueOnce(ok([error, { type: 'runtime_done', created_at: new Date(Date.parse(old) + 1000).toISOString() }]));
      await new GuildService().getRawEventPayloads(req, 'synthetic-session');
      const result = await new GuildService().resolveRunOutcome(req, ' synthetic-session ', { status: 'pending' });
      expect(result).toMatchObject({ status: 'failed', failure: { eventType: 'runtime_error' } });
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  }
  it.each(['ready', 'refused', 'failed', 'needs_input'] as const)('never probes or replaces a validated %s result', async (status) => {
    const body = {
      status,
      ...(status === 'failed'
        ? { failureText: 'Synthetic idle-runtime reply.', failure: { reason: 'Keep this terminal reason.', eventType: 'runtime_error' } }
        : {}),
    };
    expect(await new GuildService().resolveRunOutcome(request(), 'session', body)).toBe(body);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('uses a trusted registered result endpoint for Documents reads without mutating the request', async () => {
    const req = request('/api/mktg-agents/documents/linkedin-post/run-0123456789abcdef01234567');
    const endpoint = MKTG_AGENT_INTAKES['linkedin-post']?.endpoints.result;
    expect(endpoint).toBeTypeOf('string');
    const pending = { status: 'pending' };
    expect(await new GuildService().resolveRunOutcome(req, 'session', pending)).toBe(pending);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(ok([error]));
    expect(await new GuildService().resolveRunOutcome(req, 'session', pending, endpoint)).toMatchObject({ status: 'failed' });
    expect(req.originalUrl).toBe('/api/mktg-agents/documents/linkedin-post/run-0123456789abcdef01234567');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('refuses an unregistered internal endpoint override', async () => {
    const pending = { status: 'pending' };
    expect(await new GuildService().resolveRunOutcome(request(), 'session', pending, '/api/not-a-result')).toBe(pending);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('distinguishes main idle completion from an error before any runtime/model turn', () => {
    expect(getMktgSessionOutcome([JSON.stringify(error)]).ended).toBe(false);
    const task = { id: 'synthetic-agent-task', entity_type: 'EntTaskAgent' };
    const completed = [{ type: 'runtime_start', task }, error, { type: 'runtime_done', task }].map((event) => JSON.stringify(event));
    expect(getMktgSessionOutcome(completed)).toEqual({ ended: true, replyText: '' });
  });
  it.each(['status_update', 'session_closing'])('does not let passive %s hide a settled session error', async (type) => {
    fetchMock.mockResolvedValueOnce(ok([error, { type, created_at: new Date(Date.parse(old) + 1000).toISOString() }]));
    expect(await new GuildService().resolveRunOutcome(request(), 'session', { status: 'pending' })).toMatchObject({ status: 'failed' });
  });
  it('does not override a pending result for a tool-task runtime error', async () => {
    fetchMock.mockResolvedValueOnce(
      ok([
        { type: 'runtime_start', created_at: new Date(Date.parse(old) - 1000).toISOString(), task: { entity_type: 'EntTaskAgent', id: 'synthetic-root' } },
        { ...error, task: { entity_type: 'EntTaskTool', id: 'synthetic-tool' } },
      ])
    );
    expect(await new GuildService().resolveRunOutcome(request(), 'session', { status: 'pending' })).toEqual({ status: 'pending' });
  });
  it('keeps a recovering/healthy session pending and never calls session metadata', async () => {
    fetchMock.mockResolvedValueOnce(ok([error, { type: 'llm_start', created_at: new Date(Date.parse(old) + 1000).toISOString() }]));
    expect(await new GuildService().resolveRunOutcome(request(), 'session', { status: 'pending' })).toEqual({ status: 'pending' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/events?');
  });
  it('keeps questions delivered after recovery, but fails questions postdated by a settled last error', async () => {
    const question = { type: 'agent_notification_message', created_at: new Date().toISOString(), content: 'QUESTIONS (synthetic gap)' };
    fetchMock.mockResolvedValueOnce(ok([error, question]));
    expect(await new GuildService().resolveRunOutcome(request(), 'session', { status: 'questions' })).toEqual({ status: 'questions' });
    fetchMock.mockResolvedValueOnce(ok([{ ...question, created_at: new Date(Date.now() - 120_000).toISOString() }, error]));
    expect(await new GuildService().resolveRunOutcome(request(), 'session', { status: 'questions' })).toMatchObject({ status: 'failed' });
  });
  it('keeps the original result and logs a warning when a best-effort events lookup fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden', text: async () => '{}' });
    const result = { status: 'pending' as const };
    expect(await new GuildService().resolveRunOutcome(request(), 'session', result)).toBe(result);
    expect(logger.warning).toHaveBeenCalledWith(expect.anything(), 'mktg_run_failure_lookup', expect.any(String), {
      err: expect.objectContaining({ statusCode: 403 }),
    });
  });
});
