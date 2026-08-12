// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Specific-file imports (not the '../constants' barrel): this file is re-exported by the utils
// barrel, so importing the constants barrel here would add a utils->constants edge — avoided
// defensively (no cycle exists today; see constants/index.spec.ts for the invariant this protects).
// The '../interfaces' import below is `import type`, so it can't introduce a runtime edge.
import { COMMITTEE_DOCUMENT_TYPE_ICONS, COMMITTEE_DOCUMENT_TYPE_LABELS } from '../constants/committee-documents.constants';
import { POLL_STATUS_LABELS } from '../constants/poll.constants';
import { SURVEY_STATUS_LABELS } from '../constants/survey.constants';
import type { ActivityEvent, ActivityFeedItem } from '../interfaces';
import { normalizePollStatus } from './poll.utils';
import { isValidUrl } from './url.utils';

/**
 * Maps one committee-activity `ActivityEvent` (the server's source-agnostic wire contract,
 * LFXV2-1707) to the Overview widget's `ActivityFeedItem` view-model (label/icon/click-action).
 * The server already sorts, caps, and paginates — this is a pure per-event presentation mapping,
 * not a merge. Ports the label/fallback/action logic the old client-side `buildActivityFeed` used
 * to apply directly to raw `Vote`/`Survey`/`PastMeeting`/`CommitteeDocument` entities, now reading
 * from `event.payload` instead so rendering stays identical across the data-source swap.
 */
function mapActivityEventToFeedItem(event: ActivityEvent): ActivityFeedItem | null {
  switch (event.type) {
    case 'meeting_held':
      return {
        type: 'past_meeting',
        // meeting_occurrence_id, not meeting_id — a recurring meeting's occurrences share one
        // meeting_id but need distinct @for tracking keys; meetingId (below) is still the
        // navigation id, matching the "Past Meeting" card's own link.
        key: `past_meeting-${event.payload.meeting_occurrence_id}`,
        label: `Meeting held: ${event.payload.title}`,
        timestamp: event.occurred_at,
        icon: 'fa-light fa-clock-rotate-left',
        action: { kind: 'past-meeting', meetingId: event.payload.meeting_id, password: event.payload.password },
      };

    case 'vote_opened':
    case 'vote_closed': {
      const { vote_uid, name, status } = event.payload;
      const statusKey = normalizePollStatus(status);
      return {
        type: 'vote',
        key: `vote-${vote_uid}`,
        label: `Vote ${statusKey ? POLL_STATUS_LABELS[statusKey] : status || 'Updated'}: ${name}`,
        timestamp: event.occurred_at,
        icon: 'fa-light fa-check-to-slot',
        action: { kind: 'vote-drawer', voteUid: vote_uid },
      };
    }

    case 'survey_published':
    case 'survey_closed': {
      const { survey_uid, title, status } = event.payload;
      return {
        type: 'survey',
        key: `survey-${survey_uid}`,
        label: `Survey ${SURVEY_STATUS_LABELS[status as keyof typeof SURVEY_STATUS_LABELS] ?? status}: ${title}`,
        timestamp: event.occurred_at,
        icon: 'fa-light fa-chart-simple',
        action: { kind: 'survey-drawer', surveyUid: survey_uid },
      };
    }

    // CommitteeDocument.type is 'file' | 'link' | 'folder' — differentiate icon/label so a folder
    // or link doesn't misrepresent itself as a file in the feed.
    case 'document_uploaded': {
      const { document_uid, name, document_type, url } = event.payload;
      return {
        type: 'document',
        // document_type in the key, not just document_uid — folders, links, and files are three
        // distinct upstream uid namespaces (matches eventKey's identical reasoning server-side in
        // committee-activity.service.ts); a folder and a file coincidentally sharing a uid would
        // otherwise collide on this @for tracking key (NG0955).
        key: `document-${document_type}-${document_uid}`,
        label: `${COMMITTEE_DOCUMENT_TYPE_LABELS[document_type] ?? COMMITTEE_DOCUMENT_TYPE_LABELS.file}: ${name}`,
        timestamp: event.occurred_at,
        icon: COMMITTEE_DOCUMENT_TYPE_ICONS[document_type] ?? COMMITTEE_DOCUMENT_TYPE_ICONS.file,
        // Only 'link' documents open directly — the Documents tab treats 'file' as a download
        // (via a committee-scoped proxy URL, not doc.url) rather than an "open", and 'folder' has
        // no standalone target outside the Documents tab's own drill-down state. isValidUrl is the
        // same shared validator used across the app for untrusted-URL sinks.
        action: document_type === 'link' && url && isValidUrl(url) ? { kind: 'external-url', url } : { kind: 'tab', tab: 'documents' },
      };
    }

    case 'notes_added': {
      const { document_uid, name, document_type, url, meeting_scope } = event.payload;
      return {
        type: 'note',
        // meeting_scope in the key, not just document_uid — v1_meeting_attachment and
        // v1_past_meeting_attachment are two distinct upstream uid namespaces, same reasoning as
        // document_uploaded's document_type-namespaced key.
        key: `note-${meeting_scope}-${document_uid}`,
        // "Note: X", not "Note added: X" — occurred_at prefers modified_at (see buildNotesEvent's
        // own comment), so an edited/renamed note re-surfaces at the top of the feed on every
        // edit, not just its original creation. A verb-free label avoids claiming "added" for
        // what might be an edit, matching document_uploaded's own verb-free label for the same
        // modified-first sort reason (its "Document: X" doesn't claim "uploaded" either).
        label: `Note: ${name}`,
        timestamp: event.occurred_at,
        icon: 'fa-light fa-note-sticky',
        // meeting_scope, not a precise deep link to the source meeting — MeetingAttachment/
        // PastMeetingAttachment carry no `password` field, so routing through 'past-meeting'
        // (which can attach one) risks silently omitting it for a password-protected meeting.
        // Routes to the Meetings tab pre-filtered to the right time window instead, the same
        // "no precise deep link, route to the containing tab" compromise document_uploaded
        // already makes for file/folder rows. 'meetings:upcoming'/'meetings:past' is an
        // already-live composite tab-context format (committee-view.component.ts's
        // handleTabNavigation). document_type === 'link' guard mirrors document_uploaded's own
        // condition — a file-type note never opens a raw url directly, even if one is ever set.
        action: document_type === 'link' && url && isValidUrl(url) ? { kind: 'external-url', url } : { kind: 'tab', tab: `meetings:${meeting_scope}` },
      };
    }

    // Deferred types (document_deleted, member_joined, member_left) — never emitted by the
    // server in v1; guarded defensively rather than assumed unreachable.
    default:
      return null;
  }
}

/**
 * Maps a committee's server-fed `ActivityEvent[]` to `ActivityFeedItem[]` for the Overview
 * "Recent Activity" widget. `votingEnabled` mirrors the old stop-gap's behavior: vote events are
 * excluded entirely (not just hidden) when the committee has voting disabled, matching the Votes
 * tab itself being hidden in that state. Applied at BOTH layers, not just here: the server
 * (`CommitteeActivityService.getCommitteeActivity`) already excludes vote events from the response
 * when `committee.enable_voting` is false, so this filter is defense-in-depth against a client
 * that has a stale/different view of `committee()` than what the server resolved — not the sole gate.
 */
export function mapActivityEventsToFeedItems(events: ActivityEvent[], opts: { votingEnabled: boolean }): ActivityFeedItem[] {
  return events
    .filter((event) => opts.votingEnabled || (event.type !== 'vote_opened' && event.type !== 'vote_closed'))
    .map(mapActivityEventToFeedItem)
    .filter((item): item is ActivityFeedItem => item !== null);
}
