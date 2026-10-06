// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MENTORSHIP_MENTEE_NOTE_MAX } from '@lfx-one/shared/constants';
import { MentorshipUpstreamApplicationNoteUpdate } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { MENTORSHIP_APPLICATIONS_PATH } from '../constants';
import { ServiceValidationError } from '../errors';
import type { MicroserviceProxyService } from '../services/microservice-proxy.service';
import { proxyMentorshipRequest } from './mentorship-api.helper';

/**
 * Reads the `{ note }` body of the mentor and admin reviewer note routes: a string, trimmed, so one blank once trimmed
 * clears the note. A non-string, or one over `MENTORSHIP_MENTEE_NOTE_MAX` characters once trimmed, is a 400.
 */
export const parseMentorshipApplicationNote = (body: unknown, operation: string): string => {
  const raw: unknown = (body as Record<string, unknown> | null | undefined)?.['note'];
  if (typeof raw !== 'string') {
    throw ServiceValidationError.forField('note', 'note must be a string', { operation });
  }
  const note = raw.trim();
  if (note.length > MENTORSHIP_MENTEE_NOTE_MAX) {
    throw ServiceValidationError.forField('note', `note must be at most ${MENTORSHIP_MENTEE_NOTE_MAX} characters`, { operation });
  }
  return note;
};

/**
 * Saves, edits or clears (an empty `note`) the one reviewer note of an application, with the caller's token. The note is
 * the application's own, so the mentor and admin routes both save it here. Upstream checks the caller mentors or
 * administers the program (403 otherwise) and answers 404 for an application that is gone; both pass through.
 */
export async function saveMentorshipApplicationNote(proxy: MicroserviceProxyService, req: Request, applicationId: string, note: string): Promise<void> {
  const body: MentorshipUpstreamApplicationNoteUpdate = { reviewer_note: note };
  await proxyMentorshipRequest<unknown>(proxy, req, `${MENTORSHIP_APPLICATIONS_PATH}/${encodeURIComponent(applicationId)}/note`, 'PUT', undefined, body);
}
