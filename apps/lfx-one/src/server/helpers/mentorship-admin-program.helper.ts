// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MentorshipProgram, MentorshipUpstreamAdministeredProgram } from '@lfx-one/shared/interfaces';

import { MENTORSHIP_ADMIN_PROGRAM_STATUS_BY_UPSTREAM } from '../constants';

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
