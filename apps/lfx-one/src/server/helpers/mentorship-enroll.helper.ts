// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MENTORSHIP_MAX_OPEN_TERMS } from '@lfx-one/shared/constants';
import {
  MentorshipEnrollCreatePrerequisite,
  MentorshipEnrollCreateRequest,
  MentorshipEnrollCreateTerm,
  MentorshipEnrollProgramRef,
  MentorshipProgramLogoUploadResult,
  MentorshipUpstreamCreatedProgram,
  MentorshipUpstreamLogoUpload,
} from '@lfx-one/shared/interfaces';
import { isUuid } from '@lfx-one/shared/utils';

import { ServiceValidationError } from '../errors';
import { parseTrimmedString } from './mentorship-params.helper';

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** A required text field, trimmed. `path` names it in the 400 (`terms[0].name`) when it sits inside a list. */
const requireString = (raw: Record<string, unknown>, field: string, operation: string, path = field): string => {
  const value = parseTrimmedString(raw[field]);
  if (!value) {
    throw ServiceValidationError.forField(path, `${path} is required.`, { operation });
  }
  return value;
};

const parseTerm = (value: unknown, index: number, operation: string): MentorshipEnrollCreateTerm => {
  const raw = asRecord(value);
  const at = (field: string): string => requireString(raw, field, operation, `terms[${index}].${field}`);
  return {
    name: at('name'),
    startDate: at('startDate'),
    endDate: at('endDate'),
    applicationStartDate: at('applicationStartDate'),
    applicationEndDate: at('applicationEndDate'),
  };
};

/** An optional flag: `false` when left out, a 400 when sent as anything but a boolean (`"true"` is not `true`). */
const optionalBoolean = (raw: Record<string, unknown>, field: string, operation: string, path: string): boolean => {
  const value = raw[field];
  if (value === undefined) {
    return false;
  }
  if (typeof value !== 'boolean') {
    throw ServiceValidationError.forField(path, `${path} must be true or false.`, { operation });
  }
  return value;
};

/** An optional text field: `null` when left out or sent as `null`, a 400 when sent as anything but text (`5` is not `"5"`). */
const optionalText = (raw: Record<string, unknown>, field: string, operation: string, path: string): string | null => {
  const value = raw[field];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw ServiceValidationError.forField(path, `${path} must be text.`, { operation });
  }
  return value;
};

const parsePrerequisite = (value: unknown, index: number, operation: string): MentorshipEnrollCreatePrerequisite => {
  const raw = asRecord(value);
  const path = `prerequisites[${index}]`;
  return {
    name: requireString(raw, 'name', operation, `${path}.name`),
    description: optionalText(raw, 'description', operation, `${path}.description`) ?? '',
    required: optionalBoolean(raw, 'required', operation, `${path}.required`),
    requireFile: optionalBoolean(raw, 'requireFile', operation, `${path}.requireFile`),
    dueDate: parseTrimmedString(optionalText(raw, 'dueDate', operation, `${path}.dueDate`)) ?? null,
  };
};

/**
 * Validates the body of `POST /api/mentorship/admin/programs` and rebuilds it from the known fields only, so a stray `logo_url`,
 * `status` or term `id` never reaches upstream. It checks the shape the upstream create needs (a project, the text fields, at
 * least one skill, 1 to `MENTORSHIP_MAX_OPEN_TERMS` terms, accepted terms), trims every text field but a prerequisite
 * description, and leaves lengths, URLs and dates to the wizard and upstream, which both check them. A field inside a list is
 * named by its index (`terms[1].startDate`). The optional text fields, `industry` among them, are kept only when not blank.
 * Nothing in the body is logged.
 */
export const parseMentorshipEnrollCreateRequest = (body: unknown, operation: string): MentorshipEnrollCreateRequest => {
  const raw = asRecord(body);

  const projectId = parseTrimmedString(raw['projectId']) ?? '';
  if (!isUuid(projectId)) {
    throw ServiceValidationError.forField('projectId', 'projectId must be a UUID.', { operation });
  }

  const projectSlug = requireString(raw, 'projectSlug', operation);
  const projectName = requireString(raw, 'projectName', operation);
  const name = requireString(raw, 'name', operation);
  const description = requireString(raw, 'description', operation);
  const repositoryUrl = requireString(raw, 'repositoryUrl', operation);

  const rawSkills = raw['skills'];
  if (!Array.isArray(rawSkills) || rawSkills.length === 0 || !rawSkills.every((skill) => parseTrimmedString(skill))) {
    throw ServiceValidationError.forField('skills', 'skills must be a list of at least one skill.', { operation });
  }

  const rawTerms = raw['terms'];
  if (!Array.isArray(rawTerms) || rawTerms.length === 0 || rawTerms.length > MENTORSHIP_MAX_OPEN_TERMS) {
    throw ServiceValidationError.forField('terms', `terms must hold 1 to ${MENTORSHIP_MAX_OPEN_TERMS} terms.`, { operation });
  }

  if (!Array.isArray(raw['prerequisites'])) {
    throw ServiceValidationError.forField('prerequisites', 'prerequisites must be a list.', { operation });
  }

  if (raw['termsAccepted'] !== true) {
    throw ServiceValidationError.forField('termsAccepted', 'The terms must be accepted.', { operation });
  }

  const request: MentorshipEnrollCreateRequest = {
    projectId,
    projectSlug,
    projectName,
    name,
    description,
    repositoryUrl,
    skills: rawSkills.map((skill) => (skill as string).trim()),
    terms: rawTerms.map((term, index) => parseTerm(term, index, operation)),
    prerequisites: (raw['prerequisites'] as unknown[]).map((item, index) => parsePrerequisite(item, index, operation)),
    termsAccepted: true,
  };

  const projectLogoUrl = parseTrimmedString(raw['projectLogoUrl']);
  const websiteUrl = parseTrimmedString(raw['websiteUrl']);
  const codeOfConductUrl = parseTrimmedString(raw['codeOfConductUrl']);
  const ciiProjectId = parseTrimmedString(raw['ciiProjectId']);
  const industry = parseTrimmedString(raw['industry']);
  if (projectLogoUrl) request.projectLogoUrl = projectLogoUrl;
  if (websiteUrl) request.websiteUrl = websiteUrl;
  if (codeOfConductUrl) request.codeOfConductUrl = codeOfConductUrl;
  if (ciiProjectId) request.ciiProjectId = ciiProjectId;
  if (industry) request.industry = industry;

  return request;
};

/** The id, slug and status the wizard keeps from an upstream create. A program with no slug falls back to its id. */
export const toMentorshipEnrollProgramRef = (program: MentorshipUpstreamCreatedProgram): MentorshipEnrollProgramRef => ({
  id: program.id,
  slug: program.slug || program.id,
  status: program.status,
});

/** The public URL upstream stored the logo at. */
export const toMentorshipProgramLogoUploadResult = (upload: MentorshipUpstreamLogoUpload): MentorshipProgramLogoUploadResult => ({
  logoUrl: upload.public_url,
});
