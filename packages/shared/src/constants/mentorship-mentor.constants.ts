// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  MentorshipMenteeStatus,
  MentorshipMentoringHistoryEntry,
  MentorshipMentoringHistoryStatus,
  MentorshipMentorProfileResponse,
  MentorshipMentorProgram,
  MentorshipMentorProgramLists,
  MentorshipMentorProgramsResponse,
  MentorshipMentorProgramTermStatus,
  MentorshipMentorRegisterForm,
  MentorshipMentorStatus,
} from '../interfaces/mentorship.interface';
import { mentorshipArtworkIconUrl, MENTORSHIP_MENTEE_STATUS_LABELS, MENTORSHIP_MENTOR_STATUS_LABELS } from './mentorship.constants';
import { MOCK_MENTORSHIP_PROGRAM_LISTS } from './mentorship-program-detail.constants';

/**
 * Tab metadata for the mentor shell (`MentorPageComponent`). The label doubles as the
 * shell's page H1 when a tab is active, so a change here reaches both surfaces.
 */
export const MENTORSHIP_MENTOR_PAGE_TABS = [
  { value: 'programs' as const, label: 'My Programs' },
  { value: 'profile' as const, label: 'Mentor Profile' },
];

export const MENTORSHIP_MENTOR_PROGRAM_TERM_STATUS_LABELS: Record<MentorshipMentorProgramTermStatus, string> = {
  'active-term': 'Active term',
  upcoming: 'Upcoming',
  completed: 'Completed',
};

export const MENTORSHIP_MENTOR_PROGRAM_TERM_STATUS_BADGE_CLASSES: Record<MentorshipMentorProgramTermStatus, string> = {
  'active-term': 'bg-blue-50 text-blue-700',
  upcoming: 'bg-amber-50 text-amber-700',
  completed: 'bg-gray-100 text-gray-600',
};

export const EMPTY_MENTORSHIP_MENTOR_PROGRAM_LISTS: MentorshipMentorProgramLists = {
  mentees: [],
  applicants: [],
};

export const EMPTY_MENTORSHIP_MENTOR_PROGRAMS_RESPONSE: MentorshipMentorProgramsResponse = {
  data: [],
  total: 0,
};

/** Mentor program-detail underline tabs, in the order the page renders them. */
export const MENTORSHIP_MENTOR_PROGRAM_DETAIL_TABS = [
  { value: 'tasks', label: 'Tasks' },
  { value: 'mentees', label: 'Mentees' },
  { value: 'applicants', label: 'Applicants' },
] as const;

/**
 * Mentor Applicants tab status filter pills. Deliberately simpler than the admin tab's
 * status dropdown: it filters on the raw `MentorshipMenteeStatus` rather than the admin's
 * split `applied` / `tasks-completed` display status, and drops Withdrawn/Graduated —
 * this page only needs Pending / Accepted / Declined / All. `value: undefined` clears the
 * filter. Labels for the three statuses reuse `MENTORSHIP_MENTEE_STATUS_LABELS` so pill
 * text can't drift from the rest of the module.
 */
export const MENTORSHIP_MENTOR_APPLICANT_STATUS_FILTER_PILLS: { value: MentorshipMenteeStatus | undefined; label: string }[] = [
  { value: 'pending', label: MENTORSHIP_MENTEE_STATUS_LABELS.pending },
  { value: 'accepted', label: MENTORSHIP_MENTEE_STATUS_LABELS.accepted },
  { value: 'declined', label: MENTORSHIP_MENTEE_STATUS_LABELS.declined },
  { value: undefined, label: 'All' },
];

/**
 * Deterministic mock programs backing the mentor My Programs list while the upstream
 * mentorship service is unavailable. Removed once the real endpoint is wired up.
 */
const MOCK_MENTORSHIP_MENTOR_PROGRAM_SEEDS: MentorshipMentorProgram[] = [
  {
    id: 'mp_gridflow_fall26',
    slug: 'gridflow-time-series-ingestion-pipeline',
    name: 'GridFlow: Time-Series Ingestion Pipeline',
    projectName: 'LF Energy',
    term: 'Fall 2026',
    termStatus: 'active-term',
    termStartDate: '2026-09-01',
    termEndDate: '2026-11-23',
    stats: { mentees: 3, tasksToReview: 4, applicants: 5 },
    logoUrl: mentorshipArtworkIconUrl('lf-energy', 'grid-exchange-fabric'),
  },
  {
    id: 'mp_apicurio_fall26',
    slug: 'apicurio-registry-prompt-template-playground',
    name: 'Apicurio Registry: Prompt Template Playground',
    projectName: 'CNCF',
    term: 'Fall 2026',
    termStatus: 'active-term',
    termStartDate: '2026-09-01',
    termEndDate: '2026-11-30',
    stats: { mentees: 2, tasksToReview: 2, applicants: 2 },
    logoUrl: mentorshipArtworkIconUrl('cncf', 'apicurio-registry'),
  },
  {
    id: 'mp_janusgraph_fall26',
    slug: 'janusgraph-adjacency-cache-instrumentation',
    name: 'JanusGraph: Adjacency Cache Instrumentation',
    projectName: 'LF AI & Data',
    term: 'Fall 2026',
    termStatus: 'active-term',
    termStartDate: '2026-09-01',
    termEndDate: '2026-11-30',
    stats: { mentees: 1, tasksToReview: 0, applicants: 3 },
    logoUrl: mentorshipArtworkIconUrl('lfai', 'janusgraph'),
  },
  {
    id: 'mp_thanos_summer26',
    slug: 'thanos-fan-out-query-observability',
    name: 'Thanos: Fan-Out Query Observability',
    projectName: 'CNCF',
    term: 'Summer 2026',
    termStatus: 'completed',
    termStartDate: '2026-06-01',
    termEndDate: '2026-08-15',
    stats: { mentees: 0, tasksToReview: 0, applicants: 0 },
    logoUrl: mentorshipArtworkIconUrl('cncf', 'thanos'),
  },
  {
    id: 'mp_opa_winter27',
    slug: 'open-policy-agent-policy-bundle-linting',
    name: 'Open Policy Agent: Policy Bundle Linting',
    projectName: 'CNCF',
    term: 'Winter 2027',
    termStatus: 'upcoming',
    termStartDate: '2027-01-05',
    termEndDate: '2027-03-20',
    stats: { mentees: 0, tasksToReview: 0, applicants: 1 },
    logoUrl: mentorshipArtworkIconUrl('cncf', 'open-policy-agent', 'opa'),
  },
  {
    id: 'mp_envoy_fall26',
    slug: 'envoy-gateway-observability-hooks',
    name: 'Envoy Gateway: Observability Hooks',
    projectName: 'CNCF',
    term: 'Fall 2026',
    termStatus: 'active-term',
    termStartDate: '2026-09-01',
    termEndDate: '2026-11-30',
    stats: { mentees: 4, tasksToReview: 1, applicants: 6 },
    logoUrl: mentorshipArtworkIconUrl('cncf', 'envoy'),
  },
  {
    id: 'mp_harbor_fall26',
    slug: 'harbor-artifact-signing-workflows',
    name: 'Harbor: Artifact Signing Workflows',
    projectName: 'CNCF',
    term: 'Fall 2026',
    termStatus: 'active-term',
    termStartDate: '2026-09-01',
    termEndDate: '2026-11-30',
    stats: { mentees: 2, tasksToReview: 3, applicants: 4 },
    logoUrl: mentorshipArtworkIconUrl('cncf', 'harbor'),
  },
  {
    id: 'mp_vitess_fall26',
    slug: 'vitess-query-plan-insights',
    name: 'Vitess: Query Plan Insights',
    projectName: 'CNCF',
    term: 'Fall 2026',
    termStatus: 'active-term',
    termStartDate: '2026-09-01',
    termEndDate: '2026-11-30',
    stats: { mentees: 1, tasksToReview: 1, applicants: 2 },
    logoUrl: mentorshipArtworkIconUrl('cncf', 'vitess'),
  },
  {
    id: 'mp_falco_fall26',
    slug: 'falco-runtime-rule-simulator',
    name: 'Falco: Runtime Rule Simulator',
    projectName: 'CNCF',
    term: 'Fall 2026',
    termStatus: 'active-term',
    termStartDate: '2026-09-01',
    termEndDate: '2026-11-30',
    stats: { mentees: 3, tasksToReview: 2, applicants: 3 },
    logoUrl: mentorshipArtworkIconUrl('cncf', 'falco'),
  },
  {
    id: 'mp_crossplane_fall26',
    slug: 'crossplane-composition-testing',
    name: 'Crossplane: Composition Testing',
    projectName: 'CNCF',
    term: 'Fall 2026',
    termStatus: 'active-term',
    termStartDate: '2026-09-01',
    termEndDate: '2026-11-30',
    stats: { mentees: 2, tasksToReview: 5, applicants: 7 },
    logoUrl: mentorshipArtworkIconUrl('cncf', 'crossplane'),
  },
];

/**
 * Keep mentees/applicants that belong to this mentor program's term. Admin lists are
 * keyed by slug and mix terms (and some mentor cards have no admin entry at all).
 */
const MENTOR_PROGRAM_IDS = new Set(MOCK_MENTORSHIP_MENTOR_PROGRAM_SEEDS.map((program) => program.id));

function mentorProgramListsFor(program: MentorshipMentorProgram): MentorshipMentorProgramLists {
  const admin = MOCK_MENTORSHIP_PROGRAM_LISTS[program.slug];
  if (!admin) return EMPTY_MENTORSHIP_MENTOR_PROGRAM_LISTS;
  return {
    mentees: admin.mentees.filter((row) => row.termName === program.term),
    applicants: admin.applicants
      .filter((row) => row.termName === program.term)
      .map((row) => ({
        ...row,
        // Mentor "other applications" route to `/mentor/programs/:id`. Drop ids the
        // mentor detail endpoint cannot resolve (e.g. admin-only `mp_apicurio_winter26`).
        otherApplications: (row.otherApplications ?? []).filter((application) => MENTOR_PROGRAM_IDS.has(application.programId)),
      })),
  };
}

/** Mentor program-detail lists keyed by mentor program id, not admin slug. */
export const MOCK_MENTORSHIP_MENTOR_PROGRAM_LISTS: Record<string, MentorshipMentorProgramLists> = Object.fromEntries(
  MOCK_MENTORSHIP_MENTOR_PROGRAM_SEEDS.map((program) => [program.id, mentorProgramListsFor(program)])
);

/**
 * Card stats.mentees / stats.applicants follow the id-keyed lists so the programs
 * page, detail header, and tab rows describe the same term.
 */
export const MOCK_MENTORSHIP_MENTOR_PROGRAMS: MentorshipMentorProgram[] = MOCK_MENTORSHIP_MENTOR_PROGRAM_SEEDS.map((program) => {
  const lists = MOCK_MENTORSHIP_MENTOR_PROGRAM_LISTS[program.id] ?? EMPTY_MENTORSHIP_MENTOR_PROGRAM_LISTS;
  return {
    ...program,
    stats: {
      ...program.stats,
      mentees: lists.mentees.length,
      applicants: lists.applicants.length,
    },
  };
});

export const MENTORSHIP_MENTOR_REGISTER_TITLE = 'Become a Mentor';
export const MENTORSHIP_MENTOR_REGISTER_SUBTITLE = 'Register as a mentor and request to join the programs you want to support. Fields marked * are required.';

/**
 * Both strings stop short of promising that anything was sent: selections live on this page
 * until the registration endpoint exists, so copy claiming an administrator had been notified
 * would be a false confirmation. Reword them once the POST lands.
 */
export const MENTORSHIP_MENTOR_PROGRAMS_INTRO = 'Choose the LFX mentorships you would like to join as a mentor. Your choices are listed below.';
export const MENTORSHIP_MENTOR_PROGRAMS_HELPER =
  'You can choose more than one. Nothing is sent to a program administrator yet — requesting to join is not available in this release.';

export const MENTORSHIP_MENTOR_INTRODUCTION_INTRO =
  'This information is displayed on your mentor profile page. Your name, email and avatar come from your LFX account.';
export const MENTORSHIP_MENTOR_INTRODUCTION_PLACEHOLDER = `What is your current contributor status (i.e., experience in contributing to or maintaining open source projects, open source contributions)?

Why are you interested in volunteering as a mentor?

Tell us something that makes you unique.`;

/** Matches `MENTORSHIP_ENROLL_DESCRIPTION_MAX`, since both feed the same kind of rich-text field. */
export const MENTORSHIP_MENTOR_INTRODUCTION_MAX = 3000;

export const MENTORSHIP_MENTOR_SKILLS_INTRO = 'What are the skills that you are respected and known for? This helps match you with the right candidates.';

export const MENTORSHIP_MENTOR_RESUME_INTRO = 'Optional, but candidates often look you up before applying.';

export const MENTORSHIP_MENTOR_TERMS_INTRO =
  'Before you submit your mentor registration to the LFX Platform, review and accept the terms and conditions below.';

export const MENTORSHIP_MENTOR_EXPORT_DISCLAIMER =
  'At this moment we are not accepting applications from a person or entity restricted by U.S. export controls or sanction programs, or a resident of Cuba, Iran, North Korea, Syria, Sudan, Russian Federation or Crimea region of Ukraine.';

export const MENTORSHIP_MENTOR_COMPLIANCE_LEAD = 'I hereby certify that I am not, and/or the organization I am representing is not:';

export const MENTORSHIP_MENTOR_COMPLIANCE_ITEMS: readonly string[] = [
  'located in Cuba, Iran, North Korea, Syria, the Crimea Region of Ukraine, or the Russian-controlled areas of the Donetsk or Luhansk regions of Ukraine;',
  'owned or controlled by, acting for or on behalf of, or an individual or entity that has in the past acted for or on behalf of the Government of Cuba, Iran, North Korea, Syria, or Venezuela; or',
  "listed as a blocked person by the U.S. Department of the Treasury's Office of Foreign Assets Control (OFAC), or directly or indirectly owned 50 percent or more by such a listed person.",
];

/**
 * The accepted resume formats, and the single source the rest of this block derives
 * from. `isMentorshipResumeFileName` validates against this list, so adding a format
 * here reaches the validator, the file-picker filter, and both user-facing strings at
 * once rather than leaving three of them behind.
 */
export const MENTORSHIP_MENTOR_RESUME_EXTENSIONS = ['pdf', 'doc', 'docx'] as const;
export const MENTORSHIP_MENTOR_RESUME_MAX_BYTES = 10 * 1024 * 1024;

const RESUME_MAX_MB = MENTORSHIP_MENTOR_RESUME_MAX_BYTES / (1024 * 1024);
const RESUME_DOTTED = MENTORSHIP_MENTOR_RESUME_EXTENSIONS.map((extension) => `.${extension}`);
const RESUME_UPPERCASE = MENTORSHIP_MENTOR_RESUME_EXTENSIONS.map((extension) => extension.toUpperCase());

/**
 * MIME type per accepted format, because macOS Finder filters on MIME type rather than
 * suffix. Typed against the extension list so a new format cannot be added there without
 * a type on this side too — leaving one out is what made Word documents unselectable.
 */
const RESUME_MIME_TYPES: Record<(typeof MENTORSHIP_MENTOR_RESUME_EXTENSIONS)[number], string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** The `accept` filter for the hidden file input: every extension and its MIME type. */
export const MENTORSHIP_MENTOR_RESUME_ACCEPT = [...RESUME_DOTTED, ...Object.values(RESUME_MIME_TYPES)].join(',');

export const MENTORSHIP_MENTOR_RESUME_HELPER = `File type: ${RESUME_UPPERCASE.join(', ')} · Max size: ${RESUME_MAX_MB} MB`;
export const MENTORSHIP_MENTOR_RESUME_TYPE_ERROR = `Please upload a ${RESUME_UPPERCASE.slice(0, -1).join(', ')}, or ${RESUME_UPPERCASE.at(-1)} file.`;
export const MENTORSHIP_MENTOR_RESUME_SIZE_ERROR = `File must be ${RESUME_MAX_MB} MB or smaller.`;
export const MENTORSHIP_MENTOR_RESUME_EMPTY_LABEL = 'Choose file';

/**
 * Request statuses as the mentor sees them. Spread from the admin labels so the two can
 * only differ where this file says so, and reuse
 * `MENTORSHIP_MENTOR_STATUS_BADGE_CLASSES` for the colors.
 */
export const MENTORSHIP_MENTOR_REQUEST_STATUS_LABELS: Record<MentorshipMentorStatus, string> = {
  ...MENTORSHIP_MENTOR_STATUS_LABELS,
  // The admin tab reads "Invited" because the admin sent the invitation. The same status
  // also covers a request the mentor raised themselves, so from this side it stays neutral.
  pending: 'Pending',
};

export const MENTORSHIP_MENTOR_WITHDRAW_CONFIRM = 'Are you sure you want to withdraw this request?';

export function createEmptyMentorshipMentorForm(): MentorshipMentorRegisterForm {
  return {
    introduction: '',
    skills: [],
    resumeFileName: '',
    complianceAccepted: false,
    termsAccepted: false,
  };
}

/**
 * Copy for the standalone Mentor Profile page at `/mentorship/mentor/profile`.
 * Sections mirror the Become a Mentor registration form: about-me introduction,
 * skills tags, and the picked resume file, plus a read-only mentoring history.
 */
export const MENTORSHIP_MENTOR_PROFILE_DETAILS_TITLE = 'Mentor Profile';
export const MENTORSHIP_MENTOR_PROFILE_EDIT_LABEL = 'Edit Mentor Profile';
export const MENTORSHIP_MENTOR_PROFILE_ABOUT_LABEL = 'About Me';
export const MENTORSHIP_MENTOR_PROFILE_SKILLS_LABEL = 'Skills';
export const MENTORSHIP_MENTOR_PROFILE_RESUME_LABEL = 'Resume';
export const MENTORSHIP_MENTOR_PROFILE_ABOUT_EMPTY = 'No introduction added yet.';
export const MENTORSHIP_MENTOR_PROFILE_SKILLS_EMPTY = 'No skills added yet.';
export const MENTORSHIP_MENTOR_PROFILE_RESUME_EMPTY = 'No resume uploaded yet.';
/**
 * Fallback anchor label when the profile carries a `resumeUrl` but no `resumeFileName` —
 * the two fields are independently optional in `MentorshipMentorProfileDetails`, so the
 * UI needs a readable label when only the URL is present rather than falling into the
 * "No resume uploaded yet." empty state.
 */
export const MENTORSHIP_MENTOR_PROFILE_RESUME_VIEW_LABEL = 'View resume';

export const MENTORSHIP_MENTORING_HISTORY_TITLE = 'Mentoring History';
export const MENTORSHIP_MENTORING_HISTORY_EMPTY_TITLE = 'No mentoring history yet';
export const MENTORSHIP_MENTORING_HISTORY_EMPTY_SUBTITLE = 'Programs you mentor on will appear here once your first term begins.';

/** Mentoring history badge copy. */
export const MENTORSHIP_MENTORING_HISTORY_STATUS_LABELS: Record<MentorshipMentoringHistoryStatus, string> = {
  'in-progress': 'In Progress',
  completed: 'Completed',
};

/**
 * Runtime Tailwind class map for the Mentoring History status badge. The tokens live
 * outside the app's `content` glob, so this map's values are also spread into the
 * Tailwind safelist — a status/class change here cannot silently lose styling.
 */
export const MENTORSHIP_MENTORING_HISTORY_STATUS_BADGE_CLASSES: Record<MentorshipMentoringHistoryStatus, string> = {
  'in-progress': 'bg-blue-50 text-blue-700',
  completed: 'bg-gray-100 text-gray-600',
};

export const EMPTY_MENTORSHIP_MENTOR_PROFILE_RESPONSE: MentorshipMentorProfileResponse = {
  profile: { aboutMe: '', skills: [], resumeFileName: undefined, resumeUrl: undefined },
  history: [],
};

/**
 * Deterministic mock backing the standalone mentor profile page while the mentorship
 * profiles endpoint is unavailable. Removed once the real read is wired up.
 */
export const MOCK_MENTORSHIP_MENTORING_HISTORY: MentorshipMentoringHistoryEntry[] = [
  { id: 'mh_gridflow_fall26', programName: 'GridFlow: Ingestion Pipeline', term: 'Fall 2026', menteesCount: 3, status: 'in-progress' },
  { id: 'mh_apicurio_summer26', programName: 'Apicurio Registry: Playground', term: 'Summer 2026', menteesCount: 2, status: 'completed' },
  { id: 'mh_gridflow_spring26', programName: 'GridFlow: Metrics Exporter', term: 'Spring 2026', menteesCount: 2, status: 'completed' },
];

export const MOCK_MENTORSHIP_MENTOR_PROFILE: MentorshipMentorProfileResponse = {
  profile: {
    aboutMe:
      'I am in my final year of a computer engineering degree, building telemetry tooling for a campus microgrid project. I want to learn how production ingestion pipelines are designed and reviewed.',
    skills: ['Python', 'Postgres', 'Kubernetes', 'Go', 'Grafana', 'Linux'],
    // Synthetic filename (no real person). The mock URL below is a fragment on purpose:
    // `isValidUrl` in the profile details component rejects it, so the mentor sees the
    // filename without an anchor — exactly the behavior expected once the upstream
    // service returns a real signed URL.
    resumeFileName: 'test-mentor-resume.pdf',
    resumeUrl: '#',
  },
  history: MOCK_MENTORSHIP_MENTORING_HISTORY,
};
