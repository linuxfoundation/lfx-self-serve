// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MENTORSHIP_PROGRAM_STATUSES, MENTORSHIP_PROJECT_OPTIONS, MOCK_MENTORSHIP_PROGRAMS } from '@lfx-one/shared/constants';
import { MentorshipEnrollForm, MentorshipProgram, MentorshipProgramsResponse, MentorshipProgramStatus } from '@lfx-one/shared/interfaces';
import { mentorshipProgramSlug } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { logger } from './logger.service';

/**
 * In-memory store so POST enrollments show up on the admin list in this
 * process. Replaced when the upstream mentorship-service is wired up.
 */
const programsStore: MentorshipProgram[] = MOCK_MENTORSHIP_PROGRAMS.map((program) => ({ ...program }));

export class MentorshipService {
  public async getPrograms(req: Request, options: { search?: string; status?: MentorshipProgramStatus } = {}): Promise<MentorshipProgramsResponse> {
    const startTime = logger.startOperation(req, 'mentorship_get_programs', options);

    let filtered: MentorshipProgram[] = programsStore;
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

  public async enrollProgram(req: Request, input: MentorshipEnrollForm): Promise<MentorshipProgram> {
    const startTime = logger.startOperation(req, 'mentorship_enroll_program', { name: input.name });

    const now = new Date().toISOString();
    const projectLabel = MENTORSHIP_PROJECT_OPTIONS.find((option) => option.value === input.projectId)?.label ?? input.projectId;
    const firstTerm = input.terms[0];

    const program: MentorshipProgram = {
      id: `mp_${Date.now()}`,
      slug: mentorshipProgramSlug(input.name),
      name: input.name.trim(),
      projectName: projectLabel,
      term: firstTerm?.name ?? 'TBD',
      status: 'pending-review',
      stats: { mentors: 0, mentees: 0, graduated: 0 },
      createdOn: now,
      updatedOn: now,
    };

    programsStore.unshift(program);

    logger.success(req, 'mentorship_enroll_program', startTime, { id: program.id, slug: program.slug });
    return program;
  }
}

export function isMentorshipProgramStatus(value: unknown): value is MentorshipProgramStatus {
  return typeof value === 'string' && (MENTORSHIP_PROGRAM_STATUSES as readonly string[]).includes(value);
}
