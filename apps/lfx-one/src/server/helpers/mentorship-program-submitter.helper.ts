// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MentorshipProgramSubmitter, MentorshipUpstreamProgramSubmitter } from '@lfx-one/shared/interfaces';
import { normalizeToUrl } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { MENTORSHIP_PROGRAMS_PATH } from '../constants';
import { MicroserviceError } from '../errors';
import { logger } from '../services/logger.service';
import { MicroserviceProxyService } from '../services/microservice-proxy.service';

import { proxyMentorshipRequest } from './mentorship-api.helper';

/** The submitter as the pages show it: the name falls back to the LFID, and an avatar that is not an http(s) URL is dropped. */
export const mapMentorshipProgramSubmitter = (submitter: MentorshipUpstreamProgramSubmitter): MentorshipProgramSubmitter => {
  const avatar = submitter.avatar_url?.trim() ?? '';
  return {
    name: submitter.name?.trim() || submitter.lfid,
    email: submitter.email?.trim() || null,
    avatarUrl: /^https?:\/\//i.test(avatar) ? normalizeToUrl(avatar) : null,
  };
};

/**
 * Reads who submitted a program, with the caller's own token: upstream admits the program's admins and the approver
 * team. The submitter is a detail of the page, so any failure returns `null` rather than failing the page. A 404 (a
 * program with no submitter LFID) is expected and logged at debug; anything else is logged as a warning.
 */
export async function readMentorshipProgramSubmitter(
  proxy: MicroserviceProxyService,
  req: Request,
  programId: string,
  operation: string
): Promise<MentorshipProgramSubmitter | null> {
  try {
    const submitter = await proxyMentorshipRequest<MentorshipUpstreamProgramSubmitter>(
      proxy,
      req,
      `${MENTORSHIP_PROGRAMS_PATH}/${encodeURIComponent(programId)}/submitter`
    );
    return mapMentorshipProgramSubmitter(submitter);
  } catch (error) {
    const status = error instanceof MicroserviceError ? error.statusCode : undefined;
    if (status === 404) {
      logger.debug(req, operation, 'Program has no submitter; showing the page without it', { programId });
    } else {
      logger.warning(req, operation, 'Failed to read the program submitter; showing the page without it', {
        programId,
        status,
        err: error,
      });
    }
    return null;
  }
}
