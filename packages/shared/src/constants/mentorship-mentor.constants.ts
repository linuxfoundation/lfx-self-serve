// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MentorshipMentorProgramRequest, MentorshipMentorRegisterForm, MentorshipMentorStatus } from '../interfaces/mentorship.interface';
import { MENTORSHIP_MENTOR_STATUS_LABELS } from './mentorship.constants';

export const MENTORSHIP_MENTOR_REGISTER_TITLE = 'Become a Mentor';
export const MENTORSHIP_MENTOR_REGISTER_SUBTITLE = 'Register as a mentor and request to join the programs you want to support. Fields marked * are required.';

export const MENTORSHIP_MENTOR_PROGRAMS_INTRO =
  'Select the LFX mentorship you would like to join as a mentor, and the program administrator will be notified of your request.';
export const MENTORSHIP_MENTOR_PROGRAMS_HELPER = 'Selecting a program sends a request to its administrator. You can request more than one.';

export const MENTORSHIP_MENTOR_INTRODUCTION_INTRO =
  'This information is displayed on your mentor profile page. Your name, email and avatar come from your LFX account.';
export const MENTORSHIP_MENTOR_INTRODUCTION_PLACEHOLDER = `What is your current contributor status (i.e., experience in contributing to or maintaining open source projects, open source contributions)?

Why are you interested in volunteering as a mentor?

Tell us something that makes you unique.`;

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

export const MENTORSHIP_MENTOR_RESUME_ACCEPT = '.pdf,.doc,.docx,application/pdf';
export const MENTORSHIP_MENTOR_RESUME_EXTENSIONS = ['pdf', 'doc', 'docx'] as const;
export const MENTORSHIP_MENTOR_RESUME_MAX_BYTES = 10 * 1024 * 1024;
export const MENTORSHIP_MENTOR_RESUME_HELPER = 'File type: PDF, .DOC, .DOCX · Max size: 10 MB';
export const MENTORSHIP_MENTOR_RESUME_TYPE_ERROR = 'Please upload a PDF, DOC, or DOCX file.';
export const MENTORSHIP_MENTOR_RESUME_SIZE_ERROR = 'File must be 10 MB or smaller.';
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

/** Seed rows standing in for the mentor's existing requests until the API lands. */
export const MENTORSHIP_MENTOR_SEED_REQUESTS: MentorshipMentorProgramRequest[] = [
  { id: 'req_1', programId: 'mp_kubernetes_contributors', programName: 'Kubernetes Contributors', status: 'accepted' },
  { id: 'req_2', programId: 'mp_apicurio_registry', programName: 'Apicurio Registry: Prompt Template Playground', status: 'pending' },
];

export function createEmptyMentorshipMentorForm(): MentorshipMentorRegisterForm {
  return {
    introduction: '',
    skills: [],
    resumeFileName: '',
    complianceAccepted: false,
    termsAccepted: false,
  };
}
