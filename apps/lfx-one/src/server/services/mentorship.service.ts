// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MENTORSHIP_LF_PROJECT_PAGE_SIZE,
  MENTORSHIP_PROGRAM_STATUSES,
  MENTORSHIP_PROJECT_OPTIONS,
  MOCK_MENTORSHIP_LF_PROJECTS,
  MOCK_MENTORSHIP_PROGRAMS,
  mentorshipCiiBadgeJsonUrl,
} from '@lfx-one/shared/constants';
import {
  MentorshipCiiBadge,
  MentorshipEnrollForm,
  MentorshipLfProjectsResponse,
  MentorshipNameAvailability,
  MentorshipProgram,
  MentorshipProgramsResponse,
  MentorshipProgramStatus,
} from '@lfx-one/shared/interfaces';
import { isMentorshipCiiProjectId, mentorshipProgramSlug } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { ResourceNotFoundError, ServiceValidationError } from '../errors';

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

  public async isProgramNameAvailable(req: Request, name: string): Promise<MentorshipNameAvailability> {
    const startTime = logger.startOperation(req, 'mentorship_name_available', { name });
    const needle = name.trim().toLowerCase();
    const taken = programsStore.some((program) => program.name.trim().toLowerCase() === needle);
    logger.success(req, 'mentorship_name_available', startTime, { available: !taken });
    return { available: !taken };
  }

  public async getLfProjects(req: Request, options: { search?: string; offset?: number; limit?: number } = {}): Promise<MentorshipLfProjectsResponse> {
    const startTime = logger.startOperation(req, 'mentorship_get_lf_projects', options);
    const needle = options.search?.trim().toLowerCase() ?? '';
    const filtered = needle ? MOCK_MENTORSHIP_LF_PROJECTS.filter((project) => project.name.toLowerCase().includes(needle)) : [...MOCK_MENTORSHIP_LF_PROJECTS];
    const offset = Math.max(0, options.offset ?? 0);
    const limit = Math.min(50, Math.max(1, options.limit ?? MENTORSHIP_LF_PROJECT_PAGE_SIZE));
    const data = filtered.slice(offset, offset + limit);
    logger.success(req, 'mentorship_get_lf_projects', startTime, { count: data.length, total: filtered.length });
    return { data, total: filtered.length };
  }

  public async getCiiBadge(req: Request, projectId: string): Promise<MentorshipCiiBadge> {
    const startTime = logger.startOperation(req, 'mentorship_get_cii_badge', { projectId });

    if (!isMentorshipCiiProjectId(projectId)) {
      throw ServiceValidationError.forField('projectId', 'CII Project ID must be numeric', { operation: 'mentorship_get_cii_badge' });
    }

    const response = await fetch(mentorshipCiiBadgeJsonUrl(projectId));
    if (!response.ok) {
      throw new ResourceNotFoundError('CII project', projectId, { operation: 'mentorship_get_cii_badge' });
    }

    const payload = (await response.json()) as { badge_level?: unknown };
    if (typeof payload.badge_level !== 'string' || !payload.badge_level) {
      throw new ResourceNotFoundError('CII project', projectId, { operation: 'mentorship_get_cii_badge' });
    }

    const badge: MentorshipCiiBadge = { projectId, badgeLevel: payload.badge_level };
    logger.success(req, 'mentorship_get_cii_badge', startTime, { projectId, badgeLevel: badge.badgeLevel });
    return badge;
  }
}

export function isMentorshipProgramStatus(value: unknown): value is MentorshipProgramStatus {
  return typeof value === 'string' && (MENTORSHIP_PROGRAM_STATUSES as readonly string[]).includes(value);
}
