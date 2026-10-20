// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { TagSeverity } from '../interfaces/components.interface';
import type { MemberImportFieldDefinition, MemberImportRowStatus } from '../interfaces/member-import.interface';
import { APPOINTED_BY_OPTIONS, MEMBER_FORM_VOTING_STATUSES, MEMBER_ROLES } from './committees.constants';

/** Largest member import CSV accepted, checked before the file is read. */
export const MEMBER_IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Most nonblank data records one import accepts (client workload bound, not an upstream limit). */
export const MEMBER_IMPORT_MAX_RECORDS = 500;

export const MEMBER_IMPORT_TEMPLATE_FILENAME = 'member-import-template.csv';

/** Match the upstream member URL spelling before WHATWG parsing can repair malformed URLs. */
export const MEMBER_IMPORT_HTTP_URL_PATTERN = /^https?:\/\/[^\s/$.?#][^\s]*$/;

/**
 * Mirrors Angular 20 Validators.email, used by the individual member form, without an Angular runtime dependency.
 * Pattern from Angular (Copyright Google LLC, MIT): https://github.com/angular/angular/blob/20.3.15/packages/forms/src/validators.ts
 */
export const MEMBER_IMPORT_EMAIL_PATTERN =
  /^(?=.{1,254}$)(?=.{1,64}@)[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/** Display the same voting choices that member validation accepts. */
export const MEMBER_IMPORT_VOTING_STATUS_LABELS = MEMBER_FORM_VOTING_STATUSES.map(({ label }) => label).join(', ');

/** Every header the member import CSV accepts, in template order. Anything else is rejected. */
export const MEMBER_IMPORT_COLUMNS = [
  'email',
  'first_name',
  'last_name',
  'job_title',
  'linkedin_profile',
  'organization_name',
  'organization_website',
  'role',
  'role_start_date',
  'role_end_date',
  'voting_status',
  'voting_start_date',
  'voting_end_date',
  'appointed_by',
] as const;

/** Template guidance derives accepted values from the same configured options used by validation. */
export const MEMBER_IMPORT_FIELDS: readonly MemberImportFieldDefinition[] = [
  { column: 'email', requiredWhen: 'always', votingOnly: false, description: 'Email address of the person to add.' },
  { column: 'first_name', requiredWhen: 'never', votingOnly: false, description: 'Up to 100 characters.' },
  { column: 'last_name', requiredWhen: 'never', votingOnly: false, description: 'Up to 100 characters.' },
  { column: 'job_title', requiredWhen: 'never', votingOnly: false, description: 'Up to 200 characters.' },
  { column: 'linkedin_profile', requiredWhen: 'never', votingOnly: false, description: 'Full LinkedIn profile URL, e.g. https://www.linkedin.com/in/…' },
  { column: 'organization_name', requiredWhen: 'organization', votingOnly: false, description: 'Up to 200 characters. Provide together with the website.' },
  { column: 'organization_website', requiredWhen: 'organization', votingOnly: false, description: 'Full https:// address. Provide together with the name.' },
  { column: 'role', requiredWhen: 'voting', votingOnly: false, description: `Allowed values: ${MEMBER_ROLES.map(({ value }) => value).join(', ')}.` },
  { column: 'role_start_date', requiredWhen: 'never', votingOnly: false, description: 'YYYY-MM-DD. Needs a role.' },
  { column: 'role_end_date', requiredWhen: 'never', votingOnly: false, description: 'YYYY-MM-DD, not before the start date. Needs a role.' },
  { column: 'voting_status', requiredWhen: 'voting', votingOnly: true, description: `${MEMBER_IMPORT_VOTING_STATUS_LABELS}.` },
  { column: 'voting_start_date', requiredWhen: 'never', votingOnly: true, description: 'YYYY-MM-DD. Needs a voting status.' },
  { column: 'voting_end_date', requiredWhen: 'never', votingOnly: true, description: 'YYYY-MM-DD, not before the start date. Needs a voting status.' },
  {
    column: 'appointed_by',
    requiredWhen: 'never',
    votingOnly: false,
    description: `Allowed values: ${APPOINTED_BY_OPTIONS.map(({ value }) => value).join(', ')}. Leave blank for the default.`,
  },
];

/** Derive voting-only validation from the same metadata used by the template. */
export const MEMBER_IMPORT_VOTING_COLUMNS = MEMBER_IMPORT_FIELDS.filter(({ votingOnly }) => votingOnly).map(({ column }) => column);

/** Tag label and severity for each import row status. */
export const MEMBER_IMPORT_STATUS_DISPLAY: Readonly<Record<MemberImportRowStatus, { label: string; severity: TagSeverity }>> = {
  ready: { label: 'Ready', severity: 'info' },
  invalid: { label: 'Invalid', severity: 'danger' },
  skipped: { label: 'Skipped', severity: 'secondary' },
  importing: { label: 'Adding…', severity: 'info' },
  added: { label: 'Added', severity: 'success' },
  failed: { label: 'Failed', severity: 'danger' },
};

/** HTTP statuses after which an import sends no further rows: lost access, a missing group, or rate limiting. */
export const MEMBER_IMPORT_FATAL_HTTP_STATUSES: ReadonlySet<number> = new Set([401, 403, 404, 429]);
