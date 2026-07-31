// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ActivityEventType } from '../interfaces/activity-event.interface';

/**
 * Event types the committee activity feed can actually emit today, derived purely from existing
 * aggregation sources (past meetings, votes, surveys, documents) — see
 * `apps/lfx-one/src/server/services/committee-activity.service.ts`.
 */
export const ACTIVITY_EVENT_TYPES_V1_EMITTED: readonly ActivityEventType[] = [
  'meeting_held',
  'vote_opened',
  'vote_closed',
  'survey_published',
  'survey_closed',
  'document_uploaded',
];

/**
 * Event types with no upstream source yet: no document-delete tombstone (hard delete, unindexed),
 * no committee-membership history tracking, no notes feature. Pending a real event log.
 */
export const ACTIVITY_EVENT_TYPES_DEFERRED: readonly ActivityEventType[] = ['document_deleted', 'member_joined', 'member_left', 'notes_added'];

/** Default row count for `GET /api/committees/:uid/activity` — matches the old client-side FEED_LIMIT. */
export const ACTIVITY_FEED_DEFAULT_LIMIT = 8;

/** Upper bound on the `limit` query param, rejected (400) if exceeded. */
export const ACTIVITY_FEED_MAX_LIMIT = 50;
