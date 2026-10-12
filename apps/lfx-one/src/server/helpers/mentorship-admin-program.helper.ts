// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MENTORSHIP_PROGRAM_LOGO_HINT_STATUSES } from '@lfx-one/shared/constants';
import {
  MentorshipProgram,
  MentorshipProgramMentor,
  MentorshipProgramStatus,
  MentorshipProgramTermRow,
  MentorshipUpstreamAdministeredProgram,
  MentorshipUpstreamMemberManagementRow,
  MentorshipUpstreamProgramHeader,
  MentorshipUpstreamProgramManagementSummary,
  MentorshipUpstreamTermManagementRow,
} from '@lfx-one/shared/interfaces';

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

/**
 * Builds the page header from the upstream program header. The header route has no `admin_status`, so the status is
 * grouped here the way upstream groups it: a program that is not published reads from its own status, and a published
 * one is `completed` when it has only closed terms, else `open`. Without the management summary a published program
 * reads `open`. A status this does not know reads as `pending-review` with `unknownStatus` set, so the caller can log it.
 */
export const mapMentorshipAdminHeaderProgram = (
  header: MentorshipUpstreamProgramHeader,
  summary?: Pick<MentorshipUpstreamProgramManagementSummary, 'has_open_term' | 'has_closed_term'>
): { program: MentorshipProgram; unknownStatus: boolean } => {
  const { program: item } = header;
  let status: MentorshipProgramStatus | undefined;
  if (item.status === 'published') {
    status = summary?.has_closed_term && !summary.has_open_term ? 'completed' : 'open';
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
