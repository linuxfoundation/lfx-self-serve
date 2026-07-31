// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Specific-file imports (not the '../constants' barrel): that barrel re-exports
// dashboard-metrics.constants.ts, which imports '../utils' (the utils barrel, this file's own
// barrel) — a real runtime import cycle that transitively pulls in Angular-only runtime code
// (e.g. meeting.utils.ts's `@angular/common/http` import), which Vitest can't resolve outside an
// Angular context. Importing the two constant files directly avoids the cycle. The '../interfaces'
// import below is `import type` for the same reason: it's erased entirely, so it can't reintroduce
// this cycle even if a future interface file adds a runtime import that reaches '../constants' or
// '../utils'.
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
        key: `past_meeting-${event.payload.meeting_id}`,
        label: `Meeting held: ${event.payload.title}`,
        timestamp: event.occurred_at,
        icon: 'fa-light fa-clock-rotate-left',
        action: { kind: 'past-meeting', meetingId: event.payload.meeting_id },
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
        key: `document-${document_uid}`,
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

    // Deferred types (document_deleted, member_joined, member_left, notes_added) — never emitted
    // by the server in v1; guarded defensively rather than assumed unreachable.
    default:
      return null;
  }
}

/**
 * Maps a committee's server-fed `ActivityEvent[]` to `ActivityFeedItem[]` for the Overview
 * "Recent Activity" widget. `votingEnabled` mirrors the old stop-gap's behavior: vote events are
 * excluded entirely (not just hidden) when the committee has voting disabled, matching the Votes
 * tab itself being hidden in that state — still a UI-only concern, so it's applied here rather
 * than by the server.
 */
export function mapActivityEventsToFeedItems(events: ActivityEvent[], opts: { votingEnabled: boolean }): ActivityFeedItem[] {
  return events
    .filter((event) => opts.votingEnabled || (event.type !== 'vote_opened' && event.type !== 'vote_closed'))
    .map(mapActivityEventToFeedItem)
    .filter((item): item is ActivityFeedItem => item !== null);
}
