// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FORMATION_PEOPLE_GROUP_LABELS, LF_STAFF_EMAIL_DOMAIN } from '../constants/formation-people.constants';
import type {
  FormationPeopleGroup,
  FormationPeopleGroups,
  FormationPerson,
  FormationPersonRole,
  FormationPersonRow,
  FormationPersonStatus,
} from '../interfaces/formation-people.interface';
import type { ProjectSettings, UserInfo } from '../interfaces/project.interface';

/**
 * Whether an address belongs to LF staff for the people card's grouping (#2724) — an exact,
 * case-insensitive match on the domain after the last `@`, so `linuxfoundation.org.example` or a
 * subdomain never passes. The one deterministic signal available for every settings entry; see
 * `LF_STAFF_EMAIL_DOMAIN`.
 */
export function isLfStaffEmail(email: string | null | undefined): boolean {
  if (!email) {
    return false;
  }

  const at = email.lastIndexOf('@');
  if (at < 0) {
    return false;
  }

  return (
    email
      .slice(at + 1)
      .trim()
      .toLowerCase() === LF_STAFF_EMAIL_DOMAIN
  );
}

/**
 * Stable identity for a settings entry: the username when the person has an LF account, else the
 * lowercased email — the same fallback the Permissions page uses to address a username-less entry.
 * Empty when the entry carries neither (a malformed entry the caller should skip).
 */
export function formationPersonKey(entry: Pick<UserInfo, 'username' | 'email'>): string {
  const username = entry.username?.trim();
  if (username) {
    return username;
  }

  return (entry.email ?? '').trim().toLowerCase();
}

/**
 * How many checklist items name `username` as their upstream `assignee`. Always 0 without a
 * username: upstream only accepts existing grant holders as assignees, so a pending (email-only)
 * entry can't own an item yet.
 */
export function countAssignedFormationItems(assignees: ReadonlyArray<string | null | undefined>, username: string | null): number {
  if (!username) {
    return 0;
  }

  let count = 0;
  for (const assignee of assignees) {
    if (assignee === username) {
      count += 1;
    }
  }

  return count;
}

/**
 * Builds the people list from a project's settings roles (#2724). Writers are visited first, so
 * a person listed as both writer and auditor collapses to one `manage` row; entries with neither
 * username nor email are dropped. One human can also sit in the document twice under two
 * identities — an email-only (pending) entry and a username entry for the same address — because
 * `updateProjectPermissions` only matches an existing entry by email when the incoming identifier
 * is itself an email; the username entry wins here, so nobody renders as both "Invited" and
 * "Invite Sent". Enrichment fields (`job_title`, `organization`) start `null` — the BFF fills them
 * afterwards, best-effort. Output is sorted by name (case-insensitive) so the wire order is
 * deterministic regardless of how the settings arrays are ordered upstream.
 */
export function buildFormationPeople(settings: Pick<ProjectSettings, 'writers' | 'auditors'>): FormationPerson[] {
  const entries: Array<{ entry: UserInfo; role: FormationPersonRole }> = [
    ...(settings.writers ?? []).map((entry) => ({ entry, role: 'manage' as const })),
    ...(settings.auditors ?? []).map((entry) => ({ entry, role: 'view' as const })),
  ];

  // Addresses already represented by an account-bearing entry — a pending entry for one of these
  // is the same person, not a second one.
  const emailsWithUsername = new Set(
    entries.filter(({ entry }) => !!entry.username?.trim() && !!entry.email?.trim()).map(({ entry }) => entry.email.trim().toLowerCase())
  );

  const byKey = new Map<string, FormationPerson>();

  const add = (entry: UserInfo, role: FormationPersonRole): void => {
    const key = formationPersonKey(entry);
    if (!key || byKey.has(key)) {
      return;
    }

    const username = entry.username?.trim() || null;
    const email = (entry.email ?? '').trim();

    if (username === null && emailsWithUsername.has(email.toLowerCase())) {
      return;
    }

    byKey.set(key, {
      key,
      username,
      name: entry.name?.trim() || email || key,
      email,
      role,
      group: isLfStaffEmail(email) ? 'staff' : 'invited',
      is_pending: username === null,
      job_title: null,
      organization: null,
      avatar: entry.avatar?.trim() || null,
    });
  };

  for (const { entry, role } of entries) {
    add(entry, role);
  }

  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** The card's group keys in render order — `FORMATION_PEOPLE_GROUP_LABELS`'s declaration order, so the constant stays the single source of truth for both the set and the order. */
export function formationPeopleGroupKeys(): FormationPeopleGroup[] {
  return Object.keys(FORMATION_PEOPLE_GROUP_LABELS) as FormationPeopleGroup[];
}

/** Partitions a people list into the card's groups (every key present, possibly empty), preserving order within each. */
export function groupFormationPeople(people: readonly FormationPerson[]): FormationPeopleGroups {
  const groups = Object.fromEntries(formationPeopleGroupKeys().map((key) => [key, [] as FormationPerson[]])) as FormationPeopleGroups;

  for (const person of people) {
    groups[person.group].push(person);
  }

  return groups;
}

/**
 * The status chip an external row carries — `invite_sent` while the entry is email-only,
 * `invited` once upstream has promoted it with a username. LF staff rows never carry one.
 */
export function resolveFormationPersonStatus(person: Pick<FormationPerson, 'group' | 'is_pending'>): FormationPersonStatus | null {
  if (person.group === 'staff') {
    return null;
  }

  return person.is_pending ? 'invite_sent' : 'invited';
}

/**
 * `Partner contact · Contoso · 3 items` — title and organization when known, else the email
 * (a pending invitee has no metadata to show), with the assigned-item count appended only when
 * it is non-zero so an unassigned person never reads "0 items".
 */
export function formatFormationPersonSubtitle(person: Pick<FormationPerson, 'job_title' | 'organization' | 'email'>, assignedItemCount: number): string {
  const parts = [person.job_title, person.organization].filter((part): part is string => !!part && part.trim().length > 0);
  const base = parts.length > 0 ? parts.join(' · ') : person.email;

  if (assignedItemCount <= 0) {
    return base;
  }

  const noun = assignedItemCount === 1 ? 'item' : 'items';
  return `${base} · ${assignedItemCount} ${noun}`;
}

/**
 * Pre-resolves what the card template renders per row. `assignees` are the checklist items'
 * `owner.username` values the card already holds, so the count comes from the same read as the
 * checklist beside it — never from a second server-side fetch that could disagree with it.
 */
export function toFormationPersonRow(person: FormationPerson, assignees: ReadonlyArray<string | null | undefined>): FormationPersonRow {
  const assignedItemCount = countAssignedFormationItems(assignees, person.username);

  return {
    ...person,
    assigned_item_count: assignedItemCount,
    subtitle: formatFormationPersonSubtitle(person, assignedItemCount),
    status: resolveFormationPersonStatus(person),
  };
}
