// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The service's import graph transitively reaches Angular's partially-compiled @angular/common;
// under vitest that needs the JIT compiler, so load it before importing the module under test.
import '@angular/compiler';

import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getPersonas, checkProjectWriter, getProjectIdBySlug, getProjectById, canGroupMemberViewSocialListening, getUsernameFromAuth, computeIsFoundation } =
  vi.hoisted(() => ({
    getPersonas: vi.fn(),
    checkProjectWriter: vi.fn(),
    getProjectIdBySlug: vi.fn(),
    getProjectById: vi.fn(),
    computeIsFoundation: vi.fn(),
    canGroupMemberViewSocialListening: vi.fn(),
    getUsernameFromAuth: vi.fn(),
  }));

vi.mock('../utils/persona-helper', () => ({
  personaDetectionService: { getPersonas: () => getPersonas(), checkProjectWriter: (...args: unknown[]) => checkProjectWriter(...args) },
}));
vi.mock('../utils/auth-helper', () => ({ getUsernameFromAuth: () => getUsernameFromAuth() }));
vi.mock('./project.service', () => ({
  ProjectService: class {
    public getProjectIdBySlug = getProjectIdBySlug;
    public getProjectById = getProjectById;
  },
}));
vi.mock('./committee.service', () => ({
  CommitteeService: class {
    public canGroupMemberViewSocialListening = canGroupMemberViewSocialListening;
  },
}));
vi.mock('@lfx-one/shared/utils', () => ({ computeIsFoundation: (...args: unknown[]) => computeIsFoundation(...args) }));
vi.mock('./logger.service', () => ({ logger: { warning: vi.fn(), debug: vi.fn() } }));

const { SocialListeningAccessService } = await import('./social-listening-access.service');
const { SOCIAL_LISTENING_GROUP_ACCESS_CACHE_TTL_MS } = await import('../../../../../packages/shared/src/constants/social-listening.constants');

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
    getProjectById.mockReset().mockResolvedValue({ uid: 'tlf-uid', slug: 'tlf' });
    computeIsFoundation.mockReset().mockReturnValue(true);
    canGroupMemberViewSocialListening.mockReset().mockResolvedValue(true);
    getUsernameFromAuth.mockReset().mockResolvedValue('board-user');
    service = new SocialListeningAccessService();
  });

  it('admits LF Staff without a group lookup', async () => {
    getPersonas.mockResolvedValue(personas({ personas: ['contributor'], isLFStaff: true }));

    await expect(service.getAccess(req, 'tlf')).resolves.toEqual({ canView: true, reason: 'lf-staff' });
    expect(canGroupMemberViewSocialListening).not.toHaveBeenCalled();
  });

  it('admits an ED of the requested foundation without a group lookup', async () => {
    getPersonas.mockResolvedValue(
      personas({ personas: ['executive-director'], personaProjects: { 'executive-director': [{ projectUid: 'u', projectSlug: 'TLF', projectName: 'TLF' }] } })
    );

    await expect(service.getAccess(req, 'tlf')).resolves.toEqual({ canView: true, reason: 'executive-director' });
    expect(canGroupMemberViewSocialListening).not.toHaveBeenCalled();
  });

  it("falls back to the group check for an ED outside their foundation, against that foundation's uid", async () => {
    getPersonas.mockResolvedValue(
      personas({ personas: ['executive-director'], personaProjects: { 'executive-director': [{ projectUid: 'u', projectSlug: 'cncf', projectName: 'CNCF' }] } })
    );

    await expect(service.getAccess(req, 'tlf')).resolves.toEqual({ canView: true, reason: 'group-member' });
    expect(canGroupMemberViewSocialListening).toHaveBeenCalledWith(req, 'tlf-uid');
  });

  it("admits a group member when the foundation's group opted in, looking the slug up as given", async () => {
    await expect(service.getAccess(req, 'TLF')).resolves.toEqual({ canView: true, reason: 'group-member' });
    expect(getProjectIdBySlug).toHaveBeenCalledWith(req, 'TLF');
  });

  it('denies a group member when the group has not opted in (the default)', async () => {
    canGroupMemberViewSocialListening.mockResolvedValue(false);

    await expect(service.getAccess(req, 'tlf')).resolves.toEqual({ canView: false, reason: 'none' });
  });

  it('denies a non-ED caller when no foundation is named — group access is always foundation-scoped', async () => {
    await expect(service.getAccess(req, '')).resolves.toEqual({ canView: false, reason: 'none' });
    expect(getProjectIdBySlug).not.toHaveBeenCalled();
  });

  it('denies a malformed slug without looking it up', async () => {
    await expect(service.getAccess(req, 'tlf;drop')).resolves.toEqual({ canView: false, reason: 'none' });
    expect(getProjectIdBySlug).not.toHaveBeenCalled();
  });

  it("denies a child project's slug even when its group opted in — only a foundation's own groups grant access", async () => {
    getProjectIdBySlug.mockResolvedValue({ uid: 'child-uid', slug: 'child', exists: true });
    getProjectById.mockResolvedValue({ uid: 'child-uid', slug: 'child', parent_uid: 'tlf-uid' });
    computeIsFoundation.mockReturnValue(false);

    await expect(service.getAccess(req, 'child')).resolves.toEqual({ canView: false, reason: 'none' });
    expect(getProjectById).toHaveBeenCalledWith(req, 'child-uid', false);
    expect(canGroupMemberViewSocialListening).not.toHaveBeenCalled();
  });

  it('denies an unknown foundation', async () => {
    getProjectIdBySlug.mockResolvedValue({ uid: '', slug: 'nope', exists: false });

    await expect(service.getAccess(req, 'nope')).resolves.toEqual({ canView: false, reason: 'none' });
    expect(canGroupMemberViewSocialListening).not.toHaveBeenCalled();
  });

  it('remembers the group answer per user and foundation, and coalesces concurrent lookups', async () => {
    await Promise.all([service.getAccess(req, 'tlf'), service.getAccess(req, 'tlf'), service.getAccess(req, 'tlf')]);
    await service.getAccess(req, 'tlf');

    expect(canGroupMemberViewSocialListening).toHaveBeenCalledTimes(1);

    getUsernameFromAuth.mockResolvedValue('another-user');
    await service.getAccess(req, 'tlf');
    expect(canGroupMemberViewSocialListening).toHaveBeenCalledTimes(2);
  });

  it('does not remember a slug that failed to resolve (the NATS lookup reports failures as not found)', async () => {
    getProjectIdBySlug.mockResolvedValueOnce({ uid: '', slug: 'tlf', exists: false });

    await expect(service.getAccess(req, 'tlf')).resolves.toEqual({ canView: false, reason: 'none' });
    await expect(service.getAccess(req, 'tlf')).resolves.toEqual({ canView: true, reason: 'group-member' });
  });

  describe('cache expiry', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('asks again once the cached group answer is older than the TTL, so a removed member loses access', async () => {
      vi.useFakeTimers();
      await expect(service.getAccess(req, 'tlf')).resolves.toEqual({ canView: true, reason: 'group-member' });

      canGroupMemberViewSocialListening.mockResolvedValue(false);
      vi.advanceTimersByTime(SOCIAL_LISTENING_GROUP_ACCESS_CACHE_TTL_MS - 1);
      await expect(service.getAccess(req, 'tlf')).resolves.toEqual({ canView: true, reason: 'group-member' });
      expect(canGroupMemberViewSocialListening).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1);
      await expect(service.getAccess(req, 'tlf')).resolves.toEqual({ canView: false, reason: 'none' });
      expect(canGroupMemberViewSocialListening).toHaveBeenCalledTimes(2);
    });
  });

  it('keys the remembered answer by foundation as well as user', async () => {
    await expect(service.getAccess(req, 'tlf')).resolves.toEqual({ canView: true, reason: 'group-member' });

    getProjectIdBySlug.mockResolvedValue({ uid: 'cncf-uid', slug: 'cncf', exists: true });
    canGroupMemberViewSocialListening.mockResolvedValue(false);

    await expect(service.getAccess(req, 'cncf')).resolves.toEqual({ canView: false, reason: 'none' });
    expect(canGroupMemberViewSocialListening).toHaveBeenCalledTimes(2);
    expect(canGroupMemberViewSocialListening).toHaveBeenLastCalledWith(req, 'cncf-uid');
  });

  it('fails closed on an upstream error and does not remember the failure', async () => {
    canGroupMemberViewSocialListening.mockRejectedValueOnce(new Error('query service down'));

    await expect(service.getAccess(req, 'tlf')).resolves.toEqual({ canView: false, reason: 'none' });
    await expect(service.getAccess(req, 'tlf')).resolves.toEqual({ canView: true, reason: 'group-member' });
  });
});
