// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { FormationPeopleResponse } from '../interfaces/formation-people.interface';

/**
 * Case-insensitive email domain that classifies a project-settings entry as LF staff on the
 * formation people card (#2724). The settings document carries no staff flag and the access-check
 * service only answers for the caller, so the address domain is the one deterministic signal
 * available for every listed person — including pending invitees who have no account yet.
 */
export const LF_STAFF_EMAIL_DOMAIN = 'linuxfoundation.org';

export const FORMATION_PEOPLE_HEADING = 'People on this formation';

/** Group headings on the people card — keys double as {@link FormationPerson.group} values. */
export const FORMATION_PEOPLE_GROUP_LABELS = {
  staff: 'LF Staff',
  invited: 'Invited',
} as const;

/**
 * Status chip copy for non-staff rows. `invited` = the settings entry carries a username (the
 * person has an LF account and the grant is live); `invite_sent` = an email-only entry, i.e. the
 * upstream project service sent the invite and is waiting for acceptance to promote it.
 */
export const FORMATION_PERSON_STATUS_LABELS = {
  invited: 'Invited',
  invite_sent: 'Invite Sent',
} as const;

export const FORMATION_PEOPLE_FOOTER_NOTE = 'Invited people see this project and the items assigned to them. Labels are for display; access comes from grants.';

export const FORMATION_PEOPLE_EMPTY_MESSAGE = 'No one has been added to this formation yet.';

export const FORMATION_PEOPLE_UNAVAILABLE_MESSAGE = 'People are not available for this project right now.';

/** Invite dialog role radios — `view` is the default; `manage` is offered for partners who must work checklist items. */
export const FORMATION_INVITE_ROLE_OPTIONS = [
  { value: 'view', label: 'View', description: 'Can see the checklist and the items assigned to them.' },
  { value: 'manage', label: 'Manage', description: 'Can also assign items and edit the checklist.' },
] as const;

/**
 * Batch size for the BFF's per-person user-metadata fan-out. Settings lists are small (tens, not
 * hundreds), so this bounds concurrent NATS requests without serialising the whole list.
 */
export const FORMATION_PEOPLE_ENRICHMENT_BATCH_SIZE = 8;

/**
 * Factory, not a shared object — it backs both a `toSignal` initial value and a `catchError`
 * fallback (same reason as `createEmptyFormationsQueueResponse`), so each consumer gets its own
 * instance and nothing can mutate a module-level singleton.
 */
export function createUnavailableFormationPeopleResponse(): FormationPeopleResponse {
  return { state: 'unavailable', people: [] };
}
