// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Shared runtime constants are re-exported from their Angular-free source module (as in mktg-agents.controller.spec.ts).
const guildMocks = vi.hoisted(() => ({
  workspaces: [] as (string | undefined)[],
  createSession: vi.fn(),
  sendFollowUp: vi.fn(),
  getHistory: vi.fn(),
  getRawEventPayloads: vi.fn(),
}));
const projectMocks = vi.hoisted(() => ({ getProjectById: vi.fn() }));
const authMocks = vi.hoisted(() => ({ getEffectiveSub: vi.fn((): string | null => 'auth0|user-1') }));
const loggerMocks = vi.hoisted(() => ({ startOperation: vi.fn(() => 0), success: vi.fn(), debug: vi.fn(), warning: vi.fn(), info: vi.fn(), error: vi.fn() }));

vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/it-os-guild.constants')),
  MKTG_SESSION_EVENTS_TRUNCATED: 'mktg_session_events_truncated',
  MKTG_SESSION_TURN_STARTED: 'mktg_session_turn_started',
}));
vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('../services/guild.service', () => ({
  GuildService: class {
    public createSession = guildMocks.createSession;
    public sendFollowUp = guildMocks.sendFollowUp;
    public getHistory = guildMocks.getHistory;
    public getRawEventPayloads = guildMocks.getRawEventPayloads;
    public constructor(workspace?: string) {
      guildMocks.workspaces.push(workspace);
    }
  },
}));
vi.mock('../services/project.service', () => ({
  ProjectService: class {
    public getProjectById = projectMocks.getProjectById;
  },
}));
vi.mock('../services/logger.service', () => ({ logger: loggerMocks }));
vi.mock('../utils/auth-helper', () => authMocks);

import type { NextFunction, Request, Response } from 'express';

import { ItOsAgentsController } from './it-os-agents.controller';
import { createSessionOwnerToken } from '../utils/mktg-session-token.util';

const PROJECT = 'a1b2c3d4-0000-4000-8000-000000000001';

function call(method: 'chat' | 'history', body: Record<string, unknown>) {
  const controller = new ItOsAgentsController();
  const req = { body, path: `/${method}` } as unknown as Request;
  const json = vi.fn();
  const res = { json } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;
  return { run: () => controller[method](req, res, next), json, next };
}

const ownerToken = (sessionId: string, user = 'auth0|user-1', project = PROJECT): string =>
  createSessionOwnerToken(user, `it-os:domains:${project}:${sessionId}`);

describe('ItOsAgentsController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guildMocks.workspaces.length = 0;
    process.env['GUILD_IT_OS_WORKSPACE_NAME'] = 'it-os-sandbox';
    projectMocks.getProjectById.mockResolvedValue({ uid: PROJECT, slug: 'test-project-group', writer: true });
    guildMocks.createSession.mockResolvedValue('session-1');
  });

  afterEach(() => {
    delete process.env['GUILD_IT_OS_WORKSPACE_NAME'];
  });

  it('reports live agents only when the IT OS workspace is set', () => {
    const json = vi.fn();
    const controller = new ItOsAgentsController();
    controller.status({} as Request, { json } as unknown as Response);
    delete process.env['GUILD_IT_OS_WORKSPACE_NAME'];
    controller.status({} as Request, { json } as unknown as Response);

    expect(json.mock.calls).toEqual([[{ agents: ['domains'] }], [{ agents: [] }]]);
  });

  it('refuses every call when the IT OS workspace is not set', async () => {
    delete process.env['GUILD_IT_OS_WORKSPACE_NAME'];
    const { run, next } = call('chat', { agentId: 'domains', project: PROJECT, message: 'hi' });
    await run();

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 503, code: 'IT_OS_NOT_CONFIGURED' });
    expect(guildMocks.createSession).not.toHaveBeenCalled();
  });

  it('starts a session in the IT OS workspace with the server-resolved project slug', async () => {
    const { run, json, next } = call('chat', { agentId: 'domains', project: PROJECT, message: '  What domains do we have?  ' });
    await run();

    expect(next).not.toHaveBeenCalled();
    expect(guildMocks.workspaces).toEqual(['it-os-sandbox']);
    expect(projectMocks.getProjectById).toHaveBeenCalledWith(expect.anything(), PROJECT, true);
    expect(guildMocks.createSession).toHaveBeenCalledWith(expect.anything(), {
      message: 'Project slug: test-project-group\n\nWhat domains do we have?',
      handle: 'it-os-domains',
    });
    expect(json).toHaveBeenCalledWith({ sessionId: 'session-1', ownerToken: ownerToken('session-1') });
  });

  it('refuses users without write access to the project', async () => {
    projectMocks.getProjectById.mockResolvedValue({ uid: PROJECT, slug: 'test-project-group', writer: false });
    const { run, next } = call('chat', { agentId: 'domains', project: PROJECT, message: 'hi' });
    await run();

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403 });
    expect(guildMocks.createSession).not.toHaveBeenCalled();
  });

  it('refuses agents that are not live and malformed project uids', async () => {
    const agent = call('chat', { agentId: 'github', project: PROJECT, message: 'hi' });
    await agent.run();
    const inherited = call('chat', { agentId: 'toString', project: PROJECT, message: 'hi' });
    await inherited.run();
    const project = call('chat', { agentId: 'domains', project: '../projects/x', message: 'hi' });
    await project.run();

    expect(agent.next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
    expect(inherited.next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
    expect(project.next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
    expect(projectMocks.getProjectById).not.toHaveBeenCalled();
  });

  it('posts a follow-up only with the owner token issued for this user, project and session', async () => {
    const good = call('chat', { agentId: 'domains', project: PROJECT, message: 'Yes, go ahead.', sessionId: 'session-1', ownerToken: ownerToken('session-1') });
    await good.run();
    expect(guildMocks.sendFollowUp).toHaveBeenCalledWith(expect.anything(), 'session-1', { message: 'Yes, go ahead.', handle: 'it-os-domains' });
    expect(good.json).toHaveBeenCalledWith({ success: true });

    const otherUser = call('chat', {
      agentId: 'domains',
      project: PROJECT,
      message: 'hi',
      sessionId: 'session-1',
      ownerToken: ownerToken('session-1', 'auth0|user-2'),
    });
    await otherUser.run();
    const otherProject = call('chat', {
      agentId: 'domains',
      project: 'other-project',
      message: 'hi',
      sessionId: 'session-1',
      ownerToken: ownerToken('session-1'),
    });
    await otherProject.run();

    expect(otherUser.next.mock.calls[0][0]).toMatchObject({ statusCode: 403 });
    expect(otherProject.next.mock.calls[0][0]).toMatchObject({ statusCode: 403 });
    expect(guildMocks.sendFollowUp).toHaveBeenCalledTimes(1);
  });

  it('returns history without the project line and re-checks write access', async () => {
    guildMocks.getHistory.mockResolvedValue([
      { id: 'e1', sender: 'user', text: 'Project slug: test-project-group\n\nWhat domains do we have?', timestamp: '17:00' },
      { id: 'e2', sender: 'agent', text: 'hurrdurr.org', timestamp: '17:00' },
    ]);
    guildMocks.getRawEventPayloads.mockResolvedValue(
      ['mktg_session_turn_started', 'runtime_start', 'agent_notification_message', 'runtime_done'].map((type) => JSON.stringify({ type }))
    );
    const { run, json } = call('history', { agentId: 'domains', project: PROJECT, sessionId: 'session-1', ownerToken: ownerToken('session-1') });
    await run();

    expect(projectMocks.getProjectById).toHaveBeenCalledTimes(1);
    expect(json).toHaveBeenCalledWith({
      messages: [
        { id: 'e1', sender: 'user', text: 'What domains do we have?', timestamp: '17:00' },
        { id: 'e2', sender: 'agent', text: 'hurrdurr.org', timestamp: '17:00' },
      ],
      turnComplete: true,
      sessionTooLong: false,
    });
    // The completion check reads events before history, so history includes whatever the check saw.
    expect(guildMocks.getRawEventPayloads.mock.invocationCallOrder[0]).toBeLessThan(guildMocks.getHistory.mock.invocationCallOrder[0]);

    const denied = call('history', { agentId: 'domains', project: PROJECT, sessionId: 'session-1', ownerToken: 'nope' });
    await denied.run();
    expect(denied.next.mock.calls[0][0]).toMatchObject({ statusCode: 403 });
  });
});
