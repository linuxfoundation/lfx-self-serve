// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const { MentorshipAdminService } = await import('./mentorship-admin.service');

function buildReq(): Request {
  return { path: '/api/mentorship/admin/programs' } as Request;
}

describe('MentorshipAdminService — read-only contract', () => {
  let service: InstanceType<typeof MentorshipAdminService>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T12:00:00.000Z'));
    service = new MentorshipAdminService();
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

  it('resolves a program detail by id and throws for an unknown program', async () => {
    const { data } = await service.getPrograms(buildReq());
    const detail = await service.getProgram(buildReq(), data[0].id);

    expect(detail.program.id).toBe(data[0].id);
    await expect(service.getProgram(buildReq(), 'no-such-program')).rejects.toMatchObject({ statusCode: 404 });
  });
});
