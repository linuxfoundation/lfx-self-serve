// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import type { MktgSignOffChangeCommand, MktgSignOffChangeScope } from '@lfx-one/shared/interfaces';
import type { MktgDocumentRunService } from './mktg-document-run.service';
const f = vi.hoisted(() => ({
  transition: vi.fn(),
  annotation: vi.fn(),
  view: vi.fn(),
  add: vi.fn(),
  send: vi.fn(),
  proof: vi.fn(),
  actor: vi.fn(),
  project: vi.fn(),
}));
vi.mock('@lfx-one/shared/constants', async () => vi.importActual('../../../../../packages/shared/src/constants/mktg-document-comments.constants'));
vi.mock('@lfx-one/shared/utils', async () => vi.importActual('../../../../../packages/shared/src/utils/mktg-sign-off.utils'));
vi.mock('./mktg-document-store.service', () => ({
  MktgDocumentStoreService: class {
    public changeRequestTransition = f.transition;
    public signOffAnnotation = f.annotation;
    public getRevision = f.view;
  },
}));
vi.mock('./mktg-document-comments.service', () => ({
  MktgDocumentCommentsService: class {
    public addWithReceipt = f.add;
    public signOffSubmissionProof = f.proof;
  },
}));
vi.mock('./mktg-document-redraft.service', () => ({
  MktgDocumentRedraftService: class {
    public send = f.send;
  },
}));
vi.mock('./mktg-document-author.service', () => ({
  MktgDocumentAuthorService: class {
    public captureAuthorId = f.actor;
  },
}));
vi.mock('./project.service', () => ({
  ProjectService: class {
    public getProjectById = f.project;
  },
}));
import { mktgSignOffRequestIds } from '@lfx-one/shared/utils';
import { AuthorizationError, ConflictError, MicroserviceError, PreconditionFailedError } from '../errors';
import { MktgSignOffChangesService } from './mktg-sign-off-changes.service';

const req = {} as Request;
const runs = {} as MktgDocumentRunService;
const scope: MktgSignOffChangeScope = {
  project: 'synthetic-project',
  type: { agentKey: 'brand-kit', kind: 'living', label: 'Kit', itemLabel: 'Kit', agentName: 'Kit' },
  documentId: 'living',
  revisionId: `000002-${'a'.repeat(64)}`,
  role: 'ed',
  nonce: 'nonce-one',
};
const intent = {
  id: '11111111-1111-4111-8111-111111111111',
  role: 'ed',
  nonce: scope.nonce,
  startedAt: '2026-10-24T00:00:00Z',
  phase: 'prepared',
  note: 'Frozen original note.',
} as const;
const annotation = { state: 'pending', roles: { ed: 'auth0|ed', tocChair: 'auth0|chair' }, changeRequestIntent: intent };
const view = { revision: { id: scope.revisionId, signOff: { state: 'changes-requested', roles: { ed: { decision: 'changes-requested' }, tocChair: {} } } } };

describe('internal sign-off request changes', () => {
  const service = new MktgSignOffChangesService();
  beforeEach(() => {
    vi.resetAllMocks();
    f.actor.mockReturnValue('auth0|ed');
    f.annotation.mockResolvedValue(annotation);
    f.view.mockResolvedValue(view);
    f.project.mockResolvedValue({ uid: scope.project, writer: true });
    f.transition.mockImplementation(async (...args: unknown[]) => {
      const command = args[5] as MktgSignOffChangeCommand;
      if (typeof args[6] === 'function') await args[6]();
      return { view, intent: command.operation === 'reserve' ? { ...intent, note: command.note } : null };
    });
    f.add.mockResolvedValue({ commentId: 'exact-comment', response: { threads: [{ id: 'unrelated-first-comment' }] } });
    f.send.mockImplementation(async (...args: unknown[]) => {
      if (typeof args[6] === 'function') await args[6]();
      return { sessionId: 'synthetic-private-session', ownerToken: 'synthetic-private-capability' };
    });
    f.proof.mockImplementation(async (...args: unknown[]) => {
      if (typeof args[5] === 'function') await args[5]();
      return { state: 'absent', commentId: null };
    });
  });

  it('reserves → adds the exact whole-asset comment → uses the existing send/barrier → final CAS, with no capability return', async () => {
    const result = await service.requestChanges(req, scope, 'Original note.', runs);
    expect(f.transition.mock.calls.map((call) => call[5].operation)).toEqual(['reserve', 'start', 'finish']);
    expect(f.add).toHaveBeenCalledWith(
      req,
      scope.project,
      scope.type,
      'living',
      expect.objectContaining({ anchor: { kind: 'document', key: 'chapters' }, text: 'Original note.' })
    );
    expect(f.send).toHaveBeenCalledWith(
      req,
      scope.project,
      scope.type,
      'living',
      expect.objectContaining({
        commentIds: ['exact-comment'],
        ...{ clientRequestId: mktgSignOffRequestIds(scope.revisionId, scope.role, scope.nonce)?.requestId },
      }),
      runs,
      expect.any(Function)
    );
    expect(f.transition.mock.calls[0][6]).toBeUndefined();
    expect(f.transition.mock.invocationCallOrder[0]).toBeLessThan(f.add.mock.invocationCallOrder[0]);
    expect(f.add.mock.invocationCallOrder[0]).toBeLessThan(f.send.mock.invocationCallOrder[0]);
    expect(result).toBe(view);
    expect(JSON.stringify(result)).not.toContain('synthetic-private');
  });

  it('does not finalize on uncertain acceptance and leaves recovery to the same frozen input/nonce', async () => {
    const failure = new MicroserviceError('Uncertain', 503, 'MKTG_REDRAFT_START_UNCERTAIN');
    f.send.mockImplementationOnce(async (...args: unknown[]) => {
      if (typeof args[6] === 'function') await args[6]();
      throw failure;
    });
    await expect(service.requestChanges(req, scope, intent.note, runs)).rejects.toBe(failure);
    expect(f.transition.mock.calls.map((call) => call[5].operation)).toEqual(['reserve', 'start']);
    await service.recover(req, scope, runs);
    expect(f.transition.mock.calls[2][5]).toMatchObject({ operation: 'reserve', note: intent.note, nonce: scope.nonce });
    expect(f.send.mock.calls[1][4]).toEqual(f.send.mock.calls[0][4]); // Existing CR replay owns dedupe, not a new send implementation.
  });

  it('reports a final CAS failure without retrying or submitting a second redraft automatically', async () => {
    f.transition.mockImplementation(async (...args: unknown[]) => {
      const command = args[5] as MktgSignOffChangeCommand;
      if (command.operation === 'finish') throw new PreconditionFailedError();
      return { view, intent: { ...intent, note: intent.note } };
    });
    await expect(service.requestChanges(req, scope, intent.note, runs)).rejects.toMatchObject({ statusCode: 412 });
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it('returns FAQ/terminal atomic results without any comment or redraft call', async () => {
    f.transition.mockResolvedValue({ view, intent: null });
    expect(await service.requestChanges(req, scope, intent.note, runs)).toBe(view);
    expect(f.add).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });

  it('does not adopt the other role terminal action when a client nonce happens to match', async () => {
    f.transition.mockResolvedValue({
      view: { revision: { signOff: { state: 'changes-requested', roles: { ed: {}, tocChair: { decision: 'changes-requested' } } } } },
      intent: null,
    });
    await expect(service.requestChanges(req, scope, intent.note, runs)).rejects.toMatchObject({ code: 'MKTG_SIGN_OFF_INTENT_CHANGED' });
    f.annotation.mockResolvedValue({
      ...annotation,
      state: 'changes-requested',
      changeRequestIntent: undefined,
      changeRequestNonce: scope.nonce,
      decisions: { tocChair: { decision: 'changes-requested' } },
    });
    await expect(service.recover(req, scope, runs)).rejects.toMatchObject({ code: 'MKTG_SIGN_OFF_INTENT_CHANGED' });
    expect(f.add).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });

  it('lets a writer release a prepared worker even if its CR reservation would report BUSY', async () => {
    f.actor.mockReturnValue('auth0|project-writer');
    f.proof.mockRejectedValue(new ConflictError('Reserved CR', 'MKTG_REDRAFT_COMMENTS_BUSY'));
    expect(await service.release(req, scope)).toBe(view);
    expect(f.transition.mock.calls[0][5]).toEqual({
      operation: 'release',
      role: scope.role,
      nonce: scope.nonce,
      intentId: intent.id,
      proof: 'unstarted',
    });
    expect(f.project).toHaveBeenCalledWith(req, scope.project, true);
    expect(f.proof).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
    expect(f.actor()).toBe('auth0|project-writer');
  });

  it('does not turn a lost prepared-release fence into a CR or provider retry', async () => {
    f.transition.mockRejectedValue(new PreconditionFailedError());
    await expect(service.release(req, scope)).rejects.toMatchObject({ statusCode: 412 });
    expect(f.proof).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });

  it.each(['failed', 'released'] as const)('uses only explicit %s proof to release, preserving the original actor and current Request', async (state) => {
    f.annotation.mockResolvedValue({ ...annotation, changeRequestIntent: { ...intent, phase: 'starting' } });
    f.actor.mockReturnValue('auth0|project-writer');
    f.proof.mockImplementation(async (...args: unknown[]) => {
      if (typeof args[5] === 'function') await args[5]();
      return { state, commentId: state === 'absent' ? null : 'exact-comment' };
    });
    await service.release(req, scope);
    expect(f.proof).toHaveBeenCalledWith(req, scope.project, scope.type, 'living', expect.objectContaining({ requestedBy: 'auth0|ed' }), expect.any(Function));
    expect(f.transition.mock.calls[0][5]).toMatchObject({ operation: 'release', proof: state, intentId: intent.id });
    expect(f.actor()).toBe('auth0|project-writer');
    expect(f.send).not.toHaveBeenCalled();
    expect(f.add).not.toHaveBeenCalled();
  });

  it('settles accepted/descriptor-confirmed work instead of releasing it, without another Guild send', async () => {
    f.annotation.mockResolvedValue({ ...annotation, changeRequestIntent: { ...intent, phase: 'starting' } });
    f.actor.mockReturnValue('auth0|project-writer');
    f.proof.mockResolvedValue({ state: 'accepted', commentId: 'accepted-comment' });
    await service.release(req, scope);
    expect(f.transition.mock.calls[0][5]).toMatchObject({ operation: 'finish', receipt: { commentId: 'accepted-comment' } });
    expect(f.send).not.toHaveBeenCalled();
  });

  it('refuses in-flight evidence and a foreign non-writer without changing pointer/ledger state', async () => {
    f.annotation.mockResolvedValue({ ...annotation, changeRequestIntent: { ...intent, phase: 'starting' } });
    f.proof.mockResolvedValue({ state: 'in-flight', commentId: 'exact-comment' });
    await expect(service.release(req, scope)).rejects.toMatchObject({ code: 'MKTG_SIGN_OFF_RELEASE_UNSAFE' });
    expect(f.transition).not.toHaveBeenCalled();
    f.actor.mockReturnValue('auth0|foreign');
    f.project.mockResolvedValue({ uid: scope.project, writer: false });
    f.proof.mockClear();
    await expect(service.release(req, scope)).rejects.toBeInstanceOf(AuthorizationError);
    expect(f.proof).not.toHaveBeenCalled();
    expect(f.transition).not.toHaveBeenCalled();
  });

  it('does not treat an absent CR row as no-start proof after the intent has started', async () => {
    f.annotation.mockResolvedValue({ ...annotation, changeRequestIntent: { ...intent, phase: 'starting' } });
    f.proof.mockResolvedValue({ state: 'absent', commentId: null });
    await expect(service.release(req, scope)).rejects.toMatchObject({ code: 'MKTG_SIGN_OFF_RELEASE_UNSAFE' });
    expect(f.transition).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });

  it('does not let a writer impersonate the role actor for recovery, or allow impersonation/missing identity', async () => {
    f.actor.mockReturnValue('auth0|project-writer');
    await expect(service.recover(req, scope, runs)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(service.requestChanges({ impersonationActive: true } as Request, scope, intent.note, runs)).rejects.toMatchObject({ statusCode: 403 });
    f.actor.mockReturnValue(null);
    await expect(service.requestChanges(req, scope, intent.note, runs)).rejects.toMatchObject({ statusCode: 401 });
    expect(f.transition).not.toHaveBeenCalled();
  });
});
