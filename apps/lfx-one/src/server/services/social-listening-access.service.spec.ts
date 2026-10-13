// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The service's import graph transitively reaches Angular's partially-compiled @angular/common;
// under vitest that needs the JIT compiler, so load it before importing the module under test.
import '@angular/compiler';

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getPersonas, checkProjectWriter, getProjectIdBySlug, canBoardMemberViewSocialListening, getUsernameFromAuth } = vi.hoisted(() => ({
  getPersonas: vi.fn(),
  checkProjectWriter: vi.fn(),
  getProjectIdBySlug: vi.fn(),
  canBoardMemberViewSocialListening: vi.fn(),
  getUsernameFromAuth: vi.fn(),
}));

vi.mock('../utils/persona-helper', () => ({
  personaDetectionService: { getPersonas: () => getPersonas(), checkProjectWriter: (...args: unknown[]) => checkProjectWriter(...args) },
}));
vi.mock('../utils/auth-helper', () => ({ getUsernameFromAuth: () => getUsernameFromAuth() }));
vi.mock('./project.service', () => ({
  ProjectService: class {
    public getProjectIdBySlug = getProjectIdBySlug;
  },
}));
vi.mock('./committee.service', () => ({
  CommitteeService: class {
    public canBoardMemberViewSocialListening = canBoardMemberViewSocialListening;
  },
}));
vi.mock('./logger.service', () => ({ logger: { warning: vi.fn(), debug: vi.fn() } }));

const { SocialListeningAccessService } = await import('./social-listening-access.service');

const req = {} as Request;

function personas(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { personas: ['board-member'], personaProjects: {}, isRootWriter: false, isLFStaff: false, ...overrides };
}

describe('SocialListeningAccessService.getAccess', () => {
  let service: InstanceType<typeof SocialListeningAccessService>;

  beforeEach(() => {
    getPersonas.mockReset().mockResolvedValue(personas());
    checkProjectWriter.mockReset().mockResolvedValue(false);
    getProjectIdBySlug.mockReset().mockResolvedValue({ uid: 'tlf-uid', slug: 'tlf', exists: true });
    canBoardMemberViewSocialListening.mockReset().mockResolvedValue(true);
    getUsernameFromAuth.mockReset().mockResolvedValue('board-user');
    service = new SocialListeningAccessService();
  });

  it('admits LF Staff without a Board lookup', async () => {
    getPersonas.mockResolvedValue(personas({ personas: ['contributor'], isLFStaff: true }));

    await expect(service.getAccess(req, 'tlf')).resolves.toEqual({ canView: true, reason: 'lf-staff' });
    expect(canBoardMemberViewSocialListening).not.toHaveBeenCalled();
  });

  it('admits an ED of the requested foundation without a Board lookup', async () => {
    getPersonas.mockResolvedValue(
      personas({ personas: ['executive-director'], personaProjects: { 'executive-director': [{ projectUid: 'u', projectSlug: 'TLF', projectName: 'TLF' }] } })
    );

    await expect(service.getAccess(req, 'tlf')).resolves.toEqual({ canView: true, reason: 'executive-director' });
    expect(canBoardMemberViewSocialListening).not.toHaveBeenCalled();
  });

  it("falls back to the Board check for an ED outside their foundation, against that foundation's uid", async () => {
    getPersonas.mockResolvedValue(
      personas({ personas: ['executive-director'], personaProjects: { 'executive-director': [{ projectUid: 'u', projectSlug: 'cncf', projectName: 'CNCF' }] } })
    );

    await expect(service.getAccess(req, 'tlf')).resolves.toEqual({ canView: true, reason: 'board' });
    expect(canBoardMemberViewSocialListening).toHaveBeenCalledWith(req, 'tlf-uid');
  });

  it("admits a Board member when the foundation's Board group opted in", async () => {
    await expect(service.getAccess(req, 'TLF')).resolves.toEqual({ canView: true, reason: 'board' });
    expect(getProjectIdBySlug).toHaveBeenCalledWith(req, 'tlf');
  });

  it('denies a Board member when the Board group has not opted in (the default)', async () => {
    canBoardMemberViewSocialListening.mockResolvedValue(false);

    await expect(service.getAccess(req, 'tlf')).resolves.toEqual({ canView: false, reason: 'none' });
  });

  it('denies a non-ED caller when no foundation is named — Board access is always foundation-scoped', async () => {
    await expect(service.getAccess(req, '')).resolves.toEqual({ canView: false, reason: 'none' });
    expect(getProjectIdBySlug).not.toHaveBeenCalled();
  });

  it('denies a malformed slug without looking it up', async () => {
    await expect(service.getAccess(req, 'tlf;drop')).resolves.toEqual({ canView: false, reason: 'none' });
    expect(getProjectIdBySlug).not.toHaveBeenCalled();
  });

  it('denies an unknown foundation', async () => {
    getProjectIdBySlug.mockResolvedValue({ uid: '', slug: 'nope', exists: false });

    await expect(service.getAccess(req, 'nope')).resolves.toEqual({ canView: false, reason: 'none' });
    expect(canBoardMemberViewSocialListening).not.toHaveBeenCalled();
  });

  it('remembers the Board answer per user and foundation, and coalesces concurrent lookups', async () => {
    await Promise.all([service.getAccess(req, 'tlf'), service.getAccess(req, 'tlf'), service.getAccess(req, 'tlf')]);
    await service.getAccess(req, 'tlf');

    expect(canBoardMemberViewSocialListening).toHaveBeenCalledTimes(1);

    getUsernameFromAuth.mockResolvedValue('another-user');
    await service.getAccess(req, 'tlf');
    expect(canBoardMemberViewSocialListening).toHaveBeenCalledTimes(2);
  });

  it('does not remember a slug that failed to resolve (the NATS lookup reports failures as not found)', async () => {
    getProjectIdBySlug.mockResolvedValueOnce({ uid: '', slug: 'tlf', exists: false });

    await expect(service.getAccess(req, 'tlf')).resolves.toEqual({ canView: false, reason: 'none' });
    await expect(service.getAccess(req, 'tlf')).resolves.toEqual({ canView: true, reason: 'board' });
  });

  it('fails closed on an upstream error and does not remember the failure', async () => {
    canBoardMemberViewSocialListening.mockRejectedValueOnce(new Error('query service down'));

    await expect(service.getAccess(req, 'tlf')).resolves.toEqual({ canView: false, reason: 'none' });
    await expect(service.getAccess(req, 'tlf')).resolves.toEqual({ canView: true, reason: 'board' });
  });
});
