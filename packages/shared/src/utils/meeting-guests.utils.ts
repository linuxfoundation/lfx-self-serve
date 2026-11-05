// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  CommitteeMember,
  Meeting,
  MeetingCommittee,
  MeetingGuestFilterChip,
  MeetingGuestFilterField,
  MeetingGuestFilters,
  MeetingGuestRoleKey,
  MeetingGuestRow,
  MeetingGuestRowActions,
  MeetingGuestStatusKey,
  MeetingGuestSummary,
  MeetingGuestViewer,
  MeetingHostCandidate,
  MeetingRegistrant,
  PastMeetingParticipant,
} from '../interfaces';
import {
  MEETING_GUEST_DIRECT_GROUP,
  MEETING_GUEST_EMPTY_FILTERS,
  MEETING_GUEST_ROLE_LABELS,
  MEETING_GUEST_HIDDEN_VOTING_STATUSES,
  MEETING_GUEST_STATUSES,
  MEETING_GUEST_VOTING_REP_STATUSES,
} from '../constants/meeting-guests.constants';
import { avatarInitials, registrantDisplayName } from './avatar.utils';
import { isHttpUrl } from './project-application.utils';
import { buildMeetingOrganizerKeys, isUnresolvableParticipantName, resolveMeetingGuestRole } from './meeting.utils';
import { getRegistrantAttendanceStatus } from './rsvp-calculator.util';

const RSVP_TO_STATUS = { accepted: 'yes', maybe: 'maybe', declined: 'no', pending: 'pending' } as const;
const ROLE_ORDER = Object.keys(MEETING_GUEST_ROLE_LABELS) as MeetingGuestRoleKey[];
const STATUS_ORDER: Record<MeetingGuestStatusKey, number> = { yes: 0, maybe: 1, pending: 2, no: 3, attended: 0, absent: 1 };

/** Guest rows from upcoming registrants; `rsvpEnabled` false leaves every status null. A committee not on the meeting counts as direct. */
export function buildRegistrantGuestRows(
  registrants: MeetingRegistrant[],
  meeting: Pick<Meeting, 'organizers' | 'committees'>,
  viewer: MeetingGuestViewer,
  rsvpEnabled: boolean
): MeetingGuestRow[] {
  const organizerKeys = buildMeetingOrganizerKeys(meeting.organizers);
  const known = meetingGroupUids(meeting.committees);
  return sortMeetingGuestRows(registrants, (registrant) => {
    const status = rsvpEnabled ? RSVP_TO_STATUS[getRegistrantAttendanceStatus(registrant)] : null;
    const inGroup = registrant.type === 'committee' && !!registrant.committee_uid && known.has(registrant.committee_uid);
    return {
      ...toRow(registrant, organizerKeys, viewer, {
        status,
        invited: true,
        groups: inGroup ? [registrant.committee_uid as string] : [],
        votingStatus: registrant.committee_voting_status ?? null,
        linkedin: registrant.linkedin_profile,
      }),
      registrant,
    };
  });
}

/** Organizer actions on an upcoming registrant row; null for participants, invitees and once the meeting has ended. */
export function getMeetingGuestRowActions(row: MeetingGuestRow, organizer: boolean, ended: boolean): MeetingGuestRowActions | null {
  const registrant = row.registrant;
  if (!registrant || !organizer || ended) return null;
  // The viewer leaves through Remove Myself, which also clears their own registration state.
  return { resend: true, host: row.role !== 'organizer', remove: registrant.type !== 'committee' && !row.you };
}

/** Participant rows of an ended meeting; groups are every meeting committee the email belongs to, and a Voting Rep status wins. */
export function buildParticipantGuestRows(
  participants: PastMeetingParticipant[],
  meeting: Pick<Meeting, 'organizers' | 'committees'>,
  viewer: MeetingGuestViewer,
  committeeMembers: CommitteeMember[]
): MeetingGuestRow[] {
  const organizerKeys = buildMeetingOrganizerKeys(meeting.organizers);
  const known = meetingGroupUids(meeting.committees);
  const membersByEmail = new Map<string, CommitteeMember[]>();
  for (const member of committeeMembers) {
    const email = member.email?.trim().toLowerCase();
    if (email && member.committee_uid && known.has(member.committee_uid)) membersByEmail.set(email, [...(membersByEmail.get(email) ?? []), member]);
  }
  return sortMeetingGuestRows(participants, (participant) => {
    const members = membersByEmail.get(participant.email?.trim().toLowerCase() ?? '') ?? [];
    const statuses = members.flatMap((member) => member.voting?.status ?? []);
    return toRow(participant, organizerKeys, viewer, {
      status: participant.is_attended ? 'attended' : 'absent',
      invited: participant.is_invited !== false,
      groups: [...new Set(members.map((member) => member.committee_uid as string))],
      votingStatus:
        statuses.find((status) => MEETING_GUEST_VOTING_REP_STATUSES.includes(status)) ??
        statuses.find((status) => !MEETING_GUEST_HIDDEN_VOTING_STATUSES.includes(status)) ??
        null,
      linkedin: null,
    });
  });
}

/** Popover selects: RSVP (when collected) or Attendance and Invite, then Role, Group when the meeting has committees, and Voting once ended when a committee has voting statuses. */
export function getMeetingGuestFilterFields(ended: boolean, rsvpEnabled: boolean, committees: Meeting['committees']): MeetingGuestFilterField[] {
  const statusOptions = (keys: MeetingGuestStatusKey[]) => keys.map((key) => ({ value: key, label: MEETING_GUEST_STATUSES[key].label }));
  const fields: MeetingGuestFilterField[] = [];
  if (ended) {
    fields.push({ key: 'status', title: 'Attendance', allLabel: 'All attendees', options: statusOptions(['attended', 'absent']) });
    fields.push({
      key: 'invite',
      title: 'Invite',
      allLabel: 'All invites',
      options: [
        { value: 'invited', label: 'Invited' },
        { value: 'uninvited', label: 'Not invited' },
      ],
    });
  } else if (rsvpEnabled) {
    fields.push({ key: 'status', title: 'RSVP status', allLabel: 'Any RSVP status', options: statusOptions(['yes', 'maybe', 'no', 'pending']) });
  }
  fields.push({
    key: 'role',
    title: 'Role',
    allLabel: 'All roles',
    options: ROLE_ORDER.map((role) => ({ value: role, label: MEETING_GUEST_ROLE_LABELS[role] })),
  });
  const groups = (committees ?? []).filter(isMeetingGroup);
  if (groups.length) {
    fields.push({
      key: 'group',
      title: 'Group',
      allLabel: 'All groups',
      options: [
        ...groups.map((committee) => ({ value: committee.uid, label: committee.name as string })),
        { value: MEETING_GUEST_DIRECT_GROUP, label: 'Direct invite' },
      ],
    });
  }
  if (ended && (committees ?? []).some((committee) => committee.allowed_voting_statuses?.length)) {
    fields.push({ key: 'voting', title: 'Voting', allLabel: 'All participants', options: [{ value: 'reps', label: 'Voting Reps' }] });
  }
  return fields;
}

/** The filters with every value the fields no longer offer cleared. */
export function getOfferedMeetingGuestFilters(filters: MeetingGuestFilters, fields: MeetingGuestFilterField[]): MeetingGuestFilters {
  const offered: MeetingGuestFilters = { ...MEETING_GUEST_EMPTY_FILTERS };
  for (const field of fields) {
    if (field.options.some((option) => option.value === filters[field.key])) {
      Object.assign(offered, { [field.key]: filters[field.key] });
    }
  }
  return offered;
}

/** Applied filters as chips, in the popover's field order. */
export function getMeetingGuestFilterChips(filters: MeetingGuestFilters, fields: MeetingGuestFilterField[]): MeetingGuestFilterChip[] {
  return fields.flatMap((field) => {
    const option = field.options.find((item) => item.value === filters[field.key]);
    return option ? [{ key: field.key, prefix: `${field.title}:`, label: option.label }] : [];
  });
}

/** Rows matching the search (name, meta, email) and every applied filter. */
export function filterMeetingGuestRows(rows: MeetingGuestRow[], query: string, filters: MeetingGuestFilters): MeetingGuestRow[] {
  const term = query.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (!term || row.searchText.includes(term)) &&
      (!filters.status || row.status === filters.status) &&
      (!filters.role || row.role === filters.role) &&
      (!filters.invite || row.invited === (filters.invite === 'invited')) &&
      (!filters.group || (filters.group === MEETING_GUEST_DIRECT_GROUP ? !row.groups.length : row.groups.includes(filters.group))) &&
      (!filters.voting || row.votingRep)
  );
}

/** Heading and total: participants with attended and invited counts once ended, members for a committee meeting, else guests. */
export function getMeetingGuestSummary(rows: MeetingGuestRow[], ended: boolean, committeeMeeting: boolean): MeetingGuestSummary {
  if (ended) {
    const attended = rows.filter((row) => row.status === 'attended').length;
    const invited = rows.filter((row) => row.invited).length;
    return { title: 'Meeting Participants', subtitle: `${attended} attended / ${invited} invited` };
  }
  const count = (noun: string) => `${rows.length} ${noun}${rows.length === 1 ? '' : 's'}`;
  return committeeMeeting ? { title: 'Meeting Members', subtitle: count('member') } : { title: 'Meeting Guests', subtitle: count('guest') };
}

/** Re-orders registrant rows after a local change, such as a host toggle, with the order the list was built in. */
export function resortMeetingGuestRows(rows: MeetingGuestRow[]): MeetingGuestRow[] {
  return orderMeetingGuestRows(rows.map((row) => ({ row, unnamed: isUnresolvableParticipantName(row.registrant?.first_name, row.registrant?.last_name) })));
}

/** Builds each row, then orders them. */
function sortMeetingGuestRows<T extends MeetingHostCandidate>(people: T[], build: (person: T) => MeetingGuestRow): MeetingGuestRow[] {
  return orderMeetingGuestRows(people.map((person) => ({ row: build(person), unnamed: isUnresolvableParticipantName(person.first_name, person.last_name) })));
}

/** The viewer, role, status, named before unnamed, then name A–Z. */
function orderMeetingGuestRows(entries: { row: MeetingGuestRow; unnamed: boolean }[]): MeetingGuestRow[] {
  return [...entries]
    .sort(
      (a, b) =>
        Number(b.row.you) - Number(a.row.you) ||
        ROLE_ORDER.indexOf(a.row.role) - ROLE_ORDER.indexOf(b.row.role) ||
        statusRank(a.row) - statusRank(b.row) ||
        Number(a.unnamed) - Number(b.unnamed) ||
        a.row.name.localeCompare(b.row.name)
    )
    .map(({ row }) => row);
}

/** Committees the Group filter offers: named ones with a uid. */
function isMeetingGroup(committee: MeetingCommittee): boolean {
  return !!committee.uid && !!committee.name;
}

function meetingGroupUids(committees: Meeting['committees']): ReadonlySet<string> {
  return new Set((committees ?? []).filter(isMeetingGroup).map((committee) => committee.uid));
}

function statusRank(row: MeetingGuestRow): number {
  return row.status ? STATUS_ORDER[row.status] : 0;
}

function toRow(
  person: MeetingHostCandidate & { uid: string; job_title?: string | null; org_name?: string | null },
  organizerKeys: ReadonlySet<string>,
  viewer: MeetingGuestViewer,
  extra: { status: MeetingGuestStatusKey | null; invited: boolean; groups: string[]; votingStatus: string | null; linkedin: string | null }
): MeetingGuestRow {
  const { status, invited, groups, votingStatus } = extra;
  const name = registrantDisplayName(person);
  const meta = [person.job_title, person.org_name]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' · ');
  const email = person.email?.trim().toLowerCase() || null;
  const username = person.username?.trim().toLowerCase() || null;
  const role = resolveMeetingGuestRole(person, organizerKeys) ?? 'guest';
  const you = (!!email && email === viewer.email?.trim().toLowerCase()) || (!!username && username === viewer.username?.trim().toLowerCase());
  return {
    uid: person.uid,
    name: you ? `${name} (You)` : name,
    initials: avatarInitials(person.first_name, person.last_name, person.email),
    avatarUrl: person.avatar_url ?? '',
    meta,
    email: person.email ?? '',
    linkedinUrl: extra.linkedin && isHttpUrl(extra.linkedin, true) ? extra.linkedin : null,
    votingStatus: votingStatus && !MEETING_GUEST_HIDDEN_VOTING_STATUSES.includes(votingStatus) ? votingStatus : null,
    votingRep: !!votingStatus && MEETING_GUEST_VOTING_REP_STATUSES.includes(votingStatus),
    role,
    roleLabel: MEETING_GUEST_ROLE_LABELS[role],
    status,
    statusBadge: status ? MEETING_GUEST_STATUSES[status].badge : null,
    invited,
    groups,
    you,
    searchText: `${registrantDisplayName(person, '')} ${meta} ${email ?? ''}`.toLowerCase(),
  };
}
