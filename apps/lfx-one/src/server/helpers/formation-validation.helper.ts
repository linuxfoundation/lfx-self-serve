// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FORMATION_DESCRIPTION_MAX_LENGTH, FORMATION_MISSION_STATEMENT_MAX_LENGTH, FORMATION_REQUIRED_FIELDS } from '@lfx-one/shared/constants';
import type { FormationContact, FormationIntake } from '@lfx-one/shared/interfaces';
// Deep import, not the `@lfx-one/shared/utils` barrel: the barrel also re-exports form.utils.ts /
// vote.utils.ts / meeting.utils.ts, which pull in real (non-type-only) `@angular/forms` /
// `@angular/common/http` imports. That's harmless in the bundled Angular build, but loading it in
// this server-only vitest worker can hit `@angular/common`'s Location module before
// `@angular/compiler` is warmed up ("PlatformLocation needs to be compiled using the JIT
// compiler") — worker-scheduling-dependent, so avoid the barrel here entirely rather than rely on
// another spec having loaded the compiler first.
import { codePointLength } from '@lfx-one/shared/utils/string.utils';
import { Request } from 'express';

import { ServiceValidationError } from '../errors';

/** Server-side mirror of the client's inline validation — the field list is explicitly pending
 *  Scott's Google-Form confirmation (see #1962), so required-ness is read off the same
 *  `FORMATION_REQUIRED_FIELDS` set the Angular form builder uses, rather than duplicated here. */
function assertRequiredField(body: Record<string, unknown>, field: string, req: Request, operation: string): void {
  const value = body[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw ServiceValidationError.forField(field, `${field} is required`, { operation, service: 'formation.controller', path: req.path });
  }
}

function assertOptionalHttpsUrl(value: unknown, field: string, req: Request, operation: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw ServiceValidationError.forField(field, `${field} must be a string`, { operation, service: 'formation.controller', path: req.path });
  }
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:') {
      throw new Error('not https');
    }
  } catch {
    throw ServiceValidationError.forField(field, `${field} must be a valid https URL`, { operation, service: 'formation.controller', path: req.path });
  }
  return value.trim();
}

function parseContact(raw: unknown, field: string, req: Request, operation: string): FormationContact {
  const contact = raw as Partial<FormationContact> | undefined;
  if (!contact || typeof contact !== 'object') {
    throw ServiceValidationError.forField(field, `${field} is required`, { operation, service: 'formation.controller', path: req.path });
  }
  if (typeof contact.first_name !== 'string' || contact.first_name.trim() === '') {
    throw ServiceValidationError.forField(`${field}.first_name`, 'First name is required', { operation, service: 'formation.controller', path: req.path });
  }
  if (typeof contact.last_name !== 'string' || contact.last_name.trim() === '') {
    throw ServiceValidationError.forField(`${field}.last_name`, 'Last name is required', { operation, service: 'formation.controller', path: req.path });
  }
  if (typeof contact.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim())) {
    throw ServiceValidationError.forField(`${field}.email`, 'A valid email is required', { operation, service: 'formation.controller', path: req.path });
  }
  return { first_name: contact.first_name.trim(), last_name: contact.last_name.trim(), email: contact.email.trim() };
}

/**
 * Validates and normalizes the intake POST body. Throws {@link ServiceValidationError} on the
 * first violation — the controller's catch-free call site relies on this (see `formation-endpoint.md`'s
 * pattern: `next(error)` in the controller catch block, not here).
 */
export function parseFormationIntakeBody(req: Request, operation: string): FormationIntake {
  const body = (req.body ?? {}) as Record<string, unknown>;

  for (const field of FORMATION_REQUIRED_FIELDS) {
    assertRequiredField(body, field, req, operation);
  }

  const missionStatement = String(body['mission_statement'] ?? '');
  if (codePointLength(missionStatement) > FORMATION_MISSION_STATEMENT_MAX_LENGTH) {
    throw ServiceValidationError.forField('mission_statement', `mission_statement must be ${FORMATION_MISSION_STATEMENT_MAX_LENGTH} characters or fewer`, {
      operation,
      service: 'formation.controller',
      path: req.path,
    });
  }

  const description = String(body['description'] ?? '');
  if (codePointLength(description) > FORMATION_DESCRIPTION_MAX_LENGTH) {
    throw ServiceValidationError.forField('description', `description must be ${FORMATION_DESCRIPTION_MAX_LENGTH} characters or fewer`, {
      operation,
      service: 'formation.controller',
      path: req.path,
    });
  }

  const legalContact = parseContact(body['legal_contact'], 'legal_contact', req, operation);
  const rawAdditionalContacts = body['additional_contacts'];
  const additionalContacts = Array.isArray(rawAdditionalContacts)
    ? rawAdditionalContacts.map((contact, index) => parseContact(contact, `additional_contacts[${index}]`, req, operation))
    : [];

  return {
    parent_project_uid: typeof body['parent_project_uid'] === 'string' && body['parent_project_uid'] ? (body['parent_project_uid'] as string) : null,
    project_name: (body['project_name'] as string).trim(),
    project_repository_url: assertOptionalHttpsUrl(body['project_repository_url'], 'project_repository_url', req, operation),
    project_logo_filename:
      typeof body['project_logo_filename'] === 'string' && body['project_logo_filename'] ? (body['project_logo_filename'] as string) : null,
    trademark_status: (body['trademark_status'] as string).trim(),
    contributing_org_name: (body['contributing_org_name'] as string).trim(),
    contributing_org_id: typeof body['contributing_org_id'] === 'string' && body['contributing_org_id'] ? (body['contributing_org_id'] as string) : null,
    contributing_org_domain:
      typeof body['contributing_org_domain'] === 'string' && body['contributing_org_domain'] ? (body['contributing_org_domain'] as string) : null,
    legal_contact: legalContact,
    additional_contacts: additionalContacts,
    license: (body['license'] as string).trim(),
    chat_platform: (body['chat_platform'] as string).trim(),
    mission_statement: missionStatement.trim(),
    agreement_type: (body['agreement_type'] as string).trim(),
    is_spec_project: body['is_spec_project'] === true,
    description: description.trim(),
    website_url: assertOptionalHttpsUrl(body['website_url'], 'website_url', req, operation),
  };
}
