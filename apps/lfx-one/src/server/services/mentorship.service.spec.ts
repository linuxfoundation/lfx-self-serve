// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi, afterEach, type MockInstance } from 'vitest';

// The service resolves its request-scoped logger through this module; stubbing it here
// avoids booting the real pino instance for a synchronous, in-memory lookup path.
vi.mock('./logger.service', () => ({
  logger: {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

const { MentorshipService } = await import('./mentorship.service');
const { MicroserviceProxyService } = await import('./microservice-proxy.service');

function buildReq(): Request {
  return { path: '/api/mentorship/programs' } as Request;
}

describe('MentorshipService — read-only contract', () => {
  let service: InstanceType<typeof MentorshipService>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T12:00:00.000Z'));
    service = new MentorshipService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a stable program list across consecutive reads', async () => {
    const first = await service.getPrograms(buildReq());
    const second = await service.getPrograms(buildReq());

    expect(first.total).toBe(second.total);
    expect(first.total).toBeGreaterThan(0);
    expect(first.data.map((p) => p.id)).toEqual(second.data.map((p) => p.id));
  });
});

describe('MentorshipService program review', () => {
  const programId = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
  const upstreamProgram = {
    id: programId,
    name: 'Test Program',
    slug: 'test-program',
    status: 'pending',
    is_paid: false,
    created_on: '2026-09-01T00:00:00Z',
    updated_on: '2026-09-01T00:00:00Z',
  };
  let service: InstanceType<typeof MentorshipService>;
  let proxyRequest: MockInstance<InstanceType<typeof MicroserviceProxyService>['proxyRequest']>;

  beforeEach(() => {
    proxyRequest = vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest');
    service = new MentorshipService();
  });

  afterEach(() => {
    proxyRequest.mockRestore();
  });

  it('reads the program from the mentorship service and returns only the review fields', async () => {
    proxyRequest.mockResolvedValue(upstreamProgram);

    const review = await service.getProgramReview(buildReq(), programId);

    expect(proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', `/mentorship/v1/programs/${programId}`, 'GET');
    expect(review).toEqual({ id: programId, name: 'Test Program', status: 'pending' });
  });

  it.each([
    ['approve', 'published'],
    ['reject', 'rejected'],
  ] as const)('maps the %s decision to the upstream %s status', async (decision, status) => {
    proxyRequest.mockResolvedValue({ ...upstreamProgram, status });

    const review = await service.submitProgramDecision(buildReq(), programId, decision);

    expect(proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', `/mentorship/v1/programs/${programId}/decision`, 'POST', undefined, {
      status,
    });
    expect(review).toEqual({ id: programId, name: 'Test Program', status });
  });

  it('lets an upstream error through so its status reaches the page', async () => {
    const forbidden = Object.assign(new Error('forbidden'), { statusCode: 403 });
    proxyRequest.mockRejectedValue(forbidden);

    await expect(service.submitProgramDecision(buildReq(), programId, 'approve')).rejects.toBe(forbidden);
  });
});
