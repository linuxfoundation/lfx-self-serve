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

/**
 * Batch size for the BFF's per-person user-metadata fan-out. Settings lists are small (tens, not
 * hundreds), so this bounds concurrent NATS requests without serialising the whole list.
 */
export const FORMATION_PEOPLE_ENRICHMENT_BATCH_SIZE = 8;

/**
 * How long the BFF memoises one person's user-metadata read (title / organization / picture)
 * across requests. The people card mounts on every checklist load on both hosts, and these
 * fields change rarely, so a revisit inside this window replays no per-person NATS fan-out.
 */
export const FORMATION_PEOPLE_METADATA_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Wall-clock budget for the whole enrichment fan-out. Each metadata read can wait up to
 * `NATS_CONFIG.REQUEST_TIMEOUT` when the auth-service responder is slow, so without a cap a long
 * list could stall the sidebar card for many seconds; once the budget is spent no further batches
 * are issued and the remaining people render unenriched (same pattern as `LOOKUP_BATCH_BUDGET_MS`).
 */
export const FORMATION_PEOPLE_ENRICHMENT_BUDGET_MS = 4000;

/** Hard cap on memoised user-metadata entries per process; the oldest entry is evicted once reached. */
export const FORMATION_PEOPLE_METADATA_CACHE_MAX_ENTRIES = 2000;

/**
 * Factory, not a shared object — it backs both a `toSignal` initial value and a `catchError`
 * fallback (same reason as `createEmptyFormationsQueueResponse`), so each consumer gets its own
 * instance and nothing can mutate a module-level singleton.
 */
export function createUnavailableFormationPeopleResponse(): FormationPeopleResponse {
  return { state: 'unavailable', people: [] };
}
