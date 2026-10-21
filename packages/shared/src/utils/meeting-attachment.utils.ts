// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AttachmentScope, Meeting, MeetingOccurrence, OccurrenceScopedAttachment } from '../interfaces';
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

/**
 * Scope changes that were saved but may not be readable yet, keyed by attachment uid.
 * @description The value is the occurrence the attachment is now scoped to, or '' for all occurrences. Reads come from
 * the query service, which indexes asynchronously, so a read right after a save can still return the old scope.
 */
export type AttachmentScopeOverrides = ReadonlyMap<string, string>;

/** Shows each overridden attachment with its saved scope instead of the one the read returned. */
export function applyAttachmentScopeOverrides<T extends { uid: string; occurrence_id?: string }>(attachments: T[], overrides: AttachmentScopeOverrides): T[] {
  if (overrides.size === 0) return attachments;
  return attachments.map((attachment) => {
    const override = overrides.get(attachment.uid);
    return override === undefined ? attachment : { ...attachment, occurrence_id: override || undefined };
  });
}

/** The uids whose read already shows the saved scope, so their overrides have done their job and can be dropped. */
export function settledAttachmentScopeOverrides(attachments: { uid: string; occurrence_id?: string }[], overrides: AttachmentScopeOverrides): string[] {
  return attachments
    .filter((attachment) => {
      const override = overrides.get(attachment.uid);
      if (override === undefined) return false;
      return override === '' ? !attachment.occurrence_id : isSameOccurrenceId(attachment.occurrence_id, override);
    })
    .map((attachment) => attachment.uid);
}
