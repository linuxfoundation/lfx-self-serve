// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  FORMATION_AGREEMENT_TYPE_OPTIONS,
  FORMATION_CHAT_PLATFORM_OPTIONS,
  FORMATION_CONTACT_NAME_MAX_LENGTH,
  FORMATION_DESCRIPTION_MAX_LENGTH,
  FORMATION_LICENSE_OPTIONS,
  FORMATION_MAX_ADDITIONAL_CONTACTS,
  FORMATION_MISSION_STATEMENT_MAX_LENGTH,
  FORMATION_REQUIRED_FIELDS,
  FORMATION_SHORT_TEXT_MAX_LENGTH,
  FORMATION_TRADEMARK_STATUS_OPTIONS,
  FORMATION_URL_MAX_LENGTH,
} from '@lfx-one/shared/constants';
import type { FormationContact, FormationIntake } from '@lfx-one/shared/interfaces';
// Deep import, not the `@lfx-one/shared/utils` barrel: the barrel also re-exports form.utils.ts /
// vote.utils.ts / meeting.utils.ts, which pull in real (non-type-only) `@angular/forms` /
// `@angular/common/http` imports. That's harmless in the bundled Angular build, but loading it in
// this server-only vitest worker can hit `@angular/common`'s Location module before
// `@angular/compiler` is warmed up ("PlatformLocation needs to be compiled using the JIT
// compiler") — worker-scheduling-dependent, so avoid the barrel here entirely rather than rely on
// another spec having loaded the compiler first.
import { isValidEmail } from '@lfx-one/shared/utils/email.utils';
import { codePointLength } from '@lfx-one/shared/utils/string.utils';
import { Request } from 'express';

import { ServiceValidationError } from '../errors';

const FORMATION_TRADEMARK_STATUS_VALUES: readonly string[] = FORMATION_TRADEMARK_STATUS_OPTIONS.map((o) => o.value);
const FORMATION_LICENSE_VALUES: readonly string[] = FORMATION_LICENSE_OPTIONS.map((o) => o.value);
const FORMATION_CHAT_PLATFORM_VALUES: readonly string[] = FORMATION_CHAT_PLATFORM_OPTIONS.map((o) => o.value);
const FORMATION_AGREEMENT_TYPE_VALUES: readonly string[] = FORMATION_AGREEMENT_TYPE_OPTIONS.map((o) => o.value);

function fail(field: string, message: string, req: Request, operation: string): never {
  throw ServiceValidationError.forField(field, message, { operation, service: 'formation.controller', path: req.path });
}

/** Server-side mirror of the client's inline validation — the field list is explicitly pending
 *  Scott's Google-Form confirmation (see #1962), so required-ness is read off
 *  `FORMATION_REQUIRED_FIELDS` (the source of truth for this generic presence check) rather than
 *  a hand-written list here. See that constant's doc comment for why the Angular form doesn't
 *  read it the same way — keep the two in sync by convention when the field list changes. */
function assertRequiredField(body: Record<string, unknown>, field: string, req: Request, operation: string): void {
  const value = body[field];
  if (typeof value !== 'string' || value.trim() === '') {
    fail(field, `${field} is required`, req, operation);
  }
}

/** Caps every accepted string field — the fixture store holds every accepted payload for up to
 *  an hour (see `FORMATION_SHORT_TEXT_MAX_LENGTH`'s doc comment); this is the floor that keeps a
 *  single POST from growing that store by an arbitrary amount. */
function assertMaxLength(value: string, max: number, field: string, req: Request, operation: string): void {
  if (codePointLength(value) > max) {
    fail(field, `${field} must be ${max} characters or fewer`, req, operation);
  }
}

function assertOneOf(value: string, allowed: readonly string[], field: string, req: Request, operation: string): void {
  if (!allowed.includes(value)) {
    fail(field, `${field} must be one of: ${allowed.join(', ')}`, req, operation);
  }
}

function assertOptionalHttpsUrl(value: unknown, field: string, req: Request, operation: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    fail(field, `${field} must be a string`, req, operation);
  }
  assertMaxLength(value, FORMATION_URL_MAX_LENGTH, field, req, operation);
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    fail(field, `${field} must be a valid https URL`, req, operation);
  }
  if (parsed.protocol !== 'https:') {
    fail(field, `${field} must be a valid https URL`, req, operation);
  }
  return value.trim();
}

function parseContact(raw: unknown, field: string, req: Request, operation: string): FormationContact {
  const contact = raw as Partial<FormationContact> | undefined;
  if (!contact || typeof contact !== 'object') {
    fail(field, `${field} is required`, req, operation);
  }
  if (typeof contact.first_name !== 'string' || contact.first_name.trim() === '') {
    fail(`${field}.first_name`, 'First name is required', req, operation);
  }
  assertMaxLength(contact.first_name, FORMATION_CONTACT_NAME_MAX_LENGTH, `${field}.first_name`, req, operation);
  if (typeof contact.last_name !== 'string' || contact.last_name.trim() === '') {
    fail(`${field}.last_name`, 'Last name is required', req, operation);
  }
  assertMaxLength(contact.last_name, FORMATION_CONTACT_NAME_MAX_LENGTH, `${field}.last_name`, req, operation);
  // isValidEmail (EMAIL_REGEX) is the same check `strictEmailValidator()` runs client-side — a
  // single source of truth instead of two independently-drifting patterns (unlike Angular's own
  // Validators.email, which admits a dotless domain such as `someone@localhost`).
  if (typeof contact.email !== 'string' || !isValidEmail(contact.email)) {
    fail(`${field}.email`, 'A valid email is required', req, operation);
  }
  assertMaxLength(contact.email, FORMATION_SHORT_TEXT_MAX_LENGTH, `${field}.email`, req, operation);
  return { first_name: contact.first_name.trim(), last_name: contact.last_name.trim(), email: contact.email.trim() };
}

/**
 * Validates and normalizes the intake POST body. Throws {@link ServiceValidationError} on the
 * first violation — the controller's `try/catch` around this call forwards it to `next(error)`
 * (see `.claude/skills/self-serve-dev/references/backend-endpoint.md`'s controller pattern).
 */
export function parseFormationIntakeBody(req: Request, operation: string): FormationIntake {
  const body = (req.body ?? {}) as Record<string, unknown>;

  for (const field of FORMATION_REQUIRED_FIELDS) {
    assertRequiredField(body, field, req, operation);
  }

  const projectName = (body['project_name'] as string).trim();
  assertMaxLength(projectName, FORMATION_SHORT_TEXT_MAX_LENGTH, 'project_name', req, operation);

  const contributingOrgName = (body['contributing_org_name'] as string).trim();
  assertMaxLength(contributingOrgName, FORMATION_SHORT_TEXT_MAX_LENGTH, 'contributing_org_name', req, operation);

  const trademarkStatus = (body['trademark_status'] as string).trim();
  assertOneOf(trademarkStatus, FORMATION_TRADEMARK_STATUS_VALUES, 'trademark_status', req, operation);

  const license = (body['license'] as string).trim();
  assertOneOf(license, FORMATION_LICENSE_VALUES, 'license', req, operation);

  const chatPlatform = (body['chat_platform'] as string).trim();
  assertOneOf(chatPlatform, FORMATION_CHAT_PLATFORM_VALUES, 'chat_platform', req, operation);

  const agreementType = (body['agreement_type'] as string).trim();
  assertOneOf(agreementType, FORMATION_AGREEMENT_TYPE_VALUES, 'agreement_type', req, operation);

  const missionStatement = String(body['mission_statement'] ?? '').trim();
  assertMaxLength(missionStatement, FORMATION_MISSION_STATEMENT_MAX_LENGTH, 'mission_statement', req, operation);

  const description = String(body['description'] ?? '').trim();
  assertMaxLength(description, FORMATION_DESCRIPTION_MAX_LENGTH, 'description', req, operation);

  const projectLogoFilename =
    typeof body['project_logo_filename'] === 'string' && body['project_logo_filename'] ? (body['project_logo_filename'] as string).trim() : null;
  if (projectLogoFilename) {
    assertMaxLength(projectLogoFilename, FORMATION_SHORT_TEXT_MAX_LENGTH, 'project_logo_filename', req, operation);
  }

  const contributingOrgId =
    typeof body['contributing_org_id'] === 'string' && body['contributing_org_id'] ? (body['contributing_org_id'] as string).trim() : null;
  if (contributingOrgId) {
    assertMaxLength(contributingOrgId, FORMATION_SHORT_TEXT_MAX_LENGTH, 'contributing_org_id', req, operation);
  }

  const parentProjectUid = typeof body['parent_project_uid'] === 'string' && body['parent_project_uid'] ? (body['parent_project_uid'] as string).trim() : null;
  if (parentProjectUid) {
    assertMaxLength(parentProjectUid, FORMATION_SHORT_TEXT_MAX_LENGTH, 'parent_project_uid', req, operation);
  }

  const legalContact = parseContact(body['legal_contact'], 'legal_contact', req, operation);
  const rawAdditionalContacts = body['additional_contacts'];
  if (Array.isArray(rawAdditionalContacts) && rawAdditionalContacts.length > FORMATION_MAX_ADDITIONAL_CONTACTS) {
    fail('additional_contacts', `additional_contacts must have ${FORMATION_MAX_ADDITIONAL_CONTACTS} entries or fewer`, req, operation);
  }
  const additionalContacts = Array.isArray(rawAdditionalContacts)
    ? rawAdditionalContacts.map((contact, index) => parseContact(contact, `additional_contacts[${index}]`, req, operation))
    : [];

  return {
    parent_project_uid: parentProjectUid,
    project_name: projectName,
    project_repository_url: assertOptionalHttpsUrl(body['project_repository_url'], 'project_repository_url', req, operation),
    project_logo_filename: projectLogoFilename,
    trademark_status: trademarkStatus,
    contributing_org_name: contributingOrgName,
    contributing_org_id: contributingOrgId,
    contributing_org_website_url: assertOptionalHttpsUrl(body['contributing_org_website_url'], 'contributing_org_website_url', req, operation),
    legal_contact: legalContact,
    additional_contacts: additionalContacts,
    license,
    chat_platform: chatPlatform,
    mission_statement: missionStatement,
    agreement_type: agreementType,
    is_spec_project: body['is_spec_project'] === true,
    description,
    website_url: assertOptionalHttpsUrl(body['website_url'], 'website_url', req, operation),
  };
}
