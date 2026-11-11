// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { getDocumentSourceLink } from './document-source-link.utils';

describe('getDocumentSourceLink', () => {
  const named = { groupOrMeetingName: 'Technical Steering Committee', groupOrMeetingUid: 'group-1' };

  it('opens the group for a group document', () => {
    expect(getDocumentSourceLink(named)).toEqual({ kind: 'group', commands: ['/groups', 'group-1'] });
  });

  it('opens the meeting for an upcoming meeting document', () => {
    expect(getDocumentSourceLink({ ...named, groupOrMeetingUid: 'meeting-9', meetingId: 'meeting-9' })).toEqual({
      kind: 'meeting',
      commands: ['/meetings', 'meeting-9'],
    });
  });

  it('opens the past meeting details for a past meeting document', () => {
    expect(getDocumentSourceLink({ ...named, groupOrMeetingUid: 'occ-3', pastMeetingId: 'occ-3' })).toEqual({
      kind: 'past_meeting',
      commands: ['/meetings', 'occ-3', 'details'],
    });
  });

  it('opens the mailing list by its uid, not the group the list is linked to', () => {
    expect(getDocumentSourceLink({ ...named, mailingListUid: 'list-7' })).toEqual({ kind: 'mailing_list', commands: ['/mailing-lists', 'list-7'] });
  });

  it('has no link when the row has no name, such as a mailing list document whose list could not be resolved', () => {
    expect(getDocumentSourceLink({ groupOrMeetingName: '', groupOrMeetingUid: 'group-1' })).toBeNull();
  });

  it('has no link when the row has a name but nothing to open', () => {
    expect(getDocumentSourceLink({ groupOrMeetingName: 'Orphan', groupOrMeetingUid: '' })).toBeNull();
  });

  it('does not link a group back to its own page', () => {
    expect(getDocumentSourceLink(named, 'group-1')).toBeNull();
    expect(getDocumentSourceLink(named, 'group-2')).not.toBeNull();
  });

  it('still links a meeting or mailing list on a group page', () => {
    expect(getDocumentSourceLink({ ...named, meetingId: 'meeting-9' }, 'group-1')).not.toBeNull();
    expect(getDocumentSourceLink({ ...named, mailingListUid: 'list-7' }, 'group-1')).not.toBeNull();
  });
});
