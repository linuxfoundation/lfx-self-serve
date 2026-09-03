// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MONTH_OPTIONS } from '../constants/profile.constants';
import {
  MENTORSHIP_CUSTOM_PREREQ_DESCRIPTION_MAX,
  MENTORSHIP_CUSTOM_PREREQ_NAME_MAX,
  MENTORSHIP_ENROLL_DESCRIPTION_MAX,
  MENTORSHIP_ENROLL_NAME_MAX,
} from '../constants/mentorship-enroll.constants';
import type { MentorshipEnrollFieldErrors, MentorshipEnrollForm, MentorshipEnrollStep } from '../interfaces/mentorship.interface';
import { monthYearToIsoDate } from './date-time.utils';
import { stripHtml } from './html-utils';

function isBlank(value: string): boolean {
  return !value.trim();
}

export function mentorshipDescriptionLength(html: string): number {
  return stripHtml(html).length;
}

export function getMentorshipEnrollStepErrors(step: MentorshipEnrollStep, form: MentorshipEnrollForm): MentorshipEnrollFieldErrors {
  if (step === 'details') {
    const errors: MentorshipEnrollFieldErrors = {};
    if (isBlank(form.name)) {
      errors.name = 'Program name is required.';
    } else if (form.name.trim().length > MENTORSHIP_ENROLL_NAME_MAX) {
      errors.name = `Program name must be ${MENTORSHIP_ENROLL_NAME_MAX} characters or fewer.`;
    }
    if (isBlank(form.projectId)) errors.projectId = 'Select a Linux Foundation project.';
    if (!form.technologies.length) errors.technologies = 'Add at least one technology.';
    if (mentorshipDescriptionLength(form.description) === 0) {
      errors.description = 'Program description is required.';
    } else if (mentorshipDescriptionLength(form.description) > MENTORSHIP_ENROLL_DESCRIPTION_MAX) {
      errors.description = `Description must be ${MENTORSHIP_ENROLL_DESCRIPTION_MAX} characters or fewer.`;
    }
    if (isBlank(form.repositoryUrl)) errors.repositoryUrl = 'Repository URL is required.';
    if (isBlank(form.logoFileName)) errors.logoFileName = 'Program logo is required.';
    return errors;
  }

  if (step === 'setup') {
    const errors: MentorshipEnrollFieldErrors = {};
    if (!form.skills.length) errors.skills = 'Add at least one skill.';
    if (!form.terms.length) errors.terms = 'Add at least one program term.';
    return errors;
  }

  const errors: MentorshipEnrollFieldErrors = {};
  const incompleteCustom = form.prerequisites.some((item) => {
    if (!item.custom) return false;
    if (isBlank(item.name) || item.name.trim().length > MENTORSHIP_CUSTOM_PREREQ_NAME_MAX) return true;
    if (isBlank(item.dueDate ?? '')) return true;
    return isBlank(item.description) || item.description.trim().length > MENTORSHIP_CUSTOM_PREREQ_DESCRIPTION_MAX;
  });
  if (incompleteCustom) {
    errors.prerequisites = 'Complete each custom prerequisite or delete it.';
  } else if (!form.prerequisites.some((item) => item.required)) {
    errors.prerequisites = 'Mark at least one prerequisite as required.';
  }
  if (!form.termsAccepted) {
    errors.termsAccepted = 'Please accept the terms and conditions.';
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
