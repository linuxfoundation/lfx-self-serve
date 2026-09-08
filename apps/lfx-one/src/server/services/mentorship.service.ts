// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  EMPTY_MENTORSHIP_PROGRAM_LISTS,
  MENTORSHIP_LF_PROJECT_PAGE_SIZE,
  MENTORSHIP_PROGRAM_STATUSES,
  MENTORSHIP_PROJECT_OPTIONS,
  MOCK_MENTORSHIP_LF_PROJECTS,
  MOCK_MENTORSHIP_PROGRAM_LISTS,
  MOCK_MENTORSHIP_PROGRAMS,
} from '@lfx-one/shared/constants';
import {
  MentorshipCiiBadge,
  MentorshipEnrollForm,
  MentorshipLfProjectsResponse,
  MentorshipLogoUploadResponse,
  MentorshipNameAvailability,
  MentorshipProgram,
  MentorshipProgramDetail,
  MentorshipProgramsResponse,
  MentorshipProgramStatus,
} from '@lfx-one/shared/interfaces';
import { buildMentorshipProgramDetail, isMentorshipCiiProjectId, mentorshipProgramSlug } from '@lfx-one/shared/utils';
import { Request } from 'express';
import { createHash } from 'node:crypto';

import { ConflictError, MicroserviceError, ResourceNotFoundError, ServiceValidationError } from '../errors';

import { logger } from './logger.service';
import { ObjectStoreService } from './object-store.service';

const DEFAULT_PROGRAM_LIMIT = 50;
const MAX_LIMIT = 50;
const CII_BADGE_TIMEOUT_MS = 10_000;
/** Key namespace inside the shared CDN-fronted public-image bucket. */
const MENTORSHIP_LOGO_KEY_PREFIX = 'mentorship-logos';

/**
 * In-memory store so POST enrollments show up on the admin list in this
 * process. Replaced when the upstream mentorship-service is wired up.
 */
const programsStore: MentorshipProgram[] = MOCK_MENTORSHIP_PROGRAMS.map((program) => ({ ...program }));

function paginateOffsetLimit<T>(items: readonly T[], offset: number, limit: number): { data: T[]; total: number } {
  const start = Math.max(0, offset);
  const size = Math.min(MAX_LIMIT, Math.max(1, limit));
  return { data: items.slice(start, start + size), total: items.length };
}

/**
 * Allowlisted CII badge URL. `Number()` is the sanitizer CodeQL models for path IDs
 * (`js/request-forgery`); keep the host as a string literal concatenated with that number.
 * Must stay aligned with `MENTORSHIP_CII_HOST` / `MENTORSHIP_CII_BADGE_JSON_BASE`.
 */
function buildCiiBadgeJsonUrl(projectId: string): string {
  const numericId = Number(projectId.trim());
  if (!Number.isInteger(numericId) || numericId < 1) {
    throw ServiceValidationError.forField('projectId', 'CII Project ID must be numeric', { operation: 'mentorship_get_cii_badge' });
  }
  return 'https://www.bestpractices.dev/projects/' + numericId + '/badge.json';
}

export class MentorshipService {
  private readonly objectStore = new ObjectStoreService();

  public async getPrograms(
    req: Request,
    options: { search?: string; status?: MentorshipProgramStatus; offset?: number; limit?: number } = {}
  ): Promise<MentorshipProgramsResponse> {
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

    const page = paginateOffsetLimit(filtered, options.offset ?? 0, options.limit ?? DEFAULT_PROGRAM_LIMIT);
    logger.success(req, 'mentorship_get_programs', startTime, { count: page.data.length, total: page.total });

    return page;
  }

  public async getProgram(req: Request, programId: string): Promise<MentorshipProgramDetail> {
    const startTime = logger.startOperation(req, 'mentorship_get_program', { programId });
    const program = this.findProgram(programId);
    if (!program) {
      throw new ResourceNotFoundError('Mentorship program', programId, { operation: 'mentorship_get_program' });
    }

    const lists = MOCK_MENTORSHIP_PROGRAM_LISTS[program.slug] ?? EMPTY_MENTORSHIP_PROGRAM_LISTS;
    const detail = buildMentorshipProgramDetail(program, lists);
    logger.success(req, 'mentorship_get_program', startTime, { programId, slug: program.slug, tabCounts: detail.tabCounts });
    return detail;
  }

  public async enrollProgram(req: Request, input: MentorshipEnrollForm): Promise<MentorshipProgram> {
    const startTime = logger.startOperation(req, 'mentorship_enroll_program', { name: input.name });

    const name = input.name.trim();
    const slug = mentorshipProgramSlug(name);
    const taken = programsStore.some((program) => program.name.trim().toLowerCase() === name.toLowerCase() || program.slug === slug);
    if (taken) {
      throw new ConflictError('A mentorship program with this name already exists.', 'CONFLICT', { operation: 'mentorship_enroll_program' });
    }

    const now = new Date().toISOString();
    const projectLabel = MENTORSHIP_PROJECT_OPTIONS.find((option) => option.value === input.projectId)?.label ?? input.projectId;
    const firstTerm = input.terms[0];

    const program: MentorshipProgram = {
      id: `mp_${Date.now()}`,
      slug,
      name,
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

  /**
   * Second phase of enrollment: the wizard creates the program, then PUTs the logo bytes here.
   * Split because the object key is namespaced under the program, which does not exist until the
   * create call returns.
   *
   * Content-addressed key, so re-uploading identical bytes is a no-op overwrite and the URL is
   * safe to cache immutably. Shares the CDN-fronted avatars bucket under its own `mentorship-logos/`
   * prefix — see `ObjectStoreService.putPublicImage`.
   */
  public async uploadProgramLogo(req: Request, programId: string, buffer: Buffer, contentType: string): Promise<MentorshipLogoUploadResponse> {
    logger.debug(req, 'mentorship_upload_program_logo', 'Uploading program logo', { programId, content_type: contentType, size: buffer.length });

    const program = this.findProgram(programId);
    if (!program) {
      throw new ResourceNotFoundError('Mentorship program', programId, { operation: 'mentorship_upload_program_logo' });
    }

    const digest = createHash('sha256').update(buffer).digest('hex');
    const key = `${MENTORSHIP_LOGO_KEY_PREFIX}/${digest}.${contentType === 'image/png' ? 'png' : 'jpg'}`;
    const { url } = await this.objectStore.putPublicImage(req, key, buffer, contentType);

    // No absolute URL means there is nothing to persist onto the program, so the logo would
    // silently stay unset — surface it as the configuration error it is.
    if (!url) {
      throw new MicroserviceError('CDN_URL_PREFIX is not configured; cannot generate a public program logo URL', 500, 'CDN_NOT_CONFIGURED', {
        operation: 'mentorship_upload_program_logo',
        service: 'object-store',
        path: key,
      });
    }

    program.logoUrl = url;
    program.updatedOn = new Date().toISOString();

    logger.debug(req, 'mentorship_upload_program_logo', 'Program logo uploaded', { programId: program.id, key });
    return { logoUrl: url };
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
    const page = paginateOffsetLimit(filtered, options.offset ?? 0, options.limit ?? MENTORSHIP_LF_PROJECT_PAGE_SIZE);
    logger.success(req, 'mentorship_get_lf_projects', startTime, { count: page.data.length, total: page.total });
    return page;
  }

  public async getCiiBadge(req: Request, projectId: string): Promise<MentorshipCiiBadge> {
    const startTime = logger.startOperation(req, 'mentorship_get_cii_badge', { projectId });

    if (!isMentorshipCiiProjectId(projectId)) {
      throw ServiceValidationError.forField('projectId', 'CII Project ID must be numeric', { operation: 'mentorship_get_cii_badge' });
    }

    const url = buildCiiBadgeJsonUrl(projectId);
    let response: Response;
    try {
      response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(CII_BADGE_TIMEOUT_MS) });
    } catch (error) {
      throw new MicroserviceError('CII Best Practices is temporarily unavailable. Please try again later.', 502, 'UPSTREAM_UNREACHABLE', {
        operation: 'mentorship_get_cii_badge',
        service: 'cii_best_practices',
        path: url,
        originalError: error instanceof Error ? error : undefined,
        transportFailure: true,
      });
    }

    if (response.status === 404) {
      throw new ResourceNotFoundError('CII project', projectId, { operation: 'mentorship_get_cii_badge' });
    }
    if (!response.ok) {
      throw MicroserviceError.fromMicroserviceResponse(response.status, response.statusText, {}, 'cii_best_practices', url, 'mentorship_get_cii_badge');
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new MicroserviceError('CII Best Practices returned an invalid response.', 502, 'BAD_GATEWAY', {
        operation: 'mentorship_get_cii_badge',
        service: 'cii_best_practices',
        path: url,
        originalError: error instanceof Error ? error : undefined,
      });
    }

    const badgeLevel = payload && typeof payload === 'object' ? (payload as { badge_level?: unknown }).badge_level : undefined;
    if (typeof badgeLevel !== 'string' || !badgeLevel) {
      throw new MicroserviceError('CII Best Practices returned an invalid response.', 502, 'BAD_GATEWAY', {
        operation: 'mentorship_get_cii_badge',
        service: 'cii_best_practices',
        path: url,
      });
    }

    const badge: MentorshipCiiBadge = { projectId, badgeLevel };
    logger.success(req, 'mentorship_get_cii_badge', startTime, { projectId, badgeLevel: badge.badgeLevel });
    return badge;
  }

  /** Programs resolve by id (default) or slug, matching `/mentorship/admin/:programId`. */
  private findProgram(programId: string): MentorshipProgram | undefined {
    return programsStore.find((item) => item.id === programId) ?? programsStore.find((item) => item.slug === programId);
  }
}

export function isMentorshipProgramStatus(value: unknown): value is MentorshipProgramStatus {
  return typeof value === 'string' && (MENTORSHIP_PROGRAM_STATUSES as readonly string[]).includes(value);
}
