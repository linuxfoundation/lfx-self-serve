// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { MentorshipEnrollForm } from '@lfx-one/shared/interfaces';
import { getMentorshipEnrollStepErrors } from '@lfx-one/shared/utils';

import { AuthenticationError, ServiceValidationError } from '../errors';
import { isMentorshipProgramStatus, MentorshipService } from '../services/mentorship.service';
import { logger } from '../services/logger.service';
import { getUsernameFromAuth } from '../utils/auth-helper';

const parseTrimmedString = (val: unknown): string | undefined => {
  if (typeof val !== 'string') return undefined;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function parseEnrollBody(body: unknown): MentorshipEnrollForm {
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const termsRaw = Array.isArray(raw['terms']) ? raw['terms'] : [];
  const prereqRaw = Array.isArray(raw['prerequisites']) ? raw['prerequisites'] : [];

  return {
    importProgramId: asString(raw['importProgramId']),
    name: asString(raw['name']),
    projectId: asString(raw['projectId']),
    technologies: asStringArray(raw['technologies']),
    description: asString(raw['description']),
    repositoryUrl: asString(raw['repositoryUrl']),
    websiteUrl: asString(raw['websiteUrl']),
    ciiProjectId: asString(raw['ciiProjectId']),
    codeOfConductUrl: asString(raw['codeOfConductUrl']),
    logoFileName: asString(raw['logoFileName']),
    logoPreviewUrl: '',
    skills: asStringArray(raw['skills']),
    terms: termsRaw
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map((item) => ({
        id: asString(item['id']),
        name: asString(item['name']),
        startDate: asString(item['startDate']),
        endDate: asString(item['endDate']),
        applicationStartDate: asString(item['applicationStartDate']),
        applicationEndDate: asString(item['applicationEndDate']),
      })),
    prerequisites: prereqRaw
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map((item) => ({
        id: asString(item['id']),
        name: asString(item['name']),
        description: asString(item['description']),
        required: item['required'] === true,
        requireFile: item['requireFile'] === true,
        challengeUrl: asString(item['challengeUrl']),
        custom: item['custom'] === true,
        dueDate: asString(item['dueDate']),
      })),
    termsAccepted: raw['termsAccepted'] === true,
  };
}

export class MentorshipController {
  private readonly mentorshipService = new MentorshipService();

  // GET /api/mentorship/programs
  public async getPrograms(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_mentorship_programs');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_mentorship_programs' });
      }

      const { search, status } = req.query;

      const rawStatus = parseTrimmedString(status);
      if (rawStatus !== undefined && !isMentorshipProgramStatus(rawStatus)) {
        throw ServiceValidationError.forField('status', `status must be one of: open, pending-review, completed`, {
          operation: 'get_mentorship_programs',
        });
      }

      const programs = await this.mentorshipService.getPrograms(req, {
        search: parseTrimmedString(search),
        status: rawStatus,
      });

      logger.success(req, 'get_mentorship_programs', startTime, { result_count: programs.data.length });

      res.json(programs);
    } catch (error) {
      next(error);
    }
  }

  // POST /api/mentorship/programs
  public async enrollProgram(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'enroll_mentorship_program');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'enroll_mentorship_program' });
      }

      const form = parseEnrollBody(req.body);

      // Run every wizard step so a client that skipped validation cannot persist a partial enrollment.
      const errors = {
        ...getMentorshipEnrollStepErrors('details', form),
        ...getMentorshipEnrollStepErrors('setup', form),
        ...getMentorshipEnrollStepErrors('prerequisites', form),
      };
      const firstError = Object.values(errors)[0];
      if (firstError) {
        throw ServiceValidationError.forField(Object.keys(errors)[0] ?? 'form', firstError, {
          operation: 'enroll_mentorship_program',
        });
      }

      const program = await this.mentorshipService.enrollProgram(req, form);

      logger.success(req, 'enroll_mentorship_program', startTime, { id: program.id });

      res.status(201).json(program);
    } catch (error) {
      next(error);
    }
  }
}
