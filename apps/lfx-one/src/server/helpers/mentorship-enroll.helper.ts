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
import { isUuid } from '@lfx-one/shared/utils/string.utils';

import { ServiceValidationError } from '../errors';

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const requireString = (raw: Record<string, unknown>, field: string, operation: string): string => {
  const value = raw[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw ServiceValidationError.forField(field, `${field} is required.`, { operation });
  }
  return value;
};

/** An optional text field: kept when it is a non-empty string, left out otherwise. */
const optionalString = (raw: Record<string, unknown>, field: string): string | undefined => {
  const value = raw[field];
  return typeof value === 'string' && value.trim() ? value : undefined;
};

const parseTerm = (value: unknown, operation: string): MentorshipEnrollCreateTerm => {
  const raw = asRecord(value);
  return {
    name: requireString(raw, 'name', operation),
    startDate: requireString(raw, 'startDate', operation),
    endDate: requireString(raw, 'endDate', operation),
    applicationStartDate: requireString(raw, 'applicationStartDate', operation),
    applicationEndDate: requireString(raw, 'applicationEndDate', operation),
  };
};

const parsePrerequisite = (value: unknown, operation: string): MentorshipEnrollCreatePrerequisite => {
  const raw = asRecord(value);
  const dueDate = raw['dueDate'];
  return {
    name: requireString(raw, 'name', operation),
    description: typeof raw['description'] === 'string' ? raw['description'] : '',
    required: raw['required'] === true,
    requireFile: raw['requireFile'] === true,
    dueDate: typeof dueDate === 'string' && dueDate ? dueDate : null,
  };
};

/**
 * Validates the body of `POST /api/mentorship/admin/programs` and rebuilds it from the known fields only, so a stray `logo_url`,
 * `status` or term `id` never reaches upstream. It checks the shape the upstream create needs (a project, the text fields, at
 * least one skill, 1 to `MENTORSHIP_MAX_OPEN_TERMS` terms, accepted terms) and leaves lengths, URLs and dates to the wizard
 * and upstream, which both check them. Nothing in the body is logged.
 */
export const parseMentorshipEnrollCreateRequest = (body: unknown, operation: string): MentorshipEnrollCreateRequest => {
  const raw = asRecord(body);

  const projectId = typeof raw['projectId'] === 'string' ? raw['projectId'].trim() : '';
  if (!isUuid(projectId)) {
    throw ServiceValidationError.forField('projectId', 'projectId must be a UUID.', { operation });
  }

  const projectSlug = requireString(raw, 'projectSlug', operation);
  const projectName = requireString(raw, 'projectName', operation);
  const name = requireString(raw, 'name', operation);
  const description = requireString(raw, 'description', operation);
  const repositoryUrl = requireString(raw, 'repositoryUrl', operation);

  const rawSkills = raw['skills'];
  if (!Array.isArray(rawSkills) || rawSkills.length === 0 || !rawSkills.every((skill) => typeof skill === 'string' && skill.trim())) {
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
    skills: rawSkills as string[],
    terms: rawTerms.map((term) => parseTerm(term, operation)),
    prerequisites: (raw['prerequisites'] as unknown[]).map((item) => parsePrerequisite(item, operation)),
    termsAccepted: true,
  };

  const projectLogoUrl = optionalString(raw, 'projectLogoUrl');
  const websiteUrl = optionalString(raw, 'websiteUrl');
  const codeOfConductUrl = optionalString(raw, 'codeOfConductUrl');
  const ciiProjectId = optionalString(raw, 'ciiProjectId');
  if (projectLogoUrl) request.projectLogoUrl = projectLogoUrl;
  if (websiteUrl) request.websiteUrl = websiteUrl;
  if (codeOfConductUrl) request.codeOfConductUrl = codeOfConductUrl;
  if (ciiProjectId) request.ciiProjectId = ciiProjectId;

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
