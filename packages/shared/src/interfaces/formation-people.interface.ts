// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { FORMATION_PEOPLE_GROUP_LABELS, FORMATION_PERSON_STATUS_LABELS } from '../constants/formation-people.constants';

/** Mirrors `AddUserToProjectRequest['role']` — `manage` = settings `writers`, `view` = settings `auditors`. */
export type FormationPersonRole = 'view' | 'manage';

export type FormationPeopleGroup = keyof typeof FORMATION_PEOPLE_GROUP_LABELS;

export type FormationPersonStatus = keyof typeof FORMATION_PERSON_STATUS_LABELS;

/**
 * `unavailable` = the project-settings read failed for this caller — typically a 403 for LF staff
 * whose checklist access comes from a global team grant, since upstream gates `GET
 * /projects/{uid}/settings` on the bare project `auditor` relation while the checklist read
 * accepts `auditor_guard`. The checklist itself loaded; only the people list is missing.
 */
export type FormationPeopleState = 'loaded' | 'unavailable';

/**
 * One project-settings entry (writer or auditor) as `GET /api/projects/:slug/formation/people`
 * serves it — deduped, classified, and enriched (#2724). A formation invite is a project invite
 * (#2147): the upstream project service emails every email-only entry and promotes it in place
 * on acceptance, so {@link is_pending} is simply "no username yet".
 */
export interface FormationPerson {
  /** Stable row key — the username, else the lowercased email. Used for `@for` tracking and `data-testid` suffixes. */
  key: string;
  username: string | null;
  name: string;
  email: string;
  role: FormationPersonRole;
  group: FormationPeopleGroup;
  /** `true` when the settings entry has no username — the invite email was sent but not yet accepted. */
  is_pending: boolean;
  /** From the auth-service user-metadata read; `null` when the lookup was skipped (pending), failed, or the field is empty. */
  job_title: string | null;
  organization: string | null;
  /** The settings avatar, else the metadata `picture`; `null` when neither is set. */
  avatar: string | null;
}

/**
 * The three user-metadata fields the people card consumes — and the ONLY profile data the BFF
 * memoises across requests. The auth-service profile also carries address, phone and other PII
 * this feature never renders, so it is projected to this shape before any value enters the cache.
 */
export interface FormationPersonMetadata {
  job_title: string | null;
  organization: string | null;
  picture: string | null;
}

/** Response body for `GET /api/projects/:slug/formation/people`. */
export interface FormationPeopleResponse {
  state: FormationPeopleState;
  people: FormationPerson[];
}

/** Every group in `FORMATION_PEOPLE_GROUP_LABELS`, in that constant's declaration order — the card's render order. */
export type FormationPeopleGroups = Record<FormationPeopleGroup, FormationPerson[]>;

/**
 * The people card's row view-model — a {@link FormationPerson} plus what the card derives from the
 * checklist it already holds (the assigned-item count, from `FormationItem.owner.username`) and
 * the strings the template renders, so the template calls no functions and the list read never
 * refetches the checklist for a count the client can compute.
 */
export interface FormationPersonRow extends FormationPerson {
  /** Checklist items whose `owner.username` is this person's username; always 0 for a pending entry. */
  assigned_item_count: number;
  subtitle: string;
  /** `null` for LF staff — only external rows carry a status chip. */
  status: FormationPersonStatus | null;
}

/** One rendered group on the people card — only non-empty groups are emitted, so the template loops once with no per-group branching. */
export interface FormationPeopleRowGroup {
  key: FormationPeopleGroup;
  label: string;
  rows: FormationPersonRow[];
}
