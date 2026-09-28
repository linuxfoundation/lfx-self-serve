// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const { MentorshipMenteeService } = await import('./mentorship-mentee.service');
const { ResourceNotFoundError } = await import('../errors');

function buildReq(): Request {
  return { path: '/api/mentorship/mentee/apply-target' } as Request;
}

describe('MentorshipMenteeService.getMenteeApplyTarget', () => {
  let service: InstanceType<typeof MentorshipMenteeService>;

  beforeEach(() => {
    service = new MentorshipMenteeService();
  });

  it('resolves the program name, project, and the requested term', async () => {
    const target = await service.getMenteeApplyTarget(buildReq(), 'mp_apicurio_winter26', 'trm_apicurio_winter26');

    expect(target).toEqual({
      programName: 'Apicurio Registry: Prompt Template Playground',
      projectName: 'CNCF',
      termName: 'Winter 2026',
    });
  });

  it('rejects an unknown term on a known program', async () => {
    await expect(service.getMenteeApplyTarget(buildReq(), 'mp_apicurio_winter26', 'missing-term')).rejects.toBeInstanceOf(ResourceNotFoundError);
  });
});
