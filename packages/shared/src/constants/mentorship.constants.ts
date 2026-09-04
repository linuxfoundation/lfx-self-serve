// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MentorshipProgram, MentorshipProgramsResponse, MentorshipProgramStatus } from '../interfaces/mentorship.interface';

/**
 * Allowed program statuses. Ordered by lifecycle so a `.sort` on this array
 * yields the same order the admin filter dropdown renders.
 */
export const MENTORSHIP_PROGRAM_STATUSES = ['open', 'pending-review', 'completed'] as const;

/** Human-readable labels for each program status (used by badge + filter). */
export const MENTORSHIP_PROGRAM_STATUS_LABELS: Record<MentorshipProgramStatus, string> = {
  open: 'Open',
  'pending-review': 'Pending Review',
  completed: 'Completed',
};

/**
 * Tailwind classes for the program-status badge on the admin card.
 * Keep the shape identical to `CROWDFUNDING`'s per-status badge classes so a
 * future shared status-pill component can consume both maps unchanged.
 */
export const MENTORSHIP_PROGRAM_STATUS_BADGE_CLASSES: Record<MentorshipProgramStatus, string> = {
  open: 'bg-emerald-50 text-emerald-700',
  'pending-review': 'bg-amber-50 text-amber-700',
  completed: 'bg-gray-100 text-gray-600',
};

/** Deterministic avatar-tile palette cycled by (title.charCodeAt(0) % length). */
export const MENTORSHIP_PROGRAM_AVATAR_PALETTE: string[] = [
  'rounded-xl bg-blue-100 !text-blue-700',
  'rounded-xl bg-violet-100 !text-violet-700',
  'rounded-xl bg-emerald-100 !text-emerald-700',
  'rounded-xl bg-amber-100 !text-amber-700',
  'rounded-xl bg-rose-100 !text-rose-700',
  'rounded-xl bg-indigo-100 !text-indigo-700',
];

export const EMPTY_MENTORSHIP_PROGRAMS_RESPONSE: MentorshipProgramsResponse = {
  data: [],
  total: 0,
};

/**
 * Deterministic mock programs backing the mentorship BFF while the upstream
 * mentorship service is unavailable. Server-only import path
 * (`@lfx-one/shared/constants`) so the shape stays in one place.
 *
 * Removed once the real upstream mentorship-service endpoint is wired up in
 * `mentorship.service.ts`.
 */
export const MOCK_MENTORSHIP_PROGRAMS: MentorshipProgram[] = [
  {
    id: 'mp_gridflow_fall26',
    slug: 'gridflow-time-series-ingestion-pipeline',
    name: 'GridFlow: Time-Series Ingestion Pipeline',
    projectName: 'LF Energy',
    term: 'Fall 2026',
    status: 'open',
    stats: { mentors: 2, mentees: 3, graduated: 6 },
    createdOn: '2026-06-01T00:00:00.000Z',
    updatedOn: '2026-08-15T00:00:00.000Z',
  },
  {
    id: 'mp_apicurio_winter26',
    slug: 'apicurio-registry-prompt-template-playground',
    name: 'Apicurio Registry: Prompt Template Playground',
    projectName: 'CNCF',
    term: 'Winter 2026',
    status: 'pending-review',
    stats: { mentors: 2, mentees: 0, graduated: 0 },
    createdOn: '2026-07-10T00:00:00.000Z',
    updatedOn: '2026-08-20T00:00:00.000Z',
  },
  {
    id: 'mp_janusgraph_fall26',
    slug: 'janusgraph-adjacency-cache-instrumentation',
    name: 'JanusGraph: Adjacency Cache Instrumentation',
    projectName: 'LF AI & Data',
    term: 'Fall 2026',
    status: 'open',
    stats: { mentors: 1, mentees: 1, graduated: 2 },
    createdOn: '2026-05-15T00:00:00.000Z',
    updatedOn: '2026-08-25T00:00:00.000Z',
  },
  {
    id: 'mp_thanos_summer26',
    slug: 'thanos-fan-out-query-observability',
    name: 'Thanos: Fan-Out Query Observability',
    projectName: 'CNCF',
    term: 'Summer 2026',
    status: 'completed',
    stats: { mentors: 2, mentees: 0, graduated: 3 },
    createdOn: '2026-03-01T00:00:00.000Z',
    updatedOn: '2026-07-30T00:00:00.000Z',
  },
];
