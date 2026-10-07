// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MENTORSHIP_MAX_OPEN_TERMS } from '@lfx-one/shared/constants';
import {
  MentorshipEnrollCreatePrerequisite,
  MentorshipEnrollCreateRequest,
  MentorshipEnrollCreateTerm,
  MentorshipEnrollImport,
  MentorshipEnrollProgramRef,
  MentorshipEnrollUpdateRequest,
  MentorshipProgramLogoUploadResult,
  MentorshipUpstreamCreatedProgram,
  MentorshipUpstreamEnrollTemplate,
  MentorshipUpstreamLogoUpload,
  MentorshipUpstreamProgramUpdate,
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
 * Validates the program fields that the create and update bodies share and rebuilds them from the known fields only, so a stray
 * `logo_url`, `status` or term `id` never reaches upstream. It checks for a project, the required text fields and at least one
 * skill, trims every text field but a prerequisite description, and leaves lengths, URLs and dates to the wizard and upstream,
 * which both check them. A field inside a list is named by its index (`prerequisites[1].name`). The optional text fields,
 * `industry` among them, are kept only when not blank. Nothing in the body is logged.
 */
const parseProgramFields = (raw: Record<string, unknown>, operation: string): MentorshipEnrollUpdateRequest => {
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

  if (!Array.isArray(raw['prerequisites'])) {
    throw ServiceValidationError.forField('prerequisites', 'prerequisites must be a list.', { operation });
  }

  const request: MentorshipEnrollUpdateRequest = {
    projectId,
    projectSlug,
    projectName,
    name,
    description,
    repositoryUrl,
    skills: rawSkills.map((skill) => (skill as string).trim()),
    prerequisites: (raw['prerequisites'] as unknown[]).map((item, index) => parsePrerequisite(item, index, operation)),
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

/**
 * Validates the body of `POST /api/mentorship/admin/programs`: the shared program fields, 1 to `MENTORSHIP_MAX_OPEN_TERMS` terms,
 * and accepted terms. A field inside a list is named by its index (`terms[1].startDate`).
 */
export const parseMentorshipEnrollCreateRequest = (body: unknown, operation: string): MentorshipEnrollCreateRequest => {
  const raw = asRecord(body);
  const fields = parseProgramFields(raw, operation);

  const rawTerms = raw['terms'];
  if (!Array.isArray(rawTerms) || rawTerms.length === 0 || rawTerms.length > MENTORSHIP_MAX_OPEN_TERMS) {
    throw ServiceValidationError.forField('terms', `terms must hold 1 to ${MENTORSHIP_MAX_OPEN_TERMS} terms.`, { operation });
  }

  if (raw['termsAccepted'] !== true) {
    throw ServiceValidationError.forField('termsAccepted', 'The terms must be accepted.', { operation });
  }

  return {
    ...fields,
    terms: rawTerms.map((term, index) => parseTerm(term, index, operation)),
    termsAccepted: true,
  };
};

/**
 * Validates the body of `PATCH /api/mentorship/admin/programs/:programId`: the shared program fields only. Terms go through the
 * term routes and the logo through its own route, so a `terms` or `termsAccepted` sent here is dropped.
 */
export const parseMentorshipEnrollUpdateRequest = (body: unknown, operation: string): MentorshipEnrollUpdateRequest =>
  parseProgramFields(asRecord(body), operation);

/**
 * The update body as upstream `PATCH /programs/{id}` takes it: snake_case keys, a partial merge. Each optional text field is sent,
 * `''` when blank, so an admin can clear it. Prerequisites become `task_templates` the way upstream create converts them: only the
 * picked (`required`) ones are kept, and `submitFile` is `'required'` when the mentee must attach a file.
 */
export const toMentorshipUpstreamProgramUpdate = (request: MentorshipEnrollUpdateRequest): MentorshipUpstreamProgramUpdate => ({
  name: request.name,
  description: request.description,
  repo_link: request.repositoryUrl,
  website_url: request.websiteUrl ?? '',
  code_of_conduct: request.codeOfConductUrl ?? '',
  cii_project_id: request.ciiProjectId ?? '',
  industry: request.industry ?? '',
  skills: request.skills,
  task_templates: request.prerequisites
    .filter((item) => item.required)
    .map((item) => ({ name: item.name, description: item.description, submitFile: item.requireFile ? 'required' : null, dueDate: item.dueDate })),
  project_uid: request.projectId,
  project_slug: request.projectSlug,
  project_name: request.projectName,
  project_logo_url: request.projectLogoUrl ?? '',
});

/** The id, slug and status the wizard keeps from an upstream create or update. A program with no slug falls back to its id. */
export const toMentorshipEnrollProgramRef = (program: MentorshipUpstreamCreatedProgram): MentorshipEnrollProgramRef => ({
  id: program.id,
  slug: program.slug || program.id,
  status: program.status,
});

/** The public URL upstream stored the logo at. */
export const toMentorshipProgramLogoUploadResult = (upload: MentorshipUpstreamLogoUpload): MentorshipProgramLogoUploadResult => ({
  logoUrl: upload.public_url,
});

/** The Technologies kept in upstream's comma-separated `industry`: trimmed, blanks dropped, repeats dropped (case-insensitive) keeping the first spelling. */
const splitTechnologies = (industry: string | null | undefined): string[] => {
  const seen = new Set<string>();
  const technologies: string[] = [];
  for (const part of (industry ?? '').split(',')) {
    const technology = part.trim();
    const key = technology.toLowerCase();
    if (technology && !seen.has(key)) {
      seen.add(key);
      technologies.push(technology);
    }
  }
  return technologies;
};

/**
 * What the wizard copies from an upstream enroll template. `project` is `null` unless the template names a project uid, name and
 * slug, since create needs all three, and a missing text field is `''`. Every imported prerequisite is a selected, editable one
 * (`custom`) until the wizard matches it to a standard prerequisite; it asks for a file when upstream's `submitFile` is not blank, and a
 * `null` due date is left out. Terms are not part of the template. `logoUrl` is the program's logo, `''` when it has none.
 */
export const toMentorshipEnrollImport = (template: MentorshipUpstreamEnrollTemplate): MentorshipEnrollImport => {
  const { program } = template;
  const projectId = parseTrimmedString(program.project_uid);
  const projectName = parseTrimmedString(program.project_name);
  const projectSlug = parseTrimmedString(program.project_slug);
  const projectLogoUrl = parseTrimmedString(program.project_logo_url);

  return {
    name: program.name,
    project:
      projectId && projectName && projectSlug
        ? { id: projectId, name: projectName, slug: projectSlug, ...(projectLogoUrl ? { logoUrl: projectLogoUrl } : {}) }
        : null,
    description: program.description ?? '',
    repositoryUrl: program.repo_link ?? '',
    websiteUrl: program.website_url ?? '',
    codeOfConductUrl: program.code_of_conduct ?? '',
    ciiProjectId: program.cii_project_id ?? '',
    logoUrl: parseTrimmedString(program.logo_url) ?? '',
    technologies: splitTechnologies(program.industry),
    skills: [...(template.skills ?? [])],
    prerequisites: (template.prerequisites ?? []).map((item, index) => ({
      id: `imported-${index}`,
      name: item.name,
      description: item.description ?? '',
      required: true,
      requireFile: Boolean(item.submitFile),
      custom: true,
      ...(item.dueDate ? { dueDate: item.dueDate } : {}),
    })),
  };
};
