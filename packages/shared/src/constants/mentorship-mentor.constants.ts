// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  MentorshipMentorProgram,
  MentorshipMentorProgramsResponse,
  MentorshipMentorProgramTermStatus,
  MentorshipMentorRegisterForm,
  MentorshipMentorStatus,
} from '../interfaces/mentorship.interface';
import { mentorshipArtworkIconUrl, MENTORSHIP_MENTOR_STATUS_LABELS } from './mentorship.constants';

export const MENTORSHIP_MENTOR_PROGRAMS_PAGE_TITLE = 'My Programs';

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

export const EMPTY_MENTORSHIP_MENTOR_PROGRAMS_RESPONSE: MentorshipMentorProgramsResponse = {
  data: [],
  total: 0,
};

/**
 * Deterministic mock programs backing the mentor My Programs list while the upstream
 * mentorship service is unavailable. Removed once the real endpoint is wired up.
 */
export const MOCK_MENTORSHIP_MENTOR_PROGRAMS: MentorshipMentorProgram[] = [
  {
    id: 'mp_gridflow_fall26',
    slug: 'gridflow-time-series-ingestion-pipeline',
    name: 'GridFlow: Time-Series Ingestion Pipeline',
    projectName: 'LF Energy',
    term: 'Fall 2026',
    termStatus: 'active-term',
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
    stats: { mentees: 2, tasksToReview: 5, applicants: 7 },
    logoUrl: mentorshipArtworkIconUrl('cncf', 'crossplane'),
  },
];

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
