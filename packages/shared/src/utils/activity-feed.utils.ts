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
import type { ActivityFeedItem, BuildActivityFeedInput } from '../interfaces';
import { normalizePollStatus } from './poll.utils';
import { getSurveyDisplayStatus } from './survey.utils';

/** Per-source cap before merging, so one noisy source can't crowd out the rest. */
const PER_SOURCE_LIMIT = 5;
/** Final row count returned after the merge-sort. */
const FEED_LIMIT = 8;

/**
 * Parse an ISO timestamp to epoch ms for sorting, treating an absent/unparseable value as the
 * oldest possible. A plain `localeCompare` on the raw strings only sorts correctly when every
 * source emits the identical format/offset — this feed merges four sources across two upstream
 * services (query-service, committee-service), so a `+05:30`-offset or non-`Z` variant from any
 * one of them would otherwise sort into the wrong position relative to the others.
 */
function timestampValue(timestamp: string): number {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? -Infinity : parsed;
}

/**
 * True for a URL safe to open directly in a new tab — http(s) only, matching the same guard
 * `DocumentsTableComponent.openDocument` applies before its own `window.open` call.
 */
function isSafeExternalUrl(url: string | undefined): url is string {
  if (!url) {
    return false;
  }
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * Group Overview "Recent Activity" stop-gap: merges the latest items across past meetings, votes,
 * surveys, and documents into one time-ordered list. Upcoming meetings are intentionally excluded
 * — they're future-dated, already covered by the "Next Meeting" card, and would otherwise dominate
 * a feed labelled "Recent Activity". Replaced by the real activity stream in LFXV2-1707.
 */
export function buildActivityFeed(input: BuildActivityFeedInput): ActivityFeedItem[] {
  const pastMeetingItems: ActivityFeedItem[] = [...input.pastMeetings]
    .sort((a, b) => timestampValue(b.start_time ?? '') - timestampValue(a.start_time ?? ''))
    .slice(0, PER_SOURCE_LIMIT)
    .map((m) => ({
      type: 'past_meeting',
      key: `past_meeting-${m.meeting_and_occurrence_id ?? m.id}`,
      label: `Meeting held: ${m.title}`,
      timestamp: m.start_time ?? '',
      icon: 'fa-light fa-clock-rotate-left',
      // Route param is the ITX-native PastMeeting.id, not meeting_and_occurrence_id — the detail
      // page fetches via /itx/past_meetings/{id}, which doesn't understand the composite
      // occurrence id used elsewhere for query-service-indexed sub-resource fetches.
      action: { kind: 'route', path: `/meetings/${m.id}/details` },
    }));

  const voteItems: ActivityFeedItem[] = input.votingEnabled
    ? [...input.votes]
        .sort((a, b) => timestampValue(b.last_modified_time ?? b.creation_time ?? '') - timestampValue(a.last_modified_time ?? a.creation_time ?? ''))
        .slice(0, PER_SOURCE_LIMIT)
        .map((v) => {
          const statusKey = normalizePollStatus(v.status);
          return {
            type: 'vote' as const,
            key: `vote-${v.uid}`,
            label: `Vote ${statusKey ? POLL_STATUS_LABELS[statusKey] : v.status || 'Updated'}: ${v.name}`,
            timestamp: v.last_modified_time ?? v.creation_time ?? '',
            icon: 'fa-light fa-check-to-slot',
            action: { kind: 'vote-drawer', voteUid: v.uid },
          };
        })
    : [];

  const surveyItems: ActivityFeedItem[] = [...input.surveys]
    .sort((a, b) => timestampValue(b.last_modified_at ?? b.created_at ?? '') - timestampValue(a.last_modified_at ?? a.created_at ?? ''))
    .slice(0, PER_SOURCE_LIMIT)
    .map((s) => {
      const displayStatus = getSurveyDisplayStatus(s);
      return {
        type: 'survey' as const,
        key: `survey-${s.uid}`,
        label: `Survey ${SURVEY_STATUS_LABELS[displayStatus] ?? displayStatus}: ${s.survey_title}`,
        timestamp: s.last_modified_at ?? s.created_at ?? '',
        icon: 'fa-light fa-chart-simple',
        action: { kind: 'survey-drawer', surveyUid: s.uid },
      };
    });

  // CommitteeDocument.type is 'file' | 'link' | 'folder' — differentiate icon/label so a folder
  // or link doesn't misrepresent itself as a file in the feed.
  const documentItems: ActivityFeedItem[] = [...input.documents]
    .sort((a, b) => timestampValue(b.updated_at ?? b.created_at ?? '') - timestampValue(a.updated_at ?? a.created_at ?? ''))
    .slice(0, PER_SOURCE_LIMIT)
    .map((d) => ({
      type: 'document' as const,
      key: `document-${d.uid}`,
      label: `${COMMITTEE_DOCUMENT_TYPE_LABELS[d.type] ?? COMMITTEE_DOCUMENT_TYPE_LABELS.file}: ${d.name}`,
      timestamp: d.updated_at ?? d.created_at ?? '',
      icon: COMMITTEE_DOCUMENT_TYPE_ICONS[d.type] ?? COMMITTEE_DOCUMENT_TYPE_ICONS.file,
      // Only 'link' documents open directly — the Documents tab treats 'file' as a download
      // (via a committee-scoped proxy URL, not doc.url) rather than an "open", and 'folder' has
      // no standalone target outside the Documents tab's own drill-down state.
      action: d.type === 'link' && isSafeExternalUrl(d.url) ? { kind: 'external-url', url: d.url } : { kind: 'tab', tab: 'documents' },
    }));

  return [...pastMeetingItems, ...voteItems, ...surveyItems, ...documentItems]
    .sort((a, b) => timestampValue(b.timestamp) - timestampValue(a.timestamp))
    .slice(0, FEED_LIMIT);
}
