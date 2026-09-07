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
} from '../constants/mentorship-enroll.constants';
import type {
  MentorshipEnrollFieldErrors,
  MentorshipEnrollForm,
  MentorshipEnrollStep,
  MentorshipProgramTerm,
  MentorshipTermDateErrors,
} from '../interfaces/mentorship.interface';
import { monthYearToIsoDate } from './date-time.utils';
import { stripHtml } from './html-utils';
import { normalizeToUrl } from './url.utils';

function isBlank(value: string): boolean {
  return !value.trim();
}

/** CII Best Practices project IDs are numeric, matching the old maintainer enroll form. */
export function isMentorshipCiiProjectId(value: string): boolean {
  return /^\d+$/.test(value.trim());
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

export function getMentorshipTermDateErrors(
  term: Pick<MentorshipProgramTerm, 'startDate' | 'endDate' | 'applicationStartDate' | 'applicationEndDate'>,
  today = new Date()
): MentorshipTermDateErrors {
  const errors: MentorshipTermDateErrors = {};
  const todayIso = toMentorshipDateOnly(today);
  const currentMonthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;

  if (term.startDate < currentMonthStart) {
    errors.startDate = 'Start month should be greater than or equal to current month.';
  }
  if (term.endDate < term.startDate) {
    errors.endDate = 'End date must be on or after the start date.';
  }
  if (term.applicationStartDate < todayIso) {
    errors.applicationStartDate = 'Application start date cannot be before today.';
  } else if (term.applicationStartDate >= term.startDate) {
    errors.applicationStartDate = 'Application start date must be before the term start month.';
  }
  if (term.applicationEndDate < todayIso) {
    errors.applicationEndDate = 'Application end date cannot be before today.';
  } else if (term.applicationEndDate < term.applicationStartDate) {
    errors.applicationEndDate = 'Application end date must be on or after the application start date.';
  } else if (term.applicationEndDate > lastDayOfMentorshipMonth(term.endDate)) {
    errors.applicationEndDate = 'Application end date must be on or before the term end month.';
  }
  return errors;
}

export function getMentorshipEnrollStepErrors(step: MentorshipEnrollStep, form: MentorshipEnrollForm): MentorshipEnrollFieldErrors {
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
      const firstTermError = form.terms.map((term) => Object.values(getMentorshipTermDateErrors(term))[0]).find(Boolean);
      if (firstTermError) errors.terms = firstTermError;
    }
    return errors;
  }

  const errors: MentorshipEnrollFieldErrors = {};
  const todayIso = toMentorshipDateOnly(new Date());
  const incompleteCustom = form.prerequisites.some((item) => {
    if (!item.custom) return false;
    if (isBlank(item.name) || item.name.trim().length > MENTORSHIP_CUSTOM_PREREQ_NAME_MAX) return true;
    if (isBlank(item.dueDate ?? '')) return true;
    if ((item.dueDate ?? '') <= todayIso) return true;
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
  if (!form.termsAccepted) {
    errors.termsAccepted = 'Please accept terms and conditions in order to proceed.';
  }
  return errors;
}

export function isMentorshipEnrollStepValid(step: MentorshipEnrollStep, form: MentorshipEnrollForm): boolean {
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

/** URL-safe slug from a program name. Empty names fall back to `program`. */
export function mentorshipProgramSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'program';
}
