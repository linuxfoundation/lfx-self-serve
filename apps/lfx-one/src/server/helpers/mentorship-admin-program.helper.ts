// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MentorshipProgram,
  MentorshipProgramStatus,
  MentorshipUpstreamAdministeredProgram,
  MentorshipUpstreamProgramHeader,
  MentorshipUpstreamProgramManagementSummary,
} from '@lfx-one/shared/interfaces';

import { MENTORSHIP_ADMIN_PROGRAM_STATUS_BY_UPSTREAM, MENTORSHIP_ADMIN_UNPUBLISHED_PROGRAM_STATUS } from '../constants';

/**
 * Builds one admin list row from an upstream administered program. Upstream decides the status shown (`admin_status`);
 * a value this does not know reads as `pending-review` with `unknownStatus` set, so the caller can log it.
 * The term is the row's term name, or empty. The slug falls back to the id so `/mentorship/admin/:programId` always resolves.
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
      term: item.term?.name ?? '',
      status: status ?? 'pending-review',
      stats: item.stats,
      ...(item.logo_url ? { logoUrl: item.logo_url } : {}),
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
      term: header.active_term?.name ?? '',
      status: status ?? 'pending-review',
      stats: header.stats,
      ...(item.logo_url ? { logoUrl: item.logo_url } : {}),
      createdOn: item.created_on,
      updatedOn: item.updated_on,
    },
    unknownStatus: status === undefined,
  };
};
