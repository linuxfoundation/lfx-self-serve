// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MENTORSHIP_PROGRAM_STATUSES, MOCK_MENTORSHIP_PROGRAMS } from '@lfx-one/shared/constants';
import { MentorshipProgram, MentorshipProgramsResponse, MentorshipProgramStatus } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { logger } from './logger.service';

/**
 * MentorshipService — BFF layer for the mentorship admin surface.
 *
 * Currently reads from a static mock array baked into `@lfx-one/shared/constants`
 * (`MOCK_MENTORSHIP_PROGRAMS`) — this stands in until the upstream
 * mentorship-service endpoint is wired up. Signature is deliberately shaped like
 * `CrowdfundingService` so swapping the mock lookup for a real `fetch(baseUrl + …)`
 * call is a mechanical change and no controller / route logic has to move.
 */
export class MentorshipService {
  public async getPrograms(req: Request, options: { search?: string; status?: MentorshipProgramStatus } = {}): Promise<MentorshipProgramsResponse> {
    const startTime = logger.startOperation(req, 'mentorship_get_programs', options);

    // Filter first, then paginate — matches how a real backend would return
    // total = matches count after WHERE clauses (not the unfiltered size).
    let filtered: MentorshipProgram[] = MOCK_MENTORSHIP_PROGRAMS;
    if (options.status) {
      filtered = filtered.filter((p) => p.status === options.status);
    }
    if (options.search) {
      const needle = options.search.trim().toLowerCase();
      if (needle) {
        filtered = filtered.filter((p) => p.name.toLowerCase().includes(needle) || p.projectName.toLowerCase().includes(needle));
      }
    }

    logger.success(req, 'mentorship_get_programs', startTime, { count: filtered.length, total: filtered.length });

    return { data: filtered, total: filtered.length };
  }
}

/** Runtime guard so the controller can reject unknown status filters with a 400 before hitting the service. */
export function isMentorshipProgramStatus(value: unknown): value is MentorshipProgramStatus {
  return typeof value === 'string' && (MENTORSHIP_PROGRAM_STATUSES as readonly string[]).includes(value);
}
