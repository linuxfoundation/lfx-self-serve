// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  MentorshipMenteeStatus,
  MentorshipMentorStatus,
  MentorshipProgram,
  MentorshipProgramsResponse,
  MentorshipProgramStatus,
  MentorshipTermRowStatus,
} from '../interfaces/mentorship.interface';

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
 * Admin program-list page size. Passed as `limit` on `GET /api/mentorship/programs`.
 * Sized below `MOCK_MENTORSHIP_PROGRAMS.length` so Load more is exercisable against the mock BFF.
 */
export const MENTORSHIP_PROGRAM_PAGE_SIZE = 2;

/** Underline tabs on `/mentorship/admin/:programId`. Order matches the admin screenshot. */
export const MENTORSHIP_PROGRAM_DETAIL_TABS = [
  { value: 'mentees', label: 'Current Mentees' },
  { value: 'applicants', label: 'Applicants' },
  { value: 'mentors', label: 'Mentors' },
  { value: 'terms', label: 'Terms' },
] as const;

/**
 * Mentor lifecycle statuses on the admin Mentors tab. Ordered by lifecycle so
 * `.sort` on this array yields the filter-dropdown order.
 */
export const MENTORSHIP_MENTOR_STATUSES = ['pending', 'accepted', 'declined', 'withdrawn'] as const;

/**
 * Mentee lifecycle statuses on the admin Current Mentees / Applicants tabs.
 * Superset of mentor statuses; mentees additionally reach `graduated`.
 */
export const MENTORSHIP_MENTEE_STATUSES = ['pending', 'accepted', 'declined', 'withdrawn', 'graduated'] as const;

export const MENTORSHIP_MENTOR_STATUS_LABELS: Record<MentorshipMentorStatus, string> = {
  pending: 'Invited',
  accepted: 'Accepted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
};

export const MENTORSHIP_MENTEE_STATUS_LABELS: Record<MentorshipMenteeStatus, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  graduated: 'Graduated',
};

export const MENTORSHIP_MENTOR_STATUS_BADGE_CLASSES: Record<MentorshipMentorStatus, string> = {
  pending: 'bg-amber-50 text-amber-700',
  accepted: 'bg-emerald-50 text-emerald-700',
  declined: 'bg-red-50 text-red-600',
  withdrawn: 'bg-slate-100 text-slate-600',
};

export const MENTORSHIP_MENTEE_STATUS_BADGE_CLASSES: Record<MentorshipMenteeStatus, string> = {
  pending: 'bg-amber-50 text-amber-700',
  accepted: 'bg-emerald-50 text-emerald-700',
  declined: 'bg-red-50 text-red-600',
  withdrawn: 'bg-slate-100 text-slate-600',
  graduated: 'bg-teal-50 text-teal-700',
};

export const MENTORSHIP_TERM_ROW_STATUSES = ['open', 'closed'] as const;

export const MENTORSHIP_TERM_ROW_STATUS_LABELS: Record<MentorshipTermRowStatus, string> = {
  open: 'Open',
  closed: 'Closed',
};

export const MENTORSHIP_TERM_ROW_STATUS_BADGE_CLASSES: Record<MentorshipTermRowStatus, string> = {
  open: 'bg-emerald-50 text-emerald-700',
  closed: 'bg-gray-100 text-gray-600',
};

export const MENTORSHIP_PROGRAM_DETAIL_COMING_SOON = 'This action is not available yet.';

export const MENTORSHIP_TERM_SHOULD_CLOSE_WARNING = 'This term should be closed because it has ended. Please close it to prevent new applications.';
export const MENTORSHIP_TERM_CANNOT_CLOSE_MESSAGE =
  'This term cannot be closed until all accepted applicants are either graduated or declined. Please ensure there are zero accepted applicants before closing the term.';
export const MENTORSHIP_TERM_CLOSE_CONFIRM = 'Closing this term will automatically decline all pending applications. Continue?';
export const MENTORSHIP_TERM_REOPEN_CONFIRM = 'Are you sure you want to re-open this term?';

/**
 * Builds a project icon URL from a Linux Foundation artwork repo (`cncf`, `lfai`,
 * `lf-energy`), which all publish icons at the same
 * `projects/<dir>/icon/color/<name>-icon-color.svg` path. `name` defaults to `dir`
 * because a few projects break the convention — `open-policy-agent` ships
 * `opa-icon-color.svg`.
 *
 * Only feeds the mocks below; removed with them once the upstream mentorship
 * service returns real logo URLs.
 */
export function mentorshipArtworkIconUrl(org: string, dir: string, name: string = dir): string {
  return `https://raw.githubusercontent.com/${org}/artwork/main/projects/${dir}/icon/color/${name}-icon-color.svg`;
}

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
    stats: { mentors: 4, mentees: 2, graduated: 6 },
    logoUrl: mentorshipArtworkIconUrl('lf-energy', 'grid-exchange-fabric'),
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
    logoUrl: mentorshipArtworkIconUrl('cncf', 'apicurio-registry'),
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
    logoUrl: mentorshipArtworkIconUrl('lfai', 'janusgraph'),
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
    logoUrl: mentorshipArtworkIconUrl('cncf', 'thanos'),
    createdOn: '2026-03-01T00:00:00.000Z',
    updatedOn: '2026-07-30T00:00:00.000Z',
  },
];
