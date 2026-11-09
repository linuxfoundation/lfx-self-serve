// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MENTORSHIP_PROGRAM_LOGO_HINT_STATUSES } from '@lfx-one/shared/constants';
import {
  MentorshipMentorProgramStatus,
  MentorshipProgram,
  MentorshipProgramMentor,
  MentorshipProgramStatus,
  MentorshipProgramTermDates,
  MentorshipProgramTermRow,
  MentorshipUpstreamAdministeredProgram,
  MentorshipUpstreamMemberManagementRow,
  MentorshipUpstreamProgramHeader,
  MentorshipUpstreamProgramManagementSummary,
  MentorshipUpstreamTermManagementRow,
} from '@lfx-one/shared/interfaces';
import { isUuid } from '@lfx-one/shared/utils';

import { MENTORSHIP_ADMIN_MENTOR_STATUS_MAP, MENTORSHIP_ADMIN_PROGRAM_STATUS_BY_UPSTREAM, MENTORSHIP_ADMIN_UNPUBLISHED_PROGRAM_STATUS } from '../constants';

import { toIsoDate } from './date-format.helper';

/**
 * Builds one admin list row from an upstream administered program. Upstream decides the status shown (`admin_status`);
 * a value this does not know reads as `pending-review` with `unknownStatus` set, so the caller can log it.
 * The slug falls back to the id so `/mentorship/admin/:programId` always resolves.
 * `logoMissing` reads the raw `status`: a program awaiting review (`pending`) or published without a logo gets the card's hint.
 */
export const mapMentorshipAdminProgram = (item: MentorshipUpstreamAdministeredProgram): { program: MentorshipProgram; unknownStatus: boolean } => {
  const status = Object.hasOwn(MENTORSHIP_ADMIN_PROGRAM_STATUS_BY_UPSTREAM, item.admin_status)
    ? MENTORSHIP_ADMIN_PROGRAM_STATUS_BY_UPSTREAM[item.admin_status]
    : undefined;

  return {
    program: {
      id: item.id,
      slug: item.slug || item.id,
      name: item.name,
      projectName: item.project_name ?? '',
      status: status ?? 'pending-review',
      stats: item.stats,
      ...(item.logo_url ? { logoUrl: item.logo_url } : {}),
      logoMissing: (MENTORSHIP_PROGRAM_LOGO_HINT_STATUSES as readonly string[]).includes(item.status) && !item.logo_url,
      createdOn: item.created_on,
      updatedOn: item.updated_on,
    },
    unknownStatus: status === undefined,
  };
};

/** The UTC calendar day (`YYYY-MM-DD`) of an upstream timestamp, or `undefined` when it is missing or not a date. */
const toUtcDay = (value: string | undefined): string | undefined => {
  const time = toTime(value);
  return time === undefined ? undefined : new Date(time).toISOString().slice(0, 10);
};

/** An upstream timestamp in ms, or `undefined` when it is missing or not a date. */
const toTime = (value: string | undefined): number | undefined => {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) ? undefined : time;
};

/**
 * A published program's status from its terms, by the rule upstream's `admin_status` uses (lfx-mentorship
 * `sqlPublishedProgramTermStatus`). Deleted terms are ignored and the first match wins:
 * - `completed`: a closed term and no open one
 * - `accepting`: an open term whose application window holds today, by UTC calendar day with both days included
 * - `in-progress`: an open term whose start and end hold now
 * - `upcoming`: an open term with an application end whose application start is after today, or no open term at all
 * - `in-progress`: any other open term
 */
export const mentorshipPublishedProgramStatus = (terms: readonly MentorshipProgramTermDates[], now: Date): MentorshipMentorProgramStatus => {
  const open = terms.filter((term) => term.status === 'open');
  if (open.length === 0) {
    return terms.some((term) => term.status === 'closed') ? 'completed' : 'upcoming';
  }

  const today = now.toISOString().slice(0, 10);
  const nowMs = now.getTime();
  const accepting = open.some((term) => {
    const start = toUtcDay(term.application_start_date);
    const end = toUtcDay(term.application_end_date);
    return start !== undefined && end !== undefined && start <= today && today <= end;
  });
  if (accepting) return 'accepting';

  const running = open.some((term) => {
    const start = toTime(term.start_date_time);
    const end = toTime(term.end_date_time);
    return start !== undefined && end !== undefined && start <= nowMs && nowMs <= end;
  });
  if (running) return 'in-progress';

  const comingSoon = open.some((term) => {
    const start = toUtcDay(term.application_start_date);
    return !!term.application_end_date && start !== undefined && start > today;
  });
  return comingSoon ? 'upcoming' : 'in-progress';
};

/** A published program's status from the management summary alone, for a page whose terms read failed. */
const publishedStatusFromSummary = (
  summary?: Pick<MentorshipUpstreamProgramManagementSummary, 'has_open_term' | 'has_closed_term'>
): MentorshipProgramStatus => {
  if (summary && !summary.has_open_term) {
    return summary.has_closed_term ? 'completed' : 'upcoming';
  }
  return 'in-progress';
};

/**
 * Builds the page header from the upstream program header. The header route has no `admin_status`, so the status is
 * grouped here the way upstream groups it: a program that is not published reads from its own status, and a published
 * one reads from its terms (`mentorshipPublishedProgramStatus`). When the terms could not be read, the management
 * summary settles `completed` (only closed terms) and `upcoming` (no terms), and anything else reads `in-progress`.
 * A status this does not know reads as `pending-review` with `unknownStatus` set, so the caller can log it.
 */
export const mapMentorshipAdminHeaderProgram = (
  header: MentorshipUpstreamProgramHeader,
  summary?: Pick<MentorshipUpstreamProgramManagementSummary, 'has_open_term' | 'has_closed_term'>,
  terms?: readonly MentorshipProgramTermDates[],
  now: Date = new Date()
): { program: MentorshipProgram; unknownStatus: boolean } => {
  const { program: item } = header;
  let status: MentorshipProgramStatus | undefined;
  if (item.status === 'published') {
    status = terms ? mentorshipPublishedProgramStatus(terms, now) : publishedStatusFromSummary(summary);
  } else if (Object.hasOwn(MENTORSHIP_ADMIN_UNPUBLISHED_PROGRAM_STATUS, item.status)) {
    status = MENTORSHIP_ADMIN_UNPUBLISHED_PROGRAM_STATUS[item.status];
  }

  return {
    program: {
      id: item.id,
      slug: item.slug || item.id,
      name: item.name,
      projectName: item.project_name ?? '',
      status: status ?? 'pending-review',
      stats: header.stats,
      ...(item.logo_url ? { logoUrl: item.logo_url } : {}),
      createdOn: item.created_on,
      updatedOn: item.updated_on,
    },
    unknownStatus: status === undefined,
  };
};

/**
 * Builds one Mentors tab row from an upstream member-management row. A status this does not know reads as `pending`
 * with `unknownStatus` set, so the caller can log it. The name falls back to the username, then the email, then empty.
 */
export const mapMentorshipAdminMentorRow = (row: MentorshipUpstreamMemberManagementRow): { mentor: MentorshipProgramMentor; unknownStatus: boolean } => {
  const status =
    row.status !== undefined && Object.hasOwn(MENTORSHIP_ADMIN_MENTOR_STATUS_MAP, row.status) ? MENTORSHIP_ADMIN_MENTOR_STATUS_MAP[row.status] : undefined;
  const invitedOn = toIsoDate(row.created_on);

  return {
    mentor: {
      id: row.id,
      name: row.name || row.username || row.email || '',
      email: row.email ?? '',
      ...(row.avatar_url ? { avatarUrl: row.avatar_url } : {}),
      // Keys the mentor's public page, so only a UUID is kept.
      ...(isUuid(row.user_id) ? { userId: row.user_id } : {}),
      status: status ?? 'pending',
      ...(invitedOn ? { invitedOn } : {}),
      profileCreated: row.profile_created,
    },
    unknownStatus: status === undefined,
  };
};

/**
 * Builds one Terms tab row from an upstream term-management row, or `null` for a term that is neither open nor closed
 * (upstream leaves deleted terms out, so this only guards a status it does not know). Dates read as `YYYY-MM-DD`, empty when absent.
 */
export const mapMentorshipAdminTermRow = (row: MentorshipUpstreamTermManagementRow): MentorshipProgramTermRow | null => {
  if (row.status !== 'open' && row.status !== 'closed') {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    status: row.status,
    pending: row.pending,
    declined: row.declined,
    accepted: row.accepted,
    graduated: row.graduated,
    startDate: toIsoDate(row.start_date_time) ?? '',
    endDate: toIsoDate(row.end_date_time) ?? '',
    applicationStartDate: toIsoDate(row.application_start_date) ?? '',
    applicationEndDate: toIsoDate(row.application_end_date) ?? '',
  };
};
