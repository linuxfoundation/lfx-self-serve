// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { TagSeverity } from '../interfaces/components.interface';
import type { MemberImportFieldDefinition, MemberImportRowStatus } from '../interfaces/member-import.interface';

/** Largest member import CSV accepted, checked before the file is read. */
export const MEMBER_IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Most nonblank data records one import accepts (client workload bound, not an upstream limit). */
export const MEMBER_IMPORT_MAX_RECORDS = 500;

export const MEMBER_IMPORT_TEMPLATE_FILENAME = 'member-import-template.csv';

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

/**
 * Template guidance per column. The allowed role / voting status / appointed-by values are
 * validated against MEMBER_ROLES, MEMBER_FORM_VOTING_STATUSES and APPOINTED_BY_OPTIONS
 * (see member-import.utils) rather than repeated here.
 */
export const MEMBER_IMPORT_FIELDS: readonly MemberImportFieldDefinition[] = [
  { column: 'email', requiredWhen: 'always', votingOnly: false, description: 'Email address of the person to add.' },
  { column: 'first_name', requiredWhen: 'never', votingOnly: false, description: 'Up to 100 characters.' },
  { column: 'last_name', requiredWhen: 'never', votingOnly: false, description: 'Up to 100 characters.' },
  { column: 'job_title', requiredWhen: 'never', votingOnly: false, description: 'Up to 200 characters.' },
  { column: 'linkedin_profile', requiredWhen: 'never', votingOnly: false, description: 'Full LinkedIn profile URL, e.g. https://www.linkedin.com/in/…' },
  { column: 'organization_name', requiredWhen: 'organization', votingOnly: false, description: 'Up to 200 characters. Provide together with the website.' },
  { column: 'organization_website', requiredWhen: 'organization', votingOnly: false, description: 'Full https:// address. Provide together with the name.' },
  { column: 'role', requiredWhen: 'voting', votingOnly: false, description: 'One of the group roles, e.g. Chair, Vice Chair, None.' },
  { column: 'role_start_date', requiredWhen: 'never', votingOnly: false, description: 'YYYY-MM-DD. Needs a role.' },
  { column: 'role_end_date', requiredWhen: 'never', votingOnly: false, description: 'YYYY-MM-DD, not before the start date. Needs a role.' },
  { column: 'voting_status', requiredWhen: 'voting', votingOnly: true, description: 'Voting Rep, Alternate Voting Rep, Observer or Emeritus.' },
  { column: 'voting_start_date', requiredWhen: 'never', votingOnly: true, description: 'YYYY-MM-DD. Needs a voting status.' },
  { column: 'voting_end_date', requiredWhen: 'never', votingOnly: true, description: 'YYYY-MM-DD, not before the start date. Needs a voting status.' },
  {
    column: 'appointed_by',
    requiredWhen: 'never',
    votingOnly: false,
    description: 'How the member was appointed, e.g. Community. Leave blank for the default.',
  },
];

/** Tag label and severity for each import row status. */
export const MEMBER_IMPORT_STATUS_DISPLAY: Readonly<Record<MemberImportRowStatus, { label: string; severity: TagSeverity }>> = {
  ready: { label: 'Ready', severity: 'info' },
  invalid: { label: 'Invalid', severity: 'danger' },
  skipped: { label: 'Skipped', severity: 'secondary' },
  importing: { label: 'Adding…', severity: 'info' },
  added: { label: 'Added', severity: 'success' },
  failed: { label: 'Failed', severity: 'danger' },
};

/** HTTP statuses after which an import sends no further rows: the caller lost access or the group is gone. */
export const MEMBER_IMPORT_FATAL_HTTP_STATUSES: ReadonlySet<number> = new Set([401, 403, 404]);
