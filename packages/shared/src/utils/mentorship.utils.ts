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
  MENTORSHIP_RICH_TEXT_RAW_MAX,
  MENTORSHIP_RICH_TEXT_TOO_LARGE_MESSAGE,
  MENTORSHIP_TERM_NAME_MAX,
  MOCK_MENTORSHIP_LF_PROJECTS,
} from '../constants/mentorship-enroll.constants';
import {
  MENTORSHIP_MENTEE_APPLICATION_PROGRESS_LABELS,
  MENTORSHIP_MENTEE_APPLICATION_STATUS_CLASSES,
  MENTORSHIP_MENTEE_APPLICATION_STATUS_LABELS,
  MENTORSHIP_MENTEE_APPLICATION_STATUS_ORDER,
  MENTORSHIP_MENTEE_DEMOGRAPHIC_GROUPS,
  MENTORSHIP_MENTEE_DEMOGRAPHIC_PREFER_NOT_TO_SAY,
  MENTORSHIP_MENTEE_DEMOGRAPHIC_ROWS,
  MENTORSHIP_MENTEE_INTRODUCTION_MAX,
  MENTORSHIP_MENTEE_PAST_OUTCOME_BY_STATUS,
  MENTORSHIP_MENTEE_PAST_OUTCOME_CLASSES,
  MENTORSHIP_MENTEE_PAST_OUTCOME_LABELS,
  MENTORSHIP_MENTEE_PROFILE_UPDATE_KEYS,
  MENTORSHIP_MENTEE_TASK_HINT_FILE_REQUIRED,
  MENTORSHIP_MENTEE_TASK_HINT_LOCKED,
  MENTORSHIP_MENTEE_TASK_HINT_START_FIRST,
  MENTORSHIP_MENTEE_TASK_STATUS_CLASSES,
  MENTORSHIP_MENTEE_TASK_STATUS_OPTIONS,
  MENTORSHIP_MENTEE_UPDATABLE_TASK_STATUSES,
} from '../constants/mentorship-mentee.constants';
import { MENTORSHIP_MENTOR_INTRODUCTION_MAX, MENTORSHIP_MENTOR_RESUME_EXTENSIONS } from '../constants/mentorship-mentor.constants';
import {
  MENTORSHIP_APPLICANT_ACTIONS,
  MENTORSHIP_APPLICANT_TASK_DUE_PREREQUISITE_LABEL,
  MENTORSHIP_APPLICANT_TASK_STATUS_BADGE_CLASSES,
  MENTORSHIP_APPLICANT_TASK_STATUS_LABELS,
  MENTORSHIP_CURRENT_MENTEE_STATUSES,
  MENTORSHIP_MENTEE_ACTIONS,
  MENTORSHIP_PAST_MENTEE_STATUSES,
  MENTORSHIP_PROGRAM_AVATAR_PALETTE,
} from '../constants/mentorship.constants';
import type { FilterOption } from '../interfaces/filter.interface';
import type {
  MentorshipApplicantAction,
  MentorshipApplicantDisplayStatus,
  MentorshipApplicantTask,
  MentorshipApplicantTaskRow,
  MentorshipApplicationProgress,
  MentorshipEnrollFieldErrors,
  MentorshipEnrollStep,
  MentorshipEnrollValidationInput,
  MentorshipMenteeAction,
  MentorshipMenteeStatus,
  MentorshipMentorProgram,
  MentorshipMentorProgramDetail,
  MentorshipMentorProgramLists,
  MentorshipMentorProgramTabCounts,
  MentorshipMentorReviewTask,
  MentorshipMentorRegisterFieldErrors,
  MentorshipMentorRegisterForm,
  MentorshipNoteDisplay,
  MentorshipProgram,
  MentorshipProgramDetail,
  MentorshipProgramLists,
  MentorshipProgramMentee,
  MentorshipProgramMentor,
  MentorshipProgramTabCounts,
  MentorshipProgramTerm,
  MentorshipProgramTermRow,
  MentorshipRowAction,
  MentorshipTermDateErrors,
} from '../interfaces/mentorship.interface';
import type {
  MentorshipMenteeApplication,
  MentorshipMenteeApplicationStatus,
  MentorshipMenteeApplicationTask,
  MentorshipMenteeApplyIds,
  MentorshipMenteeApplicationView,
  MentorshipMenteeDemographicGroupName,
  MentorshipMenteeDemographics,
  MentorshipMenteeDemographicsFormValue,
  MentorshipMenteeOverview,
  MentorshipMenteePastApplication,
  MentorshipMenteeProfileDetails,
  MentorshipMenteeProfileFormValue,
  MentorshipMenteeProfileUpdateRequest,
  MentorshipMenteeRegisterFieldErrors,
  MentorshipMenteeRegisterForm,
  MentorshipMenteeTaskStatus,
  MentorshipMenteeTaskStatusOptionsState,
  MentorshipMenteeTaskView,
  MentorshipMenteeUpdatableTaskStatus,
} from '../interfaces/mentorship-mentee.interface';
import { formatIsoDateLabel, formatRelativeTime, monthYearToIsoDate, toLocalDateOnlyString } from './date-time.utils';
import { escapeHtml, stripHtml } from './html-utils';
import { normalizeToUrl } from './url.utils';

const MENTORSHIP_ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MENTORSHIP_ISO_DATE_ERROR = 'Enter a valid date (YYYY-MM-DD).';
const MENTORSHIP_TERM_FIELDS_ERROR = 'Each term needs a name and valid calendar dates (YYYY-MM-DD).';

function isBlank(value: string): boolean {
  return !value.trim();
}

/**
 * A date-only value (`YYYY-MM-DD`) as its UTC midnight instant, so `DatePipe` with `'UTC'` shows the
 * same calendar day in every timezone. Any other value comes back unchanged.
 */
export function toMentorshipUtcInstant(value: string): string {
  return MENTORSHIP_ISO_DATE.test(value) ? `${value}T00:00:00Z` : value;
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

/**
 * Plain-text length of a rich-text field. Input over `MENTORSHIP_RICH_TEXT_RAW_MAX` returns its raw
 * length without stripping, so it still fails every `*_MAX` check but never reaches the quadratic
 * `stripHtml` loop (lfx-self-serve-ops#37).
 */
export function mentorshipDescriptionLength(html: string): number {
  if (isMentorshipRichTextOverRawMax(html)) return html.length;
  return stripHtml(html).length;
}

/** True when a rich-text field's raw HTML is over `MENTORSHIP_RICH_TEXT_RAW_MAX`, so its plain-text count is not computed. */
export function isMentorshipRichTextOverRawMax(html: string): boolean {
  return html.length > MENTORSHIP_RICH_TEXT_RAW_MAX;
}

/**
 * Plain text as the rich editor's HTML: `''` for blank input; otherwise CRLF and lone CR are
 * normalised, the text is trimmed, each non-blank line becomes an escaped `<p>` and a run of blank
 * lines becomes ONE `<p><br></p>`. That shape round-trips through `htmlClipboardToText`, which
 * turns `<br>` and `</p>` into newlines and collapses three or more to two. Escaping means a
 * caller can never store markup through this path.
 */
export function mentorshipPlainTextToHtml(text: string | null | undefined): string {
  const normalized = normalizeMentorshipPlainText(text);
  if (!normalized) return '';

  const paragraphs: string[] = [];
  let previousBlank = false;
  for (const line of normalized.split('\n')) {
    const blank = isBlank(line);
    if (blank && !previousBlank) paragraphs.push('<p><br></p>');
    if (!blank) paragraphs.push(`<p>${escapeHtml(line)}</p>`);
    previousBlank = blank;
  }
  return paragraphs.join('');
}

/** CRLF and lone CR to LF, then trimmed. Both sides of the introduction comparison go through it. */
function normalizeMentorshipPlainText(text: string | null | undefined): string {
  return (text ?? '').replace(/\r\n?/g, '\n').trim();
}

function cleanMentorshipSkillList(skills: readonly string[] | null | undefined): string[] {
  return (skills ?? []).map((skill) => skill.trim()).filter((skill) => skill !== '');
}

function isSameMentorshipList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

/**
 * The changed groups of a mentee profile edit, or `{}` when nothing changed. `introduction` is
 * omitted when it equals `seededIntroduction` once both go through the same CRLF and trim
 * normalisation, so an untouched introduction is never sent (and its stored rich text is never
 * rewritten as plain paragraphs). `skillSet` is present when the skills (trimmed, blanks dropped,
 * order-sensitive) or the trimmed notes differ from `seed`, and then always carries all three
 * fields, since upstream replaces the whole column. Never emits demographics or socioeconomics.
 */
export function buildMentorshipMenteeProfileUpdate(
  seed: MentorshipMenteeProfileDetails,
  seededIntroduction: string,
  value: MentorshipMenteeProfileFormValue
): MentorshipMenteeProfileUpdateRequest {
  const request: MentorshipMenteeProfileUpdateRequest = {};

  const introduction = normalizeMentorshipPlainText(value.introduction);
  if (introduction !== normalizeMentorshipPlainText(seededIntroduction)) {
    request.introduction = introduction;
  }

  const skillsHave = cleanMentorshipSkillList(value.skillsHave);
  const skillsWant = cleanMentorshipSkillList(value.skillsWant);
  const additionalNotes = (value.additionalNotes ?? '').trim();
  const skillsChanged =
    !isSameMentorshipList(skillsHave, cleanMentorshipSkillList(seed.skillsHave)) ||
    !isSameMentorshipList(skillsWant, cleanMentorshipSkillList(seed.skillsWant)) ||
    additionalNotes !== (seed.additionalNotes ?? '').trim();
  if (skillsChanged) {
    request.skillSet = { skillsHave, skillsWant, ...(additionalNotes ? { additionalNotes } : {}) };
  }

  return request;
}

/**
 * The changed groups of a demographics edit, or `{}` when nothing changed. Per row the answer is
 * the trimmed selection when its consent box is checked and blank otherwise (`raw` is
 * `form.getRawValue()`, since the section disables an answer while its consent is off). A stored
 * blank or `preferNotToSay` token and a new blank or `preferNotToSay` answer all count as
 * "no answer", so neither swapping one for the other nor choosing "I don't want to provide" over
 * an unanswered row is a change. A changed row writes its answer, or `preferNotToSay` when consent
 * was withdrawn or no answer was chosen. A group is present only when one of its rows changed and
 * then carries every row: unchanged rows keep their stored token and rows that were never
 * answered are left out. Never emits introduction or skillSet.
 */
export function buildMentorshipMenteeDemographicsUpdate(
  current: MentorshipMenteeDemographics | undefined,
  raw: MentorshipMenteeDemographicsFormValue
): MentorshipMenteeProfileUpdateRequest {
  const request: MentorshipMenteeProfileUpdateRequest = {};

  for (const groupName of Object.keys(MENTORSHIP_MENTEE_DEMOGRAPHIC_GROUPS) as MentorshipMenteeDemographicGroupName[]) {
    const answers: Record<string, string> = {};
    let changed = false;

    for (const key of MENTORSHIP_MENTEE_DEMOGRAPHIC_GROUPS[groupName]) {
      const row = MENTORSHIP_MENTEE_DEMOGRAPHIC_ROWS.find((candidate) => candidate.answerControl === key);
      if (!row) continue;

      const stored = (current?.[key] ?? '').trim();
      const answer = typeof raw[row.answerControl] === 'string' ? (raw[row.answerControl] as string).trim() : '';
      const now = raw[row.consentControl] === true ? answer : '';
      if (mentorshipDemographicAnswer(now) === mentorshipDemographicAnswer(stored)) {
        if (stored) answers[key] = stored;
        continue;
      }
      changed = true;
      answers[key] = now || MENTORSHIP_MENTEE_DEMOGRAPHIC_PREFER_NOT_TO_SAY;
    }

    if (changed) request[groupName] = answers;
  }

  return request;
}

/** A demographic token as the answer it stands for: `preferNotToSay` and blank both mean no answer. */
function mentorshipDemographicAnswer(token: string): string {
  return token === MENTORSHIP_MENTEE_DEMOGRAPHIC_PREFER_NOT_TO_SAY ? '' : token;
}

/** True when no group of the update is present, so there is nothing to send. */
export function isMentorshipMenteeProfileUpdateEmpty(request: MentorshipMenteeProfileUpdateRequest): boolean {
  return MENTORSHIP_MENTEE_PROFILE_UPDATE_KEYS.every((key) => request[key] === undefined);
}

/**
 * Validation message for a required rich-text field, or `undefined` when valid. Over-raw-cap input
 * gets `MENTORSHIP_RICH_TEXT_TOO_LARGE_MESSAGE` rather than a plain-text limit it may not exceed.
 */
function mentorshipRichTextError(html: string, max: number, requiredMessage: string, maxMessage: string): string | undefined {
  if (isMentorshipRichTextOverRawMax(html)) return MENTORSHIP_RICH_TEXT_TOO_LARGE_MESSAGE;
  const length = mentorshipDescriptionLength(html);
  if (length === 0) return requiredMessage;
  if (length > max) return maxMessage;
  return undefined;
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

/**
 * Field-keyed validation errors for a single enroll wizard step.
 *
 * **Note:** The `details` step validates `projectId` against `MOCK_MENTORSHIP_LF_PROJECTS`
 * — a temporary mock-backed allowlist that must be replaced with server-side validation
 * when the upstream mentorship-service project endpoint is wired up (see GH-2717).
 */
export function getMentorshipEnrollStepErrors(step: MentorshipEnrollStep, form: MentorshipEnrollValidationInput): MentorshipEnrollFieldErrors {
  if (step === 'details') {
    const errors: MentorshipEnrollFieldErrors = {};
    if (isBlank(form.name)) {
      errors.name = 'Program name is required.';
    } else if (form.name.trim().length < MENTORSHIP_ENROLL_NAME_MIN || form.name.trim().length > MENTORSHIP_ENROLL_NAME_MAX) {
      errors.name = `Program name should be between ${MENTORSHIP_ENROLL_NAME_MIN} and ${MENTORSHIP_ENROLL_NAME_MAX} characters.`;
    }
    const projectId = form.projectId.trim();
    if (!projectId) {
      errors.projectId = 'Select a Linux Foundation project.';
    } else if (!MOCK_MENTORSHIP_LF_PROJECTS.some((project) => project.id === projectId)) {
      // Temporary mock-backed allowlist — replace with server-side validation
      // when the upstream mentorship-service project endpoint is wired up (GH-2717).
      errors.projectId = 'Select a valid Linux Foundation project.';
    }
    if (!form.technologies.length) errors.technologies = 'Add at least one technology.';
    const descriptionError = mentorshipRichTextError(
      form.description,
      MENTORSHIP_ENROLL_DESCRIPTION_MAX,
      'Program description is required.',
      `Description must be ${MENTORSHIP_ENROLL_DESCRIPTION_MAX} characters or fewer.`
    );
    if (descriptionError) errors.description = descriptionError;
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

export function isMentorshipResumeFileName(fileName: string): boolean {
  const ext = fileName.trim().split('.').pop()?.toLowerCase() ?? '';
  return (MENTORSHIP_MENTOR_RESUME_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Validates the Become a Mentor form.
 *
 * Two things a mentor supplies are deliberately unvalidated. Program requests are
 * optional: a mentor may register a profile now and apply to programs later, so the
 * request list is not checked here and does not reach this function at all. The resume
 * is optional too, and its picker rejects a bad type or an oversized file at selection
 * time rather than letting either reach submit.
 */
export function getMentorshipMentorRegisterErrors(form: MentorshipMentorRegisterForm): MentorshipMentorRegisterFieldErrors {
  const errors: MentorshipMentorRegisterFieldErrors = {};

  const introductionError = mentorshipRichTextError(
    form.introduction,
    MENTORSHIP_MENTOR_INTRODUCTION_MAX,
    'Introduction is required.',
    `Introduction must be ${MENTORSHIP_MENTOR_INTRODUCTION_MAX} characters or fewer.`
  );
  if (introductionError) errors.introduction = introductionError;
  if (!form.skills.length) errors.skills = 'Add at least one skill.';
  if (!isMentorshipTermsAccepted(form.complianceAccepted)) errors.complianceAccepted = 'Please confirm the compliance statement.';
  if (!isMentorshipTermsAccepted(form.termsAccepted)) errors.termsAccepted = 'Please accept the terms and conditions.';

  return errors;
}

function trimmedParam(params: { get(name: string): string | null }, name: string): string {
  return params.get(name)?.trim() ?? '';
}

/**
 * Both apply-link ids, or `null` when either query param is missing or blank.
 * Callers that navigate back to `/mentorship/mentee/apply` use this so a partial
 * link is not treated as a complete return target.
 */
export function mentorshipMenteeApplyIds(params: { get(name: string): string | null }): MentorshipMenteeApplyIds | null {
  const programId = trimmedParam(params, 'programId');
  const programTermId = trimmedParam(params, 'programTermId');
  if (!programId || !programTermId) return null;
  return { programId, programTermId };
}

/**
 * Copies whichever apply-link ids are present. The register redirect uses this
 * so a refresh of the register page keeps `programId` and `programTermId` in
 * the address bar even when only one of them arrived.
 */
export function mentorshipMenteeApplyQueryParams(params: { get(name: string): string | null }): Partial<MentorshipMenteeApplyIds> {
  const programId = trimmedParam(params, 'programId');
  const programTermId = trimmedParam(params, 'programTermId');
  const queryParams: Partial<MentorshipMenteeApplyIds> = {};
  if (programId) queryParams.programId = programId;
  if (programTermId) queryParams.programTermId = programTermId;
  return queryParams;
}

/**
 * Empty seed for the Become a Mentee form. Kept beside the validator so
 * form-shape drift stays in one place — the field list here must line up with
 * the checks in `getMentorshipMenteeRegisterErrors`. Lives in `utils/` (not
 * `constants/`) because it is a factory that returns a fresh object per call,
 * per `docs/architecture/shared/package-architecture.md`.
 */
export function createEmptyMentorshipMenteeForm(): MentorshipMenteeRegisterForm {
  return {
    introduction: '',
    skillsHave: [],
    skillsWant: [],
    additionalNotes: '',
    resumeFileName: '',
    ageConsent: false,
    age: '',
    raceEthnicityConsent: false,
    raceEthnicity: '',
    genderConsent: false,
    gender: '',
    incomeConsent: false,
    income: '',
    educationConsent: false,
    education: '',
    ageEligible: false,
    workAuthorized: false,
    noDuplicateProfile: false,
    complianceAccepted: false,
    termsAccepted: false,
  };
}

/**
 * Validates the Become a Mentee form.
 *
 * Both skills fields are required: `skillsHave` describes what the mentee brings and
 * `skillsWant` describes what they want to grow, and both sides feed the mentor-match.
 * The demographic fields (age, gender, income, education) are never checked here: each
 * is optional and gated behind its own consent checkbox, so declining one is a valid
 * answer rather than an error. The resume is optional too, and validated at selection
 * time by its picker, same as the mentor form.
 */
export function getMentorshipMenteeRegisterErrors(form: MentorshipMenteeRegisterForm): MentorshipMenteeRegisterFieldErrors {
  const errors: MentorshipMenteeRegisterFieldErrors = {};

  const introductionError = mentorshipRichTextError(
    form.introduction,
    MENTORSHIP_MENTEE_INTRODUCTION_MAX,
    'Introduction is required.',
    `Introduction must be ${MENTORSHIP_MENTEE_INTRODUCTION_MAX} characters or fewer.`
  );
  if (introductionError) errors.introduction = introductionError;
  if (!form.skillsHave.length) errors.skillsHave = 'Add at least one skill you currently have.';
  if (!form.skillsWant.length) errors.skillsWant = 'Add at least one skill you would like to improve.';
  if (!isMentorshipTermsAccepted(form.ageEligible)) errors.ageEligible = 'Please confirm you are 18 years of age or older.';
  if (!isMentorshipTermsAccepted(form.workAuthorized)) errors.workAuthorized = 'Please confirm you are authorized to work in your country of residence.';
  if (!isMentorshipTermsAccepted(form.noDuplicateProfile)) errors.noDuplicateProfile = 'Please confirm you do not already have a mentee profile.';
  if (!isMentorshipTermsAccepted(form.complianceAccepted)) errors.complianceAccepted = 'Please confirm the compliance statement.';
  if (!isMentorshipTermsAccepted(form.termsAccepted)) errors.termsAccepted = 'Please accept the terms and conditions.';

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

export function isMentorshipEnrollStepValid(step: MentorshipEnrollStep, form: MentorshipEnrollValidationInput): boolean {
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
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

export function toMentorshipDateOnly(value: Date): string {
  return toLocalDateOnlyString(value);
}

export function buildMentorshipProgramTabCounts(lists: MentorshipProgramLists): MentorshipProgramTabCounts {
  return {
    mentees: lists.mentees.length,
    applicants: lists.applicants.length,
    mentors: lists.mentors.length,
    terms: lists.terms.length,
  };
}

/**
 * The mentees the program's first tab can show, which is a narrower set than
 * "everyone who is not an applicant".
 *
 * A live program lists the mentees actually taking part — `accepted`, plus the
 * `graduated` ones who finished early. A completed program lists how each
 * participation ended: `withdrawn`, `declined` or `graduated`. `accepted` is
 * deliberately absent from that second set, because closing a program requires
 * every accepted mentee to have been graduated or declined first, so an
 * `accepted` mentee on a completed program is a state the domain does not
 * produce rather than a row to render.
 *
 * A mentee who withdraws or is declined mid-program is therefore not shown while
 * the program is still running, and appears on Past Mentees once it completes.
 * That is intended: the live tab answers "who is taking part", not "who ever was".
 */
export function mentorshipMenteesForProgram(mentees: MentorshipProgramMentee[], isCompleted: boolean): MentorshipProgramMentee[] {
  const statuses = isCompleted ? MENTORSHIP_PAST_MENTEE_STATUSES : MENTORSHIP_CURRENT_MENTEE_STATUSES;
  return mentees.filter((person) => statuses.includes(person.status));
}

/**
 * Scopes the mentee list to the tab that will render it *before* the counts are
 * taken, so the badge can never promise a row the tab does not show.
 */
export function buildMentorshipProgramDetail(program: MentorshipProgram, lists: MentorshipProgramLists): MentorshipProgramDetail {
  const scoped: MentorshipProgramLists = {
    ...lists,
    mentees: mentorshipMenteesForProgram(lists.mentees, program.status === 'completed'),
  };

  return {
    program,
    tabCounts: buildMentorshipProgramTabCounts(scoped),
    ...scoped,
  };
}

export function mentorshipMentorSubmittedTaskCount(mentees: MentorshipProgramMentee[]): number {
  return mentees.reduce((count, mentee) => count + (mentee.tasks ?? []).filter((task) => task.status === 'submitted').length, 0);
}

export function buildMentorshipMentorProgramTabCounts(lists: MentorshipMentorProgramLists): MentorshipMentorProgramTabCounts {
  return {
    tasks: mentorshipMentorSubmittedTaskCount(lists.mentees),
    mentees: lists.mentees.length,
    applicants: lists.applicants.length,
  };
}

export function buildMentorshipMentorProgramDetail(program: MentorshipMentorProgram, lists: MentorshipMentorProgramLists): MentorshipMentorProgramDetail {
  return {
    program,
    tabCounts: buildMentorshipMentorProgramTabCounts(lists),
    ...lists,
  };
}

/**
 * Flatten current-mentee tasks the mentor Tasks tab can show: `submitted` (Awaiting
 * Review) and `completed` (Approved). Newest `updatedOn` first.
 */
export function mentorshipMentorReviewTasks(mentees: MentorshipProgramMentee[]): MentorshipMentorReviewTask[] {
  const rows: MentorshipMentorReviewTask[] = [];

  for (const mentee of mentees) {
    for (const task of mentee.tasks ?? []) {
      if (task.status !== 'submitted' && task.status !== 'completed') continue;
      rows.push({
        id: `${mentee.id}__${task.id}`,
        menteeId: mentee.id,
        menteeName: mentee.name,
        menteeEmail: mentee.email,
        avatarUrl: mentee.avatarUrl,
        taskName: task.name,
        description: task.description,
        status: task.status,
        termName: mentee.termName,
        updatedOn: task.updatedOn,
        hasSubmission: !!task.hasSubmission,
      });
    }
  }

  return rows.sort((left, right) => right.updatedOn.localeCompare(left.updatedOn));
}

/**
 * Relative `updatedOn` copy for a Tasks-tab card. Delegates to `formatRelativeTime`
 * for the shared bucketing, then layers the `Yesterday` alias and long-form hours
 * phrasing on top so the subtitle matches the design.
 */
export function formatMentorshipReviewUpdatedLabel(iso: string): string {
  // Date-only strings (`YYYY-MM-DD`) are parsed as UTC midnight by the Date
  // constructor. Append `T00:00:00Z` to keep them in UTC so the result is
  // identical on the SSR server and the browser (no hydration mismatch).
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00Z` : iso;
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) return 'unknown';

  const diffMs = Date.now() - date.getTime();
  const diffDay = Math.floor(diffMs / 86_400_000);
  if (diffDay === 1) return 'Yesterday';

  const base = formatRelativeTime(date);

  // Expand the short `N hr ago` phrasing to `N hours ago` for the Tasks-tab design.
  const hrMatch = /^(\d+) hr ago$/.exec(base);
  if (hrMatch) {
    return hrMatch[1] === '1' ? '1 hour ago' : `${hrMatch[1]} hours ago`;
  }

  return base;
}

/** Case-insensitive match on name or email. Empty search matches everyone. */
export function matchesMentorshipPersonSearch(person: MentorshipProgramMentee | MentorshipProgramMentor, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return person.name.toLowerCase().includes(needle) || person.email.toLowerCase().includes(needle);
}

/**
 * Whether every prerequisite task has been submitted. A person with no tasks assigned
 * has not completed anything, so an empty assignment is never "complete".
 */
function mentorshipPrerequisitesComplete(person: MentorshipApplicationProgress): boolean {
  const total = person.tasksTotal ?? 0;
  return total > 0 && (person.tasksSubmitted ?? 0) >= total;
}

/**
 * Status to show for an application. It stays `pending` on the wire while the mentee
 * works through the prerequisites, so the tab reads that as `applied` until every task
 * is in and `tasks-completed` once they are. Every other status displays as-is.
 *
 * Takes the progress fields rather than a whole row so a cross-program application,
 * which carries the same three fields and nothing else, derives its label the same way.
 */
export function mentorshipApplicantDisplayStatus(application: MentorshipApplicationProgress): MentorshipApplicantDisplayStatus {
  if (application.status !== 'pending') return application.status;
  return mentorshipPrerequisitesComplete(application) ? 'tasks-completed' : 'applied';
}

/**
 * Term filter options for a program-detail tab, derived from the rows themselves — a
 * program's terms are whichever ones its people took part in.
 */
export function mentorshipTermFilterOptions(people: { termName: string }[], allLabel: string): FilterOption[] {
  const terms = [...new Set(people.map((person) => person.termName))];
  return [{ label: allLabel, value: null }, ...terms.map((term) => ({ label: term, value: term }))];
}

/**
 * Row actions offered for an application's current status on the Applicants tab. Each
 * action moves the application to the same-named status, so the one it already holds is
 * never offered, and a mentee who has already graduated can no longer be accepted.
 */
export function mentorshipApplicantActionsFor(status: MentorshipMenteeStatus): MentorshipApplicantAction[] {
  return MENTORSHIP_APPLICANT_ACTIONS.filter((action) => {
    if (action === status) return false;
    return action !== 'accepted' || status !== 'graduated';
  });
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

/**
 * Progress the mentor Mentees tab shows as a bar plus percent. Counts
 * `status === 'completed'` on the embedded `tasks` list, excluding prerequisites
 * so the bar matches the default View Tasks panel (`hidePrerequisite`).
 * `tasksSubmitted` / `tasksTotal` are never used. Without measurable tasks,
 * `{ total: 0 }` means unavailable — callers should render a dash, not `0%`.
 */
export function mentorshipMenteeTaskCompletion(mentee: Pick<MentorshipProgramMentee, 'tasks'>): {
  completed: number;
  total: number;
  percent: number;
} {
  const assigned = (mentee.tasks ?? []).filter((task) => !task.prerequisite);
  if (!assigned.length) return { completed: 0, total: 0, percent: 0 };

  const total = assigned.length;
  const completed = assigned.filter((task) => task.status === 'completed').length;
  return { completed, total, percent: Math.round((completed / total) * 100) };
}

/** Whether a program-detail mentee row should offer the View Tasks expansion. */
export function mentorshipApplicantHasTasks(mentee: Pick<MentorshipProgramMentee, 'tasks' | 'tasksTotal'>): boolean {
  if (mentee.tasks?.length) return true;
  return (mentee.tasksTotal ?? 0) > 0;
}

/** Due-date copy for one applicant task row. */
export function formatMentorshipApplicantTaskDueLabel(task: Pick<MentorshipApplicantTask, 'prerequisite' | 'dueOn'>): string {
  if (task.dueOn) return formatIsoDateLabel(task.dueOn);
  if (task.prerequisite) return MENTORSHIP_APPLICANT_TASK_DUE_PREREQUISITE_LABEL;
  return '—';
}

/** Optionally hide prerequisite tasks in the expanded tasks panel. */
export function filterMentorshipApplicantTasks<T extends MentorshipApplicantTask>(tasks: ReadonlyArray<T>, hidePrerequisite: boolean): T[] {
  if (!hidePrerequisite) return [...tasks];
  return tasks.filter((task) => !task.prerequisite);
}

/** Resolve applicant task rows for the expanded tasks sub-table. */
export function mentorshipApplicantTaskRows(tasks: ReadonlyArray<MentorshipApplicantTask>): MentorshipApplicantTaskRow[] {
  return tasks.map((task) => ({
    ...task,
    statusLabel: MENTORSHIP_APPLICANT_TASK_STATUS_LABELS[task.status],
    statusBadgeClass: MENTORSHIP_APPLICANT_TASK_STATUS_BADGE_CLASSES[task.status],
    createdLabel: formatIsoDateLabel(task.createdOn),
    dueLabel: formatMentorshipApplicantTaskDueLabel(task),
    updatedLabel: formatIsoDateLabel(task.updatedOn),
    canView: !!task.hasSubmission,
    canDownload: !!task.hasSubmission,
  }));
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

/**
 * Resolves a row's action statuses into what its menu renders. Each tab has its own
 * action union and its own label and icon maps, so this takes them as arguments rather
 * than choosing; the shape it returns is what `lfx-mentorship-row-actions` consumes.
 */
export function mentorshipRowActions<T extends string>(actions: readonly T[], labels: Record<T, string>, icons: Record<T, string>): MentorshipRowAction[] {
  return actions.map((action) => ({ label: labels[action], icon: icons[action] }));
}

/**
 * The reviewer-note line for a row. A draft edited this session wins over the note the
 * row arrived with, whitespace alone counts as no note, and an absent note falls back
 * to the "Add note" prompt. Shared so the tabs cannot disagree on what a note is.
 */
export function mentorshipNoteDisplay(drafts: Record<string, string>, person: { id: string; note?: string }, addLabel: string): MentorshipNoteDisplay {
  const note = (drafts[person.id] ?? person.note ?? '').trim();
  return { hasNote: note.length > 0, noteLabel: note.length > 0 ? note : addLabel };
}

/**
 * Deterministic avatar tint for a person, seeded from their display name so the
 * same person keeps the same colour across every program-detail tab.
 */
export function mentorshipPersonAvatarClass(name: string): string {
  const seed = name.length > 0 ? name.charCodeAt(0) : 0;
  return MENTORSHIP_PROGRAM_AVATAR_PALETTE[seed % MENTORSHIP_PROGRAM_AVATAR_PALETTE.length];
}

/** Two-letter initials from the first two whitespace-delimited tokens, e.g. "Alex Rivera" → "AR". */
export function mentorshipPersonInitials(name: string): string {
  const tokens = name.trim().split(/\s+/);
  if (tokens.length === 0 || tokens[0].length === 0) return '?';
  const first = tokens[0][0];
  const second = tokens[1]?.[0] ?? tokens[0][1] ?? '';
  return (first + second).toUpperCase();
}

// ---------------------------------------------------------------------------
// Mentee tasks tab — task/application view models
// ---------------------------------------------------------------------------

/**
 * Normalise a task status to a status-dropdown value. The dropdown only offers
 * `pending` / `in_progress` / `submitted`, so the two backend aliases collapse:
 * `incomplete` → `pending` and `complete` → `submitted` (both display the same).
 *
 * The parameter is typed to the status union, so the `default` branch is a
 * runtime guard for values that reach here without compile-time checking — an
 * unvalidated BFF payload or a cast — mapping them to `pending` rather than
 * letting an unknown status render blank/unstyled.
 */
export function normalizeMentorshipMenteeTaskStatus(status: MentorshipMenteeTaskStatus): MentorshipMenteeTaskStatus {
  switch (status) {
    case 'incomplete':
      return 'pending';
    case 'complete':
      return 'submitted';
    case 'pending':
    case 'in_progress':
    case 'submitted':
      return status;
    default:
      return 'pending';
  }
}

/** Count tasks in a submitted/complete state. */
export function countSubmittedMentorshipMenteeTasks(tasks: readonly { status: MentorshipMenteeTaskStatus }[]): number {
  return tasks.filter((task) => task.status === 'submitted' || task.status === 'complete').length;
}

/**
 * The status-derived fields of a task row, from the normalised status. Shared by `buildMentorshipMenteeTaskView`
 * and the row's saved-status override, so the icon and pill always match the status the dropdown shows.
 */
export function mentorshipMenteeTaskStatusFields(
  rawStatus: MentorshipMenteeTaskStatus
): Pick<MentorshipMenteeTaskView, 'status' | 'submitted' | 'inProgress' | 'statusClass'> {
  const status = normalizeMentorshipMenteeTaskStatus(rawStatus);
  return {
    status,
    submitted: status === 'submitted',
    inProgress: status === 'in_progress',
    statusClass: MENTORSHIP_MENTEE_TASK_STATUS_CLASSES[status],
  };
}

/**
 * Build a display-ready task row from the fields both mentee phases share, so the
 * template reads flat fields instead of recomputing presentation logic in bindings.
 * `submitFile` is `null` (no submission), `'required'` (needs upload), or a URL
 * (file already uploaded).
 */
export function buildMentorshipMenteeTaskView(input: {
  id: string;
  title: string;
  description: string;
  status: MentorshipMenteeTaskStatus;
  submitFile: string | null;
  fileUrl?: string;
  dueDate?: string;
  submittedDate?: string;
}): MentorshipMenteeTaskView {
  // Normalise once so an unrecognised runtime status resolves to a real option
  // for `status`, `statusClass`, `submitted`, and `inProgress` alike — otherwise
  // it would read as `pending` in the dropdown yet render unstyled and vanish
  // under the Pending filter (which matches on the normalised status).
  const statusFields = mentorshipMenteeTaskStatusFields(input.status);
  const hasUploadedFile = (input.submitFile === 'required' && !!input.fileUrl) || (!!input.submitFile && input.submitFile !== 'required');
  // The uploaded-file URL can live on either `fileUrl` or directly on `submitFile`
  // (the documented `null` / `'required'` / URL contract). Fall back to `submitFile`
  // so View/Download render for the URL-on-submitFile shape too.
  const submitFileUrl = input.submitFile && input.submitFile !== 'required' ? input.submitFile : null;
  return {
    id: input.id,
    title: input.title,
    description: input.description,
    ...statusFields,
    hasUploadedFile,
    needsUpload: input.submitFile === 'required' && !input.fileUrl,
    // Raw stored file, not the `fileUrl` display fallback: upstream reads the stored `file` when a request sends none.
    requiresFile: !!input.submitFile && !input.fileUrl,
    fileUrl: input.fileUrl ?? submitFileUrl,
    dueDate: input.dueDate ?? null,
    submittedDate: input.submittedDate ?? null,
  };
}

/** Whether a value is a status a mentee may request (`in_progress` or `submitted`). Narrows for the controller and the row. */
export function isMentorshipMenteeUpdatableTaskStatus(value: unknown): value is MentorshipMenteeUpdatableTaskStatus {
  return MENTORSHIP_MENTEE_UPDATABLE_TASK_STATUSES.includes(value as MentorshipMenteeUpdatableTaskStatus);
}

/**
 * Status dropdown state for one task row. A mentee can only move `pending → in_progress` and
 * `in_progress → submitted`, so the current option stays enabled, the legal next move is enabled
 * and every other option is disabled. A submitted (or complete) task is locked. `submitted` is also
 * disabled while the task requires a file that is not stored yet, since the BFF never sends `file`.
 * The hint explains a disabled forward move or a locked row; only the file-required hint shows on screen.
 */
export function getMentorshipMenteeTaskStatusOptions(task: MentorshipMenteeTaskView): MentorshipMenteeTaskStatusOptionsState {
  const status = normalizeMentorshipMenteeTaskStatus(task.status);
  const withDisabled = (isDisabled: (value: MentorshipMenteeTaskStatus) => boolean): MentorshipMenteeTaskStatusOptionsState['options'] =>
    MENTORSHIP_MENTEE_TASK_STATUS_OPTIONS.map((option) => ({ ...option, disabled: isDisabled(option.value) }));

  if (status === 'submitted') {
    return { options: withDisabled(() => true), locked: true, hint: MENTORSHIP_MENTEE_TASK_HINT_LOCKED, hintVisible: false };
  }
  if (status === 'in_progress') {
    const fileBlocked = task.requiresFile;
    return {
      options: withDisabled((value) => value === 'pending' || (value === 'submitted' && fileBlocked)),
      locked: false,
      hint: fileBlocked ? MENTORSHIP_MENTEE_TASK_HINT_FILE_REQUIRED : null,
      hintVisible: fileBlocked,
    };
  }
  return { options: withDisabled((value) => value === 'submitted'), locked: false, hint: MENTORSHIP_MENTEE_TASK_HINT_START_FIRST, hintVisible: false };
}

/**
 * Display status of a pending, accepted or graduated application: accepted → `active`;
 * graduated → `graduated`; pending with every prerequisite task submitted (or none assigned) →
 * `awaiting-review`; otherwise `in-progress`, including a pending application whose tasks were not
 * read. Returns `null` for every other stored status, since those rows belong in Past Applications.
 */
export function mentorshipMenteeDisplayStatus(app: MentorshipMenteeApplication): MentorshipMenteeApplicationStatus | null {
  if (app.upstreamStatus === 'accepted') return 'active';
  if (app.upstreamStatus === 'graduated') return 'graduated';
  if (app.upstreamStatus !== 'pending') return null;
  // Unread tasks are unknown, not none assigned, so the application is not yet awaiting review.
  if (!app.tasks) return 'in-progress';
  const tasks = mentorshipMenteeProgressTasks(app);
  return countSubmittedMentorshipMenteeTasks(tasks) === tasks.length ? 'awaiting-review' : 'in-progress';
}

/**
 * Tasks an application card tracks: the non-prerequisite tasks once accepted or graduated, the
 * prerequisite tasks while pending.
 */
export function mentorshipMenteeProgressTasks(app: MentorshipMenteeApplication): MentorshipMenteeApplicationTask[] {
  const wantPrerequisite = !isMentorshipMenteeAccepted(app);
  return (app.tasks ?? []).filter((task) => (task.category === 'prerequisite') === wantPrerequisite);
}

/** Build the card for a pending, accepted or graduated application with its display status. */
export function buildMentorshipMenteeApplicationView(
  app: MentorshipMenteeApplication,
  status: MentorshipMenteeApplicationStatus
): MentorshipMenteeApplicationView {
  const tasks = mentorshipMenteeProgressTasks(app);
  const submittedCount = countSubmittedMentorshipMenteeTasks(tasks);
  const totalCount = tasks.length;
  return {
    id: app.id,
    programName: app.programName,
    projectName: app.projectName,
    termName: app.term.name,
    programLogoUrl: app.programLogoUrl,
    status,
    accepted: isMentorshipMenteeAccepted(app),
    statusLabel: MENTORSHIP_MENTEE_APPLICATION_STATUS_LABELS[status],
    statusBadgeClass: MENTORSHIP_MENTEE_APPLICATION_STATUS_CLASSES[status],
    progressLabel: MENTORSHIP_MENTEE_APPLICATION_PROGRESS_LABELS[status],
    submittedCount,
    totalCount,
    progressPercent: totalCount > 0 ? Math.round((submittedCount / totalCount) * 100) : 0,
    lastUpdatedOn: latestIsoInstant([app.updatedOn, ...(app.tasks ?? []).map((task) => task.updatedOn)]),
    decisionExpectedDate: isMentorshipMenteeAccepted(app) ? null : (app.decisionExpectedDate ?? null),
    tasks: tasks.map((task) =>
      buildMentorshipMenteeTaskView({
        id: task.id,
        title: task.name,
        description: task.description,
        status: task.status,
        submitFile: task.submitFile,
        fileUrl: task.fileUrl,
        dueDate: task.dueDate,
        submittedDate: task.submittedOn,
      })
    ),
  };
}

/**
 * Derive the mentee overview from the mentee's applications. Pending, accepted and graduated
 * applications become cards ordered active → graduated → awaiting review → in progress; declined, withdrawn
 * and held applications become Past Applications rows, newest first.
 */
export function buildMentorshipMenteeOverview(applications: readonly MentorshipMenteeApplication[]): MentorshipMenteeOverview {
  const cards: MentorshipMenteeApplicationView[] = [];
  const past: MentorshipMenteePastApplication[] = [];
  for (const app of applications) {
    const status = mentorshipMenteeDisplayStatus(app);
    if (status) {
      cards.push(buildMentorshipMenteeApplicationView(app, status));
      continue;
    }
    const outcome = MENTORSHIP_MENTEE_PAST_OUTCOME_BY_STATUS[app.upstreamStatus];
    if (outcome) {
      past.push({
        id: app.id,
        programName: app.programName,
        projectName: app.projectName,
        termName: app.term.name,
        createdOn: app.createdOn,
        outcome,
        outcomeLabel: MENTORSHIP_MENTEE_PAST_OUTCOME_LABELS[outcome],
        outcomeBadgeClass: MENTORSHIP_MENTEE_PAST_OUTCOME_CLASSES[outcome],
      });
    }
  }
  cards.sort((a, b) => MENTORSHIP_MENTEE_APPLICATION_STATUS_ORDER.indexOf(a.status) - MENTORSHIP_MENTEE_APPLICATION_STATUS_ORDER.indexOf(b.status));
  past.sort((a, b) => isoInstantMs(b.createdOn) - isoInstantMs(a.createdOn));
  return {
    phase: applications.length > 0 ? 'applicant' : 'empty',
    pendingCount: applications.filter((app) => app.upstreamStatus === 'pending').length,
    openTaskCount: cards.reduce((sum, card) => sum + card.totalCount - card.submittedCount, 0),
    cards,
    past,
  };
}

/** A graduated application acts as an accepted one: its card tracks the non-prerequisite tasks. */
function isMentorshipMenteeAccepted(app: MentorshipMenteeApplication): boolean {
  return app.upstreamStatus === 'accepted' || app.upstreamStatus === 'graduated';
}

/** Milliseconds for an ISO instant; an unparseable value sorts as the oldest. */
function isoInstantMs(value: string): number {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

/** The latest of several ISO instants, returned as given. */
function latestIsoInstant(values: readonly string[]): string {
  return values.reduce((latest, value) => (isoInstantMs(value) > isoInstantMs(latest) ? value : latest));
}
