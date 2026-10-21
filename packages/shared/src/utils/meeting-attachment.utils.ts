// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AttachmentScope, Meeting, MeetingOccurrence } from '../interfaces';
import { isMeetingOccurrenceCancelled, isOccurrencePast } from './meeting.utils';
import { isSameOccurrenceId } from './rsvp-calculator.util';

/** Minimal attachment shape the scope helpers need, so they serve both meeting and past meeting attachments. */
interface ScopedAttachment {
  occurrence_id?: string;
}

/**
 * Which occurrences an attachment applies to.
 * @description An attachment with no `occurrence_id` applies to every occurrence of the meeting.
 */
export function getAttachmentScope(attachment: ScopedAttachment): AttachmentScope {
  return attachment.occurrence_id ? 'occurrence' : 'series';
}

/**
 * The attachments a given occurrence shows: the series-wide ones plus the ones scoped to it.
 * @description With no occurrence (a non-recurring meeting, or a recurring one with nothing upcoming) only
 * series-wide attachments qualify, so another date's materials can never leak onto a card that has no date.
 * Occurrence IDs are compared as instants because the same occurrence is a unix-seconds string in one place
 * and a millisecond one in another.
 */
export function filterAttachmentsForOccurrence<T extends ScopedAttachment>(attachments: T[], occurrenceId: string | null | undefined): T[] {
  return attachments.filter((attachment) => !attachment.occurrence_id || isSameOccurrenceId(attachment.occurrence_id, occurrenceId));
}

/**
 * Whether an attachment can be scoped to this occurrence.
 * @description The service accepts `occurrence_id` only for an upcoming, non-cancelled occurrence of a
 * recurring meeting, so the scope controls are offered under exactly those conditions.
 */
export function canScopeAttachmentToOccurrence(
  meeting: Pick<Meeting, 'recurrence' | 'cancelled_occurrences'>,
  occurrence: MeetingOccurrence | null | undefined
): boolean {
  if (!meeting.recurrence || !occurrence?.occurrence_id) {
    return false;
  }
  return !isMeetingOccurrenceCancelled(occurrence, meeting.cancelled_occurrences) && !isOccurrencePast(occurrence.start_time, occurrence.duration);
}
