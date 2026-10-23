// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  AttachmentScope,
  AttachmentScopeOverrides,
  Meeting,
  MeetingAttachment,
  MeetingAttachmentChanges,
  MeetingOccurrence,
  OccurrenceScopedAttachment,
} from '../interfaces';
import { isMeetingOccurrenceCancelled, isOccurrencePast } from './meeting.utils';
import { isSameOccurrenceId } from './rsvp-calculator.util';

/**
 * Which occurrences an attachment applies to.
 * @description An attachment with no `occurrence_id` applies to every occurrence of the meeting.
 */
export function getAttachmentScope(attachment: OccurrenceScopedAttachment): AttachmentScope {
  return attachment.occurrence_id ? 'occurrence' : 'series';
}

/**
 * The attachments a given occurrence shows: the series-wide ones plus the ones scoped to it.
 * @description With no occurrence (a non-recurring meeting, or a recurring one with nothing upcoming) only
 * series-wide attachments qualify, so another date's materials can never leak onto a card that has no date.
 * Occurrence IDs are compared as instants because the same occurrence is a unix-seconds string in one place
 * and a millisecond one in another.
 */
export function filterAttachmentsForOccurrence<T extends OccurrenceScopedAttachment>(attachments: T[], occurrenceId: string | null | undefined): T[] {
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

/** Shows each overridden attachment with its saved scope instead of the one the read returned. */
export function applyAttachmentScopeOverrides<T extends { uid: string; occurrence_id?: string }>(attachments: T[], overrides: AttachmentScopeOverrides): T[] {
  if (overrides.size === 0) return attachments;
  return attachments.map((attachment) => {
    const override = overrides.get(attachment.uid);
    return override === undefined ? attachment : { ...attachment, occurrence_id: override || undefined };
  });
}

/**
 * Shows a read's attachments with this session's additions and deletions applied.
 * @description An added attachment the read already returns is left as the read has it, and a deleted one is dropped even
 * if the read still returns it. Additions go first so the newest shows at the top, matching what a refetch returns.
 */
export function applyMeetingAttachmentChanges(attachments: MeetingAttachment[], changes: MeetingAttachmentChanges | undefined): MeetingAttachment[] {
  if (!changes || (changes.added.length === 0 && changes.deletedUids.size === 0)) return attachments;
  const fetchedUids = new Set(attachments.map((attachment) => attachment.uid));
  const pending = changes.added.filter((attachment) => !fetchedUids.has(attachment.uid) && !changes.deletedUids.has(attachment.uid)).reverse();
  return [...pending, ...attachments.filter((attachment) => !changes.deletedUids.has(attachment.uid))];
}
