// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// The controller's own job: the shape gates, the writer check on the
// SERVER-resolved project, and the owner token that binds a session to its
// creator and to the revision it exports. The export service is mocked; the
// session token util runs for real.
const exportMocks = vi.hoisted(() => ({
  startExport: vi.fn(),
  getResult: vi.fn(),
  getLast: vi.fn(),
  startFamilyExport: vi.fn(),
  getFamilyResult: vi.fn(),
  getFamilyLast: vi.fn(),
}));
const projectMocks = vi.hoisted(() => ({ getProjectById: vi.fn() }));
const authMocks = vi.hoisted(() => ({ getEffectiveUsername: vi.fn((): string | null => 'user-1') }));
const loggerMocks = vi.hoisted(() => ({
  startOperation: vi.fn(() => 0),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
}));

vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-artifact.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-document-store.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-slides-export.constants')),
}));
vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/mktg-document-store.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/mktg-slides-export.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/mktg-family-export.utils')),
}));
vi.mock('../services/mktg-slides-export.service', () => ({
  MktgSlidesExportService: class {
    public startExport = exportMocks.startExport;
    public getResult = exportMocks.getResult;
    public getLast = exportMocks.getLast;
    public startFamilyExport = exportMocks.startFamilyExport;
    public getFamilyResult = exportMocks.getFamilyResult;
    public getFamilyLast = exportMocks.getFamilyLast;
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

import { AuthorizationError, ServiceValidationError } from '../errors';
import { MktgSlidesExportController } from './mktg-slides-export.controller';

const REVISION_ID = `000001-${'a'.repeat(64)}`;

function call(
  method: 'start' | 'result' | 'last',
  input: { body?: Record<string, unknown>; query?: Record<string, unknown> }
): Promise<{ json: ReturnType<typeof vi.fn>; next: ReturnType<typeof vi.fn> }> {
  const controller = new MktgSlidesExportController();
  const json = vi.fn();
  const next = vi.fn();
  const req = { body: input.body ?? {}, query: input.query ?? {}, path: `/api/mktg-agents/slides-export/${method}` } as unknown as Request;
  return controller[method](req, { json } as unknown as Response, next as unknown as NextFunction).then(() => ({ json, next }));
}

const startBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  project: 'proj-uid-1',
  agentKey: 'foundation-message',
  documentId: 'living',
  revisionId: REVISION_ID,
  mode: 'create',
  ...overrides,
});

describe('MktgSlidesExportController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.getEffectiveUsername.mockReturnValue('user-1');
    projectMocks.getProjectById.mockResolvedValue({ uid: 'proj-uid-1', name: 'Example Project', writer: true });
    exportMocks.startExport.mockResolvedValue({
      sessionId: 'session-1',
      revision: { id: REVISION_ID, number: 1, contentSha256: 'a'.repeat(64) },
      mode: 'create',
      logoNote: 'not-public',
    });
    exportMocks.getResult.mockResolvedValue({ status: 'pending' });
  });

  it('starts an export of the named revision for the resolved project, and its token reads that export back', async () => {
    // Image bytes from the browser are never taken: the server draws the stored kit's logo itself.
    const { json, next } = await call('start', { body: startBody({ logoPng: 'iVBORw0KGgo=' }) });

    expect(next).not.toHaveBeenCalled();
    expect(exportMocks.startExport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        project: 'proj-uid-1',
        projectName: 'Example Project',
        agentKey: 'foundation-message',
        documentId: 'living',
        selector: { revisionId: REVISION_ID, contentSha256: undefined },
        mode: 'create',
      })
    );
    expect(exportMocks.startExport.mock.calls[0][1]).not.toHaveProperty('logoPng');
    const response = json.mock.calls[0][0] as { ownerToken: string; sessionId: string };
    expect(response).toMatchObject({ sessionId: 'session-1', logoNote: 'not-public' });

    const poll = await call('result', { body: { ...startBody(), sessionId: 'session-1', ownerToken: response.ownerToken } });
    expect(poll.next).not.toHaveBeenCalled();
    expect(poll.json).toHaveBeenCalledWith({ status: 'pending' });

    // The same token cannot read the session as an export of another revision.
    const other = await call('result', {
      body: { ...startBody(), revisionId: `000002-${'b'.repeat(64)}`, sessionId: 'session-1', ownerToken: response.ownerToken },
    });
    expect(other.next.mock.calls[0][0]).toBeInstanceOf(AuthorizationError);
    expect(exportMocks.getResult).toHaveBeenCalledTimes(1);
  });

  it('refuses a malformed target or mode before anything is read', async () => {
    for (const body of [
      startBody({ project: '../other' }),
      startBody({ agentKey: 'icp' }),
      startBody({ documentId: 'run-x' }),
      startBody({ revisionId: 'latest' }),
      startBody({ contentSha256: 'ABC' }),
      startBody({ mode: 'replace' }),
    ]) {
      const { next } = await call('start', { body });
      expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    }
    expect(projectMocks.getProjectById).not.toHaveBeenCalled();
    expect(exportMocks.startExport).not.toHaveBeenCalled();
  });

  it('requires the writer grant on the project', async () => {
    projectMocks.getProjectById.mockResolvedValue({ uid: 'proj-uid-1', name: 'Example Project', writer: false });

    const { next } = await call('start', { body: startBody() });

    expect(next.mock.calls[0][0]).toBeInstanceOf(AuthorizationError);
    expect(exportMocks.startExport).not.toHaveBeenCalled();
  });

  describe('family boundary', () => {
    const target = { project: 'proj-uid-1', familyId: 'positioning-brand' };
    const snapshot = {
      ...target,
      mode: 'create',
      deckId: null,
      members: [{ agentKey: 'foundation-message', documentId: 'living', revisionId: REVISION_ID, revisionNumber: 1, contentSha256: 'a'.repeat(64) }],
    };
    async function familyCall(action: 'start' | 'result' | 'last', raw: Record<string, unknown>) {
      const json = vi.fn();
      const next = vi.fn();
      const req = { body: raw, query: raw, path: `/slides-export/family/${action}` } as Request;
      const res: Partial<Response> = { json };
      await new MktgSlidesExportController().family(req, res as Response, next, action);
      return { json, next };
    }
    async function started() {
      exportMocks.startFamilyExport.mockResolvedValue({
        sessionId: 'family-session',
        snapshot,
        skippedMembers: ['brand-kit', 'boilerplates', 'faq'],
        logoNote: 'no-logo',
      });
      const result = await familyCall('start', { ...target, mode: 'create', assets: { forged: true }, deckId: 'forged-deck' });
      expect(result.next).not.toHaveBeenCalled();
      return result.json.mock.calls[0][0] as { ownerToken: string };
    }

    it('starts with server project identity and no browser assets; signs a poll bound to the member revisions', async () => {
      const start = await started();
      expect(exportMocks.startFamilyExport).toHaveBeenCalledWith(expect.anything(), { ...target, projectName: 'Example Project', mode: 'create' });
      exportMocks.getFamilyResult.mockResolvedValue({ status: 'pending' });
      const result = await familyCall('result', { ...target, sessionId: 'family-session', ownerToken: start.ownerToken, snapshot });
      expect(result.next).not.toHaveBeenCalled();
      expect(result.json).toHaveBeenCalledWith({ status: 'pending' });
    });

    it('rejects tampered refs, mode, family, project, session, token and different users', async () => {
      const start = await started();
      for (const change of [
        { snapshot: { ...snapshot, members: [{ ...snapshot.members[0], revisionNumber: 2 }] } },
        { snapshot: { ...snapshot, mode: 'update', deckId: 'synthetic_deck_123' } },
        { snapshot: { ...snapshot, project: 'other-project' } },
        { sessionId: 'other-session' },
        { ownerToken: 'invalid' },
      ]) {
        const result = await familyCall('result', { ...target, sessionId: 'family-session', ownerToken: start.ownerToken, snapshot, ...change });
        expect(result.next).toHaveBeenCalledWith(expect.any(AuthorizationError));
      }
      authMocks.getEffectiveUsername.mockReturnValue('other-writer');
      expect((await familyCall('result', { ...target, sessionId: 'family-session', ownerToken: start.ownerToken, snapshot })).next).toHaveBeenCalledWith(
        expect.any(AuthorizationError)
      );
      expect(exportMocks.getFamilyResult).not.toHaveBeenCalled();
    });

    it.each(['start', 'result', 'last'] as const)('requires writer access for family %s', async (action) => {
      projectMocks.getProjectById.mockResolvedValue({ uid: target.project, writer: false });
      expect((await familyCall(action, { ...target, mode: 'create' })).next).toHaveBeenCalledWith(expect.any(AuthorizationError));
    });

    it('validates the catalog family, project and mode before calling the exporter', async () => {
      for (const input of [
        { ...target, familyId: '../escape' },
        { ...target, familyId: 'website-web' },
        { ...target, project: '../escape' },
        { ...target, mode: 'replace' },
      ]) {
        expect((await familyCall('start', input)).next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
      }
      expect(exportMocks.startFamilyExport).not.toHaveBeenCalled();
    });

    it('returns the last export and approved freshness independently of start', async () => {
      exportMocks.getFamilyLast.mockResolvedValue({ last: null, currentMembers: [], skippedMembers: [], stale: false });
      expect((await familyCall('last', target)).json).toHaveBeenCalledWith({ last: null, currentMembers: [], skippedMembers: [], stale: false });
      expect(exportMocks.getFamilyLast).toHaveBeenCalledWith(expect.anything(), target.project, target.familyId);
    });
  });

  it('reads the last export of a document for a writer', async () => {
    exportMocks.getLast.mockResolvedValue({ last: null, latestRevision: null });

    const { json } = await call('last', { query: { project: 'proj-uid-1', agentKey: 'brand-kit', documentId: 'living' } });

    expect(exportMocks.getLast).toHaveBeenCalledWith(
      expect.anything(),
      'proj-uid-1',
      expect.objectContaining({ agentKey: 'brand-kit' }),
      'brand-kit',
      'living'
    );
    expect(json).toHaveBeenCalledWith({ last: null, latestRevision: null });
  });
});
