// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  FORMATION_ASSIGNEE_PENDING_NOTE,
  FORMATION_PEOPLE_OTHER_GROUP_LABEL,
  FORMATION_PEOPLE_STAFF_GROUP_LABEL,
  LF_STAFF_EMAIL_DOMAIN,
} from '../constants/formation-people.constants';
import type {
  FormationPeopleRowGroup,
  FormationPerson,
  FormationPersonRole,
  FormationPersonRow,
  FormationPersonStatus,
} from '../interfaces/formation-people.interface';
import type { ProjectSettings, UserInfo } from '../interfaces/project.interface';
import type { UserSearchOption } from '../interfaces/search.interface';

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

/**
 * The people card's groups (#2724): LF Staff first, then one group per invited organization
 * (A–Z by name), then Other for invitees with no known organization — email-only entries have no
 * profile to enrich, and enrichment is best-effort. Organizations are matched on the name with
 * case and whitespace folded, so `Contoso Ltd` and `contoso  ltd` land together under the first
 * spelling seen while `C++` and `C` stay apart. A name with no letters or digits, or one that is
 * literally "Other", joins the Other group rather than rendering a second heading of that name.
 * Rows keep the input order (`buildFormationPeople` already sorts by name) and empty groups are
 * omitted.
 */
export function buildFormationPeopleRowGroups(
  people: readonly FormationPerson[],
  assignees: ReadonlyArray<string | null | undefined>
): FormationPeopleRowGroup[] {
  const staff: FormationPeopleRowGroup = { key: 'staff', label: FORMATION_PEOPLE_STAFF_GROUP_LABEL, rows: [] };
  const other: FormationPeopleRowGroup = { key: 'other', label: FORMATION_PEOPLE_OTHER_GROUP_LABEL, rows: [] };
  const otherIdentity = FORMATION_PEOPLE_OTHER_GROUP_LABEL.toLowerCase();
  // Keyed by the folded name (identity); the render key is assigned after sorting.
  const organizations = new Map<string, FormationPeopleRowGroup>();

  for (const person of people) {
    const row = toFormationPersonRow(person, assignees);

    if (person.group === 'staff') {
      staff.rows.push(row);
      continue;
    }

    const label = (person.organization ?? '').trim().replace(/\s+/g, ' ');
    const identity = label.toLowerCase();
    if (!slugifyOrganization(identity) || identity === otherIdentity) {
      other.rows.push(row);
      continue;
    }

    const group = organizations.get(identity);
    if (group) {
      group.rows.push(row);
    } else {
      organizations.set(identity, { key: '', label, rows: [row] });
    }
  }

  // Pinned locale: the card renders on the server and in the browser, and both must agree on order.
  const byOrganization = [...organizations.values()].sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }));

  // `org-<slug>` for the testid/track key; names that slug alike (`C++` / `C`) get a numeric suffix so keys stay unique.
  const used = new Set<string>();
  for (const group of byOrganization) {
    const base = `org-${slugifyOrganization(group.label.toLowerCase())}`;
    let key = base;
    for (let n = 2; used.has(key); n += 1) {
      key = `${base}-${n}`;
    }
    used.add(key);
    group.key = key;
  }

  return [staff, ...byOrganization, other].filter((group) => group.rows.length > 0);
}

/**
 * Letters, marks and digits joined by `-` — split/join rather than a replace plus edge-trim regex,
 * so the work stays linear on long runs of punctuation.
 */
function slugifyOrganization(name: string): string {
  return name
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter((part) => part.length > 0)
    .join('-');
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
 * `Partner contact · 3 items` — the title when known, else the email (a pending invitee has no
 * metadata to show), with the assigned-item count appended only when it is non-zero so an
 * unassigned person never reads "0 items". The organization is left out: the card groups rows
 * under it, so the heading already says it.
 */
export function formatFormationPersonSubtitle(person: Pick<FormationPerson, 'job_title' | 'email'>, assignedItemCount: number): string {
  const title = person.job_title?.trim();
  const base = title || person.email;

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

/**
 * Maps one person on the formation to a row the shared `lfx-user-search` picker can list as a
 * caller-supplied candidate (#2594: the assignee picker searches the project's grant holders, not
 * a global directory). The settings entry carries a single `name`, so it rides `first_name` whole
 * and `last_name` stays empty — `composeFullName` renders that without a stray space. An entry
 * with no name of its own (`buildFormationPeople` falls back to the email) gets an empty name
 * instead, so the picker shows the address once rather than as "email (email)". A pending
 * (email-only) entry is listed but disabled with a note, since upstream only accepts a grant
 * holder with a username as an assignee: showing the row explains why the person cannot be picked
 * yet, instead of a search that silently finds nobody.
 */
export function toAssigneeSearchOption(person: FormationPerson): UserSearchOption {
  return {
    uid: person.key,
    email: person.email,
    first_name: person.name === person.email ? '' : person.name,
    last_name: '',
    job_title: person.job_title,
    organization: person.organization ? { name: person.organization } : null,
    committee: null,
    type: 'project_member',
    username: person.username,
    disabled: person.is_pending,
    note: person.is_pending ? FORMATION_ASSIGNEE_PENDING_NOTE : null,
  };
}

/**
 * The listed person holding `username`, for rendering a committed assignee as a name rather than
 * a bare LFID; `null` when the list does not know them or the username is blank.
 */
export function findFormationPersonByUsername(people: readonly FormationPerson[], username: string | null | undefined): FormationPerson | null {
  const wanted = username?.trim();
  if (!wanted) {
    return null;
  }

  return people.find((person) => person.username === wanted) ?? null;
}
