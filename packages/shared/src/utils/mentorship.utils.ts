// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MONTH_OPTIONS } from '../constants/profile.constants';
import {
  MENTORSHIP_CII_INVALID_ID,
  MENTORSHIP_CHALLENGE_URL_REQUIRED,
  MENTORSHIP_CUSTOM_PREREQ_DESCRIPTION_MAX,
  MENTORSHIP_CUSTOM_PREREQ_NAME_MAX,
  MENTORSHIP_ENROLL_DESCRIPTION_MAX,
  MENTORSHIP_ENROLL_LOGO_EXTENSIONS,
  MENTORSHIP_ENROLL_NAME_MAX,
  MENTORSHIP_ENROLL_NAME_MIN,
  MENTORSHIP_INVALID_URL,
  MENTORSHIP_MAX_OPEN_TERMS,
  MENTORSHIP_MAX_OPEN_TERMS_MESSAGE,
  MENTORSHIP_TERM_NAME_MAX,
} from '../constants/mentorship-enroll.constants';
import { MENTORSHIP_MENTEE_ACTIONS } from '../constants/mentorship.constants';
import type {
  MentorshipEnrollFieldErrors,
  MentorshipEnrollRequest,
  MentorshipEnrollStep,
  MentorshipMenteeAction,
  MentorshipMenteeStatus,
  MentorshipProgram,
  MentorshipProgramDetail,
  MentorshipProgramLists,
  MentorshipProgramMentee,
  MentorshipProgramMentor,
  MentorshipProgramTabCounts,
  MentorshipProgramTerm,
  MentorshipProgramTermRow,
  MentorshipTermDateErrors,
} from '../interfaces/mentorship.interface';
import { formatIsoDateLabel, monthYearToIsoDate } from './date-time.utils';
import { stripHtml } from './html-utils';
import { normalizeToUrl } from './url.utils';

const MENTORSHIP_ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MENTORSHIP_ISO_DATE_ERROR = 'Enter a valid date (YYYY-MM-DD).';
const MENTORSHIP_TERM_FIELDS_ERROR = 'Each term needs a name and valid calendar dates (YYYY-MM-DD).';

function isBlank(value: string): boolean {
  return !value.trim();
}

/** Exact `YYYY-MM-DD` that exists on the calendar (rejects `2026-02-31` and `9999-z`). */
export function isMentorshipIsoDate(value: string): boolean {
  const match = MENTORSHIP_ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/** CII Best Practices project IDs are positive integers (`[1-9][0-9]*`). */
export function isMentorshipCiiProjectId(value: string): boolean {
  return /^[1-9][0-9]*$/.test(value.trim());
}

/** Optional-or-required HTTP(S) URL, matching the old maintainer `CustomValidators.url`. */
export function isMentorshipHttpUrl(value: string): boolean {
  return normalizeToUrl(value.trim()) !== null;
}

export function isMentorshipLogoFileName(fileName: string): boolean {
  const ext = fileName.trim().split('.').pop()?.toLowerCase() ?? '';
  return (MENTORSHIP_ENROLL_LOGO_EXTENSIONS as readonly string[]).includes(ext);
}

export function lastDayOfMentorshipMonth(isoMonthStart: string): string {
  const parsed = parseMentorshipMonthYear(isoMonthStart);
  if (!parsed) return isoMonthStart;
  const last = new Date(Number(parsed.year), Number(parsed.month), 0);
  return toMentorshipDateOnly(last);
}

export function mentorshipDescriptionLength(html: string): number {
  return stripHtml(html).length;
}

/**
 * Host calendar day one before `today`. A UTC BFF is at most one civil day ahead
 * of a behind-UTC browser, so "today" stamped on the client must still pass.
 */
export function mentorshipDateOnlyFloor(today = new Date()): string {
  return toMentorshipDateOnly(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));
}

export function getMentorshipTermDateErrors(
  term: Pick<MentorshipProgramTerm, 'startDate' | 'endDate' | 'applicationStartDate' | 'applicationEndDate'>,
  today = new Date(),
  original?: Pick<MentorshipProgramTerm, 'startDate' | 'endDate' | 'applicationStartDate' | 'applicationEndDate'>
): MentorshipTermDateErrors {
  const errors: MentorshipTermDateErrors = {};
  const todayFloor = mentorshipDateOnlyFloor(today);
  const floorDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const currentMonthStart = `${floorDate.getFullYear()}-${String(floorDate.getMonth() + 1).padStart(2, '0')}-01`;
  const startValid = isMentorshipIsoDate(term.startDate);
  const endValid = isMentorshipIsoDate(term.endDate);
  const appStartValid = isMentorshipIsoDate(term.applicationStartDate);
  const appEndValid = isMentorshipIsoDate(term.applicationEndDate);

  if (!startValid) {
    errors.startDate = MENTORSHIP_ISO_DATE_ERROR;
  } else if (term.startDate < currentMonthStart && term.startDate !== original?.startDate) {
    errors.startDate = 'Start month should be greater than or equal to current month.';
  }
  if (!endValid) {
    errors.endDate = MENTORSHIP_ISO_DATE_ERROR;
  } else if (startValid && term.endDate < term.startDate) {
    errors.endDate = 'End date must be on or after the start date.';
  }
  if (!appStartValid) {
    errors.applicationStartDate = MENTORSHIP_ISO_DATE_ERROR;
  } else if (term.applicationStartDate < todayFloor && term.applicationStartDate !== original?.applicationStartDate) {
    errors.applicationStartDate = 'Application start date cannot be before today.';
  } else if (startValid && term.applicationStartDate >= term.startDate) {
    errors.applicationStartDate = 'Application start date must be before the term start month.';
  }
  if (!appEndValid) {
    errors.applicationEndDate = MENTORSHIP_ISO_DATE_ERROR;
  } else if (term.applicationEndDate < todayFloor && term.applicationEndDate !== original?.applicationEndDate) {
    errors.applicationEndDate = 'Application end date cannot be before today.';
  } else if (appStartValid && term.applicationEndDate < term.applicationStartDate) {
    errors.applicationEndDate = 'Application end date must be on or after the application start date.';
  } else if (endValid && term.applicationEndDate > lastDayOfMentorshipMonth(term.endDate)) {
    errors.applicationEndDate = 'Application end date must be on or before the term end month.';
  }
  return errors;
}

export function getMentorshipEnrollStepErrors(step: MentorshipEnrollStep, form: MentorshipEnrollRequest): MentorshipEnrollFieldErrors {
  if (step === 'details') {
    const errors: MentorshipEnrollFieldErrors = {};
    if (isBlank(form.name)) {
      errors.name = 'Program name is required.';
    } else if (form.name.trim().length < MENTORSHIP_ENROLL_NAME_MIN || form.name.trim().length > MENTORSHIP_ENROLL_NAME_MAX) {
      errors.name = `Program name should be between ${MENTORSHIP_ENROLL_NAME_MIN} and ${MENTORSHIP_ENROLL_NAME_MAX} characters.`;
    }
    if (isBlank(form.projectId)) errors.projectId = 'Select a Linux Foundation project.';
    if (!form.technologies.length) errors.technologies = 'Add at least one technology.';
    if (mentorshipDescriptionLength(form.description) === 0) {
      errors.description = 'Program description is required.';
    } else if (mentorshipDescriptionLength(form.description) > MENTORSHIP_ENROLL_DESCRIPTION_MAX) {
      errors.description = `Description must be ${MENTORSHIP_ENROLL_DESCRIPTION_MAX} characters or fewer.`;
    }
    if (isBlank(form.repositoryUrl)) {
      errors.repositoryUrl = "A link to the program's repository is required.";
    } else if (!isMentorshipHttpUrl(form.repositoryUrl)) {
      errors.repositoryUrl = MENTORSHIP_INVALID_URL;
    }
    if (form.websiteUrl.trim() && !isMentorshipHttpUrl(form.websiteUrl)) {
      errors.websiteUrl = MENTORSHIP_INVALID_URL;
    }
    if (form.codeOfConductUrl.trim() && !isMentorshipHttpUrl(form.codeOfConductUrl)) {
      errors.codeOfConductUrl = MENTORSHIP_INVALID_URL;
    }
    if (isBlank(form.logoFileName)) {
      errors.logoFileName = 'Logo is required.';
    } else if (!isMentorshipLogoFileName(form.logoFileName)) {
      errors.logoFileName = 'Program logo is not the right file type.';
    }
    if (form.ciiProjectId.trim() && !isMentorshipCiiProjectId(form.ciiProjectId)) {
      errors.ciiProjectId = MENTORSHIP_CII_INVALID_ID;
    }
    return errors;
  }

  if (step === 'setup') {
    const errors: MentorshipEnrollFieldErrors = {};
    if (!form.skills.length) errors.skills = 'Add at least one skill.';
    if (!form.terms.length) {
      errors.terms = 'Add at least one program term.';
    } else if (form.terms.length > MENTORSHIP_MAX_OPEN_TERMS) {
      errors.terms = MENTORSHIP_MAX_OPEN_TERMS_MESSAGE;
    } else {
      const incompleteTerm = form.terms.find((term) => isBlank(term.id) || isBlank(term.name) || term.name.trim().length > MENTORSHIP_TERM_NAME_MAX);
      if (incompleteTerm) {
        errors.terms =
          incompleteTerm.name.trim().length > MENTORSHIP_TERM_NAME_MAX
            ? `Term name must be ${MENTORSHIP_TERM_NAME_MAX} characters or fewer.`
            : MENTORSHIP_TERM_FIELDS_ERROR;
      } else {
        const firstTermError = form.terms.map((term) => Object.values(getMentorshipTermDateErrors(term))[0]).find(Boolean);
        if (firstTermError) errors.terms = firstTermError;
      }
    }
    return errors;
  }

  const errors: MentorshipEnrollFieldErrors = {};
  const todayFloor = mentorshipDateOnlyFloor();
  const incompleteCustom = form.prerequisites.some((item) => {
    if (!item.custom) return false;
    if (isBlank(item.name) || item.name.trim().length > MENTORSHIP_CUSTOM_PREREQ_NAME_MAX) return true;
    if (isBlank(item.dueDate ?? '') || !isMentorshipIsoDate(item.dueDate ?? '')) return true;
    if ((item.dueDate ?? '') < todayFloor) return true;
    return isBlank(item.description) || item.description.trim().length > MENTORSHIP_CUSTOM_PREREQ_DESCRIPTION_MAX;
  });
  const coding = form.prerequisites.find((item) => item.id === 'prereq-coding');
  if (coding?.required) {
    if (isBlank(coding.challengeUrl ?? '')) {
      errors.challengeUrl = MENTORSHIP_CHALLENGE_URL_REQUIRED;
    } else if (!isMentorshipHttpUrl(coding.challengeUrl ?? '')) {
      errors.challengeUrl = MENTORSHIP_INVALID_URL;
    }
  } else if ((coding?.challengeUrl ?? '').trim() && !isMentorshipHttpUrl(coding?.challengeUrl ?? '')) {
    errors.challengeUrl = MENTORSHIP_INVALID_URL;
  }

  if (incompleteCustom) {
    errors.prerequisites = 'Complete each custom prerequisite or delete it.';
  } else if (!form.prerequisites.some((item) => item.required)) {
    errors.prerequisites = 'At least one prerequisite is required.';
  }
  if (!isMentorshipTermsAccepted(form.termsAccepted)) {
    errors.termsAccepted = 'Please accept terms and conditions in order to proceed.';
  }
  return errors;
}

/**
 * PrimeNG's checkbox can write `true`, or a non-empty array when `binary` is not applied.
 * Treat any of those as an accepted terms check so a visually checked box is not rejected.
 */
export function isMentorshipTermsAccepted(value: unknown): boolean {
  if (value === true || value === 1 || value === 'true') return true;
  return Array.isArray(value) && value.length > 0;
}

export function isMentorshipEnrollStepValid(step: MentorshipEnrollStep, form: MentorshipEnrollRequest): boolean {
  return Object.keys(getMentorshipEnrollStepErrors(step, form)).length === 0;
}

/** Month (`01`–`12`) and year from an ISO `YYYY-MM-DD` or a `September 2026` label. */
export function parseMentorshipMonthYear(value: string): { month: string; year: string } | null {
  const trimmed = value.trim();
  const iso = /^(\d{4})-(\d{2})(?:-\d{2})?/.exec(trimmed);
  if (iso) {
    return { year: iso[1], month: iso[2] };
  }

  const labeled = /^([A-Za-z]+)\s+(\d{4})$/.exec(trimmed);
  if (!labeled) return null;

  const month = MONTH_OPTIONS.find((option) => option.label.toLowerCase() === labeled[1].toLowerCase());
  return month ? { month: month.value, year: labeled[2] } : null;
}

/** Display label for a stored term start/end, e.g. `September 2026`. */
export function formatMentorshipMonthYear(value: string): string {
  const parsed = parseMentorshipMonthYear(value);
  if (!parsed) return value;
  const month = MONTH_OPTIONS.find((option) => option.value === parsed.month);
  return month ? `${month.label} ${parsed.year}` : value;
}

export function mentorshipMonthYearToStartDate(month: string, year: string): string {
  return monthYearToIsoDate(month, year);
}

/** Local calendar date from an ISO `YYYY-MM-DD` (avoids UTC day-shift). */
export function parseMentorshipDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function toMentorshipDateOnly(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * URL-safe slug from a program name. Empty names fall back to `program`.
 *
 * The first `.replace` collapses every run of non-alphanumerics into a single
 * `-`, so at most one leading and one trailing `-` can remain. Trimming those
 * with `slice` instead of a `/^-+|-+$/g` alternation removes the polynomial
 * ReDoS surface CodeQL flags (`js/polynomial-redos`) even when `name` comes
 * from an unvalidated caller — the shared util has no length guard of its own.
 */
export function mentorshipProgramSlug(name: string): string {
  let slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
  if (slug.startsWith('-')) slug = slug.slice(1);
  if (slug.endsWith('-')) slug = slug.slice(0, -1);
  return slug || 'program';
}

export function buildMentorshipProgramTabCounts(lists: MentorshipProgramLists): MentorshipProgramTabCounts {
  return {
    mentees: lists.mentees.length,
    applicants: lists.applicants.length,
    mentors: lists.mentors.length,
    terms: lists.terms.length,
  };
}

export function buildMentorshipProgramDetail(program: MentorshipProgram, lists: MentorshipProgramLists): MentorshipProgramDetail {
  return {
    program,
    tabCounts: buildMentorshipProgramTabCounts(lists),
    ...lists,
  };
}

/** Case-insensitive match on name or email. Empty search matches everyone. */
export function matchesMentorshipPersonSearch(person: MentorshipProgramMentee | MentorshipProgramMentor, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return person.name.toLowerCase().includes(needle) || person.email.toLowerCase().includes(needle);
}

/**
 * Row actions offered for a mentee's current status on the Current Mentees tab.
 * Each action moves the mentee to the same-named status, so the status a mentee is
 * already in is never offered. `graduated` is terminal, and only an accepted mentee
 * can graduate.
 */
export function mentorshipMenteeActionsFor(status: MentorshipMenteeStatus): MentorshipMenteeAction[] {
  if (status === 'graduated') return [];
  return MENTORSHIP_MENTEE_ACTIONS.filter((action) => {
    if (action === status) return false;
    return action !== 'graduated' || status === 'accepted';
  });
}

/**
 * Task column label on the Current Mentees tab, e.g. `7 of 12 submitted`.
 * Returns null when no tasks are assigned so the cell can render a dash instead
 * of the misleading `0 of 0 submitted`.
 */
export function formatMentorshipTaskProgress(submitted?: number, total?: number): string | null {
  if (!total || total <= 0) return null;
  return `${submitted ?? 0} of ${total} submitted`;
}

/** Inclusive UTC date range for term / invitation columns, e.g. `Jul 1, 2026 – Aug 31, 2026`. */
export function formatMentorshipDateRange(start: string, end: string): string {
  return `${formatIsoDateLabel(start)} – ${formatIsoDateLabel(end)}`;
}

/** Short month-year for the terms table, e.g. `Sep 2026`. */
export function formatMentorshipShortMonthYear(value: string): string {
  const parsed = parseMentorshipDateOnly(value);
  if (!parsed) return formatMentorshipMonthYear(value);
  return parsed.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function isMentorshipTermEnded(endDate: string, today = new Date()): boolean {
  return lastDayOfMentorshipMonth(endDate) < toMentorshipDateOnly(today);
}

export function mentorshipOpenTermCount(terms: ReadonlyArray<Pick<MentorshipProgramTermRow, 'status'>>): number {
  return terms.filter((term) => term.status === 'open').length;
}

export function mentorshipTermHasApplications(term: Pick<MentorshipProgramTermRow, 'pending' | 'declined' | 'accepted' | 'graduated'>): boolean {
  return term.pending + term.declined + term.accepted + term.graduated > 0;
}

/** Two-letter initials from the first two whitespace-delimited tokens, e.g. "Alex Rivera" → "AR". */
export function mentorshipPersonInitials(name: string): string {
  const tokens = name.trim().split(/\s+/);
  if (tokens.length === 0 || tokens[0].length === 0) return '?';
  const first = tokens[0][0];
  const second = tokens[1]?.[0] ?? tokens[0][1] ?? '';
  return (first + second).toUpperCase();
}
