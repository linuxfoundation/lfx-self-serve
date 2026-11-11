// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DocumentSourceLink, MyDocumentItem } from '../interfaces/my-document.interface';

/**
 * Works out which details page a document row's group, meeting or mailing list name opens.
 * A row is identified by which id it carries: a mailing list uid, a past meeting id, a meeting id,
 * otherwise the group (committee) uid. A row with no name, or no id to open, has no link, and
 * `currentGroupUid` suppresses the link back to the group whose own Documents tab is being shown.
 */
export function getDocumentSourceLink(
  doc: Pick<MyDocumentItem, 'groupOrMeetingName' | 'groupOrMeetingUid' | 'meetingId' | 'pastMeetingId' | 'mailingListUid'>,
  currentGroupUid = ''
): DocumentSourceLink | null {
  if (!doc.groupOrMeetingName?.trim()) return null;

  const mailingListUid = doc.mailingListUid?.trim();
  if (mailingListUid) return { kind: 'mailing_list', commands: ['/mailing-lists', mailingListUid] };

  const pastMeetingId = doc.pastMeetingId?.trim();
  if (pastMeetingId) return { kind: 'past_meeting', commands: ['/meetings', pastMeetingId, 'details'] };

  const meetingId = doc.meetingId?.trim();
  if (meetingId) return { kind: 'meeting', commands: ['/meetings', meetingId] };

  const groupUid = doc.groupOrMeetingUid?.trim();
  if (!groupUid || groupUid === currentGroupUid) return null;
  return { kind: 'group', commands: ['/groups', groupUid] };
}
