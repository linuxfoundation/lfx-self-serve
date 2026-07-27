// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Specific-file imports (not the '../constants' barrel): that barrel re-exports
// dashboard-metrics.constants.ts, which imports '../utils' (the utils barrel, this file's own
// barrel) — a real runtime import cycle that also drags in meeting.utils.ts's
// `HttpParams` from '@angular/common/http', which Vitest can't resolve outside an Angular
// context. Importing the two constant files directly avoids the cycle.
import { COMMITTEE_DOCUMENT_TYPE_ICONS, COMMITTEE_DOCUMENT_TYPE_LABELS } from '../constants/committee-documents.constants';
import { POLL_STATUS_LABELS } from '../constants/poll.constants';
import { SURVEY_STATUS_LABELS } from '../constants/survey.constants';
import { ActivityFeedItem, CommitteeDocument, PastMeeting, Survey, Vote } from '../interfaces';
import { getSurveyDisplayStatus } from './survey.utils';

/** Per-source cap before merging, so one noisy source can't crowd out the rest. */
const PER_SOURCE_LIMIT = 5;
/** Final row count returned after the merge-sort. */
const FEED_LIMIT = 8;

export interface BuildActivityFeedInput {
  pastMeetings: PastMeeting[];
  votes: Vote[];
  surveys: Survey[];
  documents: CommitteeDocument[];
  /**
   * Vote items are excluded entirely when false. The Votes tab is only shown/reachable when the
   * committee has voting enabled (committee-view.component.ts isVotesTabVisible), but
   * handleTabNavigation doesn't check tab visibility — only the static valid-tabs list — so an
   * activity row for a vote from before voting was disabled would otherwise navigate to a hidden,
   * blank tab.
   */
  votingEnabled: boolean;
}

/**
 * Group Overview "Recent Activity" stop-gap: merges the latest items across past meetings, votes,
 * surveys, and documents into one time-ordered list. Upcoming meetings are intentionally excluded
 * — they're future-dated, already covered by the "Next Meeting" card, and would otherwise dominate
 * a feed labelled "Recent Activity". Replaced by the real activity stream in LFXV2-1707.
 */
export function buildActivityFeed(input: BuildActivityFeedInput): ActivityFeedItem[] {
  const pastMeetingItems: ActivityFeedItem[] = [...input.pastMeetings]
    .sort((a, b) => (b.start_time ?? '').localeCompare(a.start_time ?? ''))
    .slice(0, PER_SOURCE_LIMIT)
    .map((m) => ({
      type: 'past_meeting',
      key: `past_meeting-${m.meeting_and_occurrence_id ?? m.id}`,
      label: `Meeting held: ${m.title}`,
      timestamp: m.start_time ?? '',
      icon: 'fa-light fa-clock-rotate-left',
      tab: 'meetings:past',
    }));

  // Upstream Vote schema (lfx-v2-voting-service openapi3.yaml) marks `status` required with a
  // fixed lowercase enum (disabled/active/ended) — no case normalization needed here.
  const voteItems: ActivityFeedItem[] = input.votingEnabled
    ? [...input.votes]
        .sort((a, b) => (b.last_modified_time ?? b.creation_time ?? '').localeCompare(a.last_modified_time ?? a.creation_time ?? ''))
        .slice(0, PER_SOURCE_LIMIT)
        .map((v) => ({
          type: 'vote' as const,
          key: `vote-${v.uid}`,
          label: `Vote ${POLL_STATUS_LABELS[v.status]}: ${v.name}`,
          timestamp: v.last_modified_time ?? v.creation_time ?? '',
          icon: 'fa-light fa-check-to-slot',
          tab: 'votes',
        }))
    : [];

  const surveyItems: ActivityFeedItem[] = [...input.surveys]
    .sort((a, b) => (b.last_modified_at ?? b.created_at ?? '').localeCompare(a.last_modified_at ?? a.created_at ?? ''))
    .slice(0, PER_SOURCE_LIMIT)
    .map((s) => {
      const displayStatus = getSurveyDisplayStatus(s);
      return {
        type: 'survey' as const,
        key: `survey-${s.uid}`,
        label: `Survey ${SURVEY_STATUS_LABELS[displayStatus] ?? displayStatus}: ${s.survey_title}`,
        timestamp: s.last_modified_at ?? s.created_at ?? '',
        icon: 'fa-light fa-chart-simple',
        tab: 'surveys',
      };
    });

  // CommitteeDocument.type is 'file' | 'link' | 'folder' — differentiate icon/label so a folder
  // or link doesn't misrepresent itself as a file in the feed.
  const documentItems: ActivityFeedItem[] = [...input.documents]
    .sort((a, b) => (b.updated_at ?? b.created_at ?? '').localeCompare(a.updated_at ?? a.created_at ?? ''))
    .slice(0, PER_SOURCE_LIMIT)
    .map((d) => ({
      type: 'document' as const,
      key: `document-${d.uid}`,
      label: `${COMMITTEE_DOCUMENT_TYPE_LABELS[d.type]}: ${d.name}`,
      timestamp: d.updated_at ?? d.created_at ?? '',
      icon: COMMITTEE_DOCUMENT_TYPE_ICONS[d.type],
      tab: 'documents',
    }));

  return [...pastMeetingItems, ...voteItems, ...surveyItems, ...documentItems].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, FEED_LIMIT);
}
