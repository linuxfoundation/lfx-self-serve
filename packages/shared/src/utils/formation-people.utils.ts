// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LF_STAFF_EMAIL_DOMAIN } from '../constants/formation-people.constants';
import type {
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
 * username nor email are dropped. Enrichment fields (`job_title`, `organization`) start `null` —
 * the BFF fills them afterwards, best-effort. Output is sorted by name (case-insensitive) so the
 * wire order is deterministic regardless of how the settings arrays are ordered upstream.
 */
export function buildFormationPeople(
  settings: Pick<ProjectSettings, 'writers' | 'auditors'>,
  assignees: ReadonlyArray<string | null | undefined>
): FormationPerson[] {
  const byKey = new Map<string, FormationPerson>();

  const add = (entry: UserInfo, role: FormationPersonRole): void => {
    const key = formationPersonKey(entry);
    if (!key || byKey.has(key)) {
      return;
    }

    const username = entry.username?.trim() || null;
    const email = (entry.email ?? '').trim();

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
      assigned_item_count: countAssignedFormationItems(assignees, username),
    });
  };

  for (const writer of settings.writers ?? []) {
    add(writer, 'manage');
  }
  for (const auditor of settings.auditors ?? []) {
    add(auditor, 'view');
  }

  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** Partitions a people list into the card's two groups, preserving order within each. */
export function groupFormationPeople(people: readonly FormationPerson[]): FormationPeopleGroups {
  const groups: FormationPeopleGroups = { staff: [], invited: [] };

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
export function formatFormationPersonSubtitle(person: Pick<FormationPerson, 'job_title' | 'organization' | 'email' | 'assigned_item_count'>): string {
  const parts = [person.job_title, person.organization].filter((part): part is string => !!part && part.trim().length > 0);
  const base = parts.length > 0 ? parts.join(' · ') : person.email;

  if (person.assigned_item_count <= 0) {
    return base;
  }

  const noun = person.assigned_item_count === 1 ? 'item' : 'items';
  return `${base} · ${person.assigned_item_count} ${noun}`;
}

/** Pre-resolves the strings the card template renders, so the template does a plain property read per row. */
export function toFormationPersonRow(person: FormationPerson): FormationPersonRow {
  return {
    ...person,
    subtitle: formatFormationPersonSubtitle(person),
    status: resolveFormationPersonStatus(person),
  };
}
