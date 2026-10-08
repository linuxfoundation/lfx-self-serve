// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MONTH_OPTIONS } from '../constants/profile.constants';
import {
  MENTORSHIP_CII_INVALID_ID,
  MENTORSHIP_CHALLENGE_URL_REQUIRED,
  MENTORSHIP_CUSTOM_PREREQ_DESCRIPTION_MAX,
  MENTORSHIP_CUSTOM_PREREQ_NAME_MAX,
  createDefaultMentorshipTerm,
  createEmptyMentorshipEnrollForm,
  MENTORSHIP_ENROLL_CURRENT_LOGO_LABEL,
  MENTORSHIP_ENROLL_DESCRIPTION_MAX,
  MENTORSHIP_ENROLL_LOGO_EMPTY,
  MENTORSHIP_ENROLL_LOGO_EXTENSIONS,
  MENTORSHIP_ENROLL_LOGO_MAX_BYTES,
  MENTORSHIP_ENROLL_LOGO_MIME_TYPES,
  MENTORSHIP_ENROLL_LOGO_TOO_LARGE,
  MENTORSHIP_ENROLL_LOGO_TYPE_ERROR,
  MENTORSHIP_ENROLL_NAME_MAX,
  MENTORSHIP_ENROLL_NAME_MIN,
  MENTORSHIP_ENROLL_PROJECT_REQUIRED,
  MENTORSHIP_INVALID_URL,
  MENTORSHIP_MAX_OPEN_TERMS,
  MENTORSHIP_MAX_OPEN_TERMS_MESSAGE,
  MENTORSHIP_RICH_TEXT_RAW_MAX,
  MENTORSHIP_RICH_TEXT_TOO_LARGE_MESSAGE,
  MENTORSHIP_SKILL_OPTIONS,
  MENTORSHIP_TERM_NAME_MAX,
} from '../constants/mentorship-enroll.constants';
import {
  MENTORSHIP_MENTEE_APPLICATION_PROGRESS_LABELS,
  MENTORSHIP_MENTEE_APPLICATION_STATUS_CLASSES,
  MENTORSHIP_MENTEE_APPLICATION_STATUS_LABELS,
  MENTORSHIP_MENTEE_APPLICATION_STATUS_ORDER,
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
  MENTORSHIP_MENTEE_COUNTRY_CODES,
  MENTORSHIP_MENTEE_COUNTRY_REQUIRED_MESSAGE,
  MENTORSHIP_MENTEE_COUNTRY_UNKNOWN_MESSAGE,
  MENTORSHIP_MENTEE_DEMOGRAPHIC_GROUPS,
  MENTORSHIP_MENTEE_DEMOGRAPHIC_PREFER_NOT_TO_SAY,
  MENTORSHIP_MENTEE_DEMOGRAPHIC_ROWS,
  MENTORSHIP_MENTEE_INTRODUCTION_MAX,
  MENTORSHIP_MENTEE_PAST_OUTCOME_BY_STATUS,
  MENTORSHIP_MENTEE_PAST_OUTCOME_CLASSES,
  MENTORSHIP_MENTEE_PAST_OUTCOME_LABELS,
  MENTORSHIP_MENTEE_PROFILE_SKILLS_LIMIT_MESSAGE,
  MENTORSHIP_MENTEE_PROFILE_SKILLS_MAX_ITEMS,
  MENTORSHIP_MENTEE_PROFILE_UPDATE_KEYS,
  MENTORSHIP_MENTEE_TASK_HINT_FILE_REQUIRED,
  MENTORSHIP_MENTEE_TASK_HINT_LOCKED,
  MENTORSHIP_MENTEE_TASK_HINT_PAST_DUE,
  MENTORSHIP_MENTEE_TASK_HINT_START_FIRST,
  MENTORSHIP_MENTEE_TASK_STATUS_CLASSES,
  MENTORSHIP_MENTEE_TASK_STATUS_OPTIONS,
  MENTORSHIP_MENTEE_UPDATABLE_TASK_STATUSES,
} from '../constants/mentorship-mentee.constants';
import {
  MENTORSHIP_MENTOR_INTRODUCTION_MAX,
  MENTORSHIP_MENTOR_INVITE_TOKEN_MAX_LENGTH,
  MENTORSHIP_MENTOR_PROFILE_UPDATE_KEYS,
  MENTORSHIP_MENTOR_TASK_REVIEW_DECISIONS,
} from '../constants/mentorship-mentor.constants';
import {
  MENTORSHIP_ADMIN_GRADUATE_TASK_WARNING_SINGULAR_TEMPLATE,
  MENTORSHIP_ADMIN_GRADUATE_TASK_WARNING_TEMPLATE,
  MENTORSHIP_APPLICANT_TASK_DUE_PREREQUISITE_LABEL,
  MENTORSHIP_APPLICANT_TASK_STATUS_BADGE_CLASSES,
  MENTORSHIP_APPLICANT_TASK_STATUS_LABELS,
  MENTORSHIP_PROGRAM_AVATAR_PALETTE,
  MENTORSHIP_PROGRAM_DETAIL_TABS,
  MENTORSHIP_REGISTER_ERROR_CONFLICT,
  MENTORSHIP_REGISTER_ERROR_FALLBACK,
  MENTORSHIP_REGISTER_ERROR_READ_ONLY,
  MENTORSHIP_REGISTER_ERROR_UNKNOWN_SKILL,
} from '../constants/mentorship.constants';
import type {
  MentorshipApplicantDisplayStatus,
  MentorshipApplicantTask,
  MentorshipApplicantTaskRow,
  MentorshipApplicantTaskStatus,
  MentorshipApplicationProgress,
  MentorshipEnrollCreateRequest,
  MentorshipEnrollCreateTerm,
  MentorshipEnrollEditBaseline,
  MentorshipEnrollFieldErrors,
  MentorshipEnrollForm,
  MentorshipEnrollImport,
  MentorshipEnrollSavedTerm,
  MentorshipEnrollStep,
  MentorshipEnrollUpdateRequest,
  MentorshipEnrollValidationInput,
  MentorshipLfProject,
  MentorshipNoteDisplay,
  MentorshipPrerequisite,
  MentorshipProgramMentee,
  MentorshipProgramTerm,
  MentorshipRegisterFailureOptions,
  MentorshipRegisterSubmitFailure,
  MentorshipRowAction,
  MentorshipTaskFormValue,
  MentorshipTermDateErrors,
} from '../interfaces/mentorship.interface';
import type {
  MentorshipAdminTaskUpdate,
  MentorshipProgramDetailTabDefinition,
  MentorshipProgramMentor,
  MentorshipProgramStatus,
  MentorshipProgramTermRow,
} from '../interfaces/mentorship-admin.interface';
import type {
  MentorshipMentorProfileDetails,
  MentorshipMentorProfileFieldErrors,
  MentorshipMentorProfileUpdateRequest,
  MentorshipMentorProgram,
  MentorshipMentorProgramDetail,
  MentorshipMentorProgramLists,
  MentorshipMentorProgramTabCounts,
  MentorshipMentorReviewTask,
  MentorshipMentorRegisterFieldErrors,
  MentorshipMentorTaskReviewDecision,
  MentorshipMentorRegisterForm,
  MentorshipMentorRegisterRequest,
} from '../interfaces/mentorship-mentor.interface';
import type { MentorshipLfxProfileFields } from '../interfaces/mentorship-lfx-profile-card.interface';
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
  MentorshipMenteeRegisterRequest,
  MentorshipMenteeTaskStatus,
  MentorshipMenteeTaskStatusOptionsState,
  MentorshipMenteeTaskView,
  MentorshipMenteeUpdatableTaskStatus,
} from '../interfaces/mentorship-mentee.interface';
import { formatIsoDateLabel, formatRelativeTime, monthYearToIsoDate, toLocalDateOnlyString } from './date-time.utils';
import { stripHtml } from './html-utils';
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

/**
 * A date-only value (`YYYY-MM-DD`) as the last millisecond of its UTC day, the instant a term's application window closes,
 * so applications stay open through the whole end date. Milliseconds are the finest precision `Date` reads. Any other
 * value comes back unchanged.
 */
export function toMentorshipUtcEndOfDayInstant(value: string): string {
  return MENTORSHIP_ISO_DATE.test(value) ? `${value}T23:59:59.999Z` : value;
}

/**
 * The instant (ms) a task closes: the end of its due date's UTC day, so a task due `2026-09-30` closes at
 * `2026-10-01T00:00:00Z`. Takes a date-only value or an ISO instant (only its UTC calendar day counts);
 * a missing or unparseable due date never closes, so it returns `null`.
 */
export function mentorshipTaskDueCutoffMs(dueDate: string | null | undefined): number | null {
  if (!dueDate) return null;
  const due = new Date(toMentorshipUtcInstant(dueDate));
  if (Number.isNaN(due.getTime())) return null;
  return Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate() + 1);
}

/** Whether a task's due date has passed at `nowMs`, per `mentorshipTaskDueCutoffMs`; a task with no usable due date is never past due. */
export function isMentorshipTaskPastDue(dueDate: string | null | undefined, nowMs: number): boolean {
  const cutoff = mentorshipTaskDueCutoffMs(dueDate);
  return cutoff !== null && nowMs >= cutoff;
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

/**
 * The mentorship site's program listing at `base`, or one program's page when `programId` is given.
 * A trailing `/` on `base` is dropped, so the join never doubles it.
 */
export function buildMentorshipProgramsUrl(base: string, programId?: string): string {
  // A loop rather than a `/\/+$/` replace, which backtracks polynomially on a long run of slashes.
  let end = base.length;
  while (end > 0 && base[end - 1] === '/') end--;
  const programs = `${base.slice(0, end)}/programs`;
  return programId ? `${programs}/${encodeURIComponent(programId)}` : programs;
}

/** The admin program-detail tabs a program shows: a pending program has no mentees or mentors yet, so only Terms. */
export function getMentorshipProgramDetailTabs(status: MentorshipProgramStatus): readonly MentorshipProgramDetailTabDefinition[] {
  return status === 'pending-review' ? MENTORSHIP_PROGRAM_DETAIL_TABS.filter((tab) => tab.value === 'terms') : MENTORSHIP_PROGRAM_DETAIL_TABS;
}

export function isMentorshipLogoFileName(fileName: string): boolean {
  const ext = fileName.trim().split('.').pop()?.toLowerCase() ?? '';
  return (MENTORSHIP_ENROLL_LOGO_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * The message for a logo the wizard, the partial-save banner or the program card refuses to send, or `''` when the file is fine.
 * The upload sends `type` as its Content-Type, so a file whose type is empty or not on the route's list is refused here too.
 */
export function getMentorshipEnrollLogoError(file: { name: string; size: number; type: string }): string {
  if (!isMentorshipLogoFileName(file.name) || !(MENTORSHIP_ENROLL_LOGO_MIME_TYPES as readonly string[]).includes(file.type)) {
    return MENTORSHIP_ENROLL_LOGO_TYPE_ERROR;
  }
  if (file.size === 0) return MENTORSHIP_ENROLL_LOGO_EMPTY;
  if (file.size > MENTORSHIP_ENROLL_LOGO_MAX_BYTES) return MENTORSHIP_ENROLL_LOGO_TOO_LARGE;
  return '';
}

/** Upstream create refuses a single-day application window and one that does not end before the term starts. */
function getMentorshipEnrollTermWindowError(term: Pick<MentorshipProgramTerm, 'startDate' | 'applicationStartDate' | 'applicationEndDate'>): string {
  if (term.applicationEndDate <= term.applicationStartDate) return 'Application end date must be after the application start date.';
  if (term.applicationEndDate >= term.startDate) return 'Application end date must be before the term start month.';
  return '';
}

export function lastDayOfMentorshipMonth(isoMonthStart: string): string {
  const parsed = parseMentorshipMonthYear(isoMonthStart);
  if (!parsed) return isoMonthStart;
  const last = new Date(Number(parsed.year), Number(parsed.month), 0);
  return toMentorshipDateOnly(last);
}

/**
 * The wizard form as the upstream create body. Technologies go to `industry` as one `', '`-joined string and never
 * into `skills`; terms and prerequisites carry no id (upstream generates its own). The caller sends this only once the
 * form says the terms are accepted, so `termsAccepted` is always `true`.
 */
export function toMentorshipEnrollCreateRequest(form: MentorshipEnrollValidationInput, project: MentorshipLfProject): MentorshipEnrollCreateRequest {
  return {
    ...toMentorshipEnrollProgramFields(form, project),
    terms: form.terms.map((term) => toMentorshipEnrollRequestTerm(term)),
    termsAccepted: true,
  };
}

/**
 * The wizard form as the edit wizard's update body: the program fields as create sends them, and the open terms as the program's
 * full set. A term in `saved` keeps its id, so upstream changes that term; while its dates are as loaded it sends the stored dates,
 * not the month-start ones the wizard shows, so editing anything else never moves them. A term the admin added goes without an id
 * and is created, and a saved term left out is deleted. With no open terms, `terms` is left out and upstream keeps them as they are.
 */
export function toMentorshipEnrollUpdateRequest(
  form: MentorshipEnrollValidationInput,
  project: MentorshipLfProject,
  saved: ReadonlyMap<string, MentorshipEnrollSavedTerm>
): MentorshipEnrollUpdateRequest {
  const request: MentorshipEnrollUpdateRequest = toMentorshipEnrollProgramFields(form, project);
  if (form.terms.length) {
    request.terms = form.terms.map((term) => {
      const savedTerm = saved.get(term.id);
      if (!savedTerm) return toMentorshipEnrollRequestTerm(term);
      const datesUnchanged =
        savedTerm.term.startDate === term.startDate &&
        savedTerm.term.endDate === term.endDate &&
        savedTerm.term.applicationStartDate === term.applicationStartDate &&
        savedTerm.term.applicationEndDate === term.applicationEndDate;
      return { id: term.id, ...(datesUnchanged ? { name: term.name.trim(), ...savedTerm.stored } : toMentorshipEnrollRequestTerm(term)) };
    });
  }
  return request;
}

/** A saved open term as the edit wizard keeps it: the term as the form shows it, and the dates upstream holds. */
export function toMentorshipEnrollSavedTerm(
  row: Pick<MentorshipProgramTermRow, 'id' | 'name' | 'startDate' | 'endDate' | 'applicationStartDate' | 'applicationEndDate'>
): MentorshipEnrollSavedTerm {
  return {
    term: toMentorshipEnrollTerm(row),
    stored: { startDate: row.startDate, endDate: row.endDate, applicationStartDate: row.applicationStartDate, applicationEndDate: row.applicationEndDate },
  };
}

/** A wizard term as create and update send it: the name trimmed and the end month as its last day. */
function toMentorshipEnrollRequestTerm(term: MentorshipProgramTerm): MentorshipEnrollCreateTerm {
  return {
    name: term.name.trim(),
    startDate: term.startDate,
    endDate: lastDayOfMentorshipMonth(term.endDate),
    applicationStartDate: term.applicationStartDate,
    applicationEndDate: term.applicationEndDate,
  };
}

/** The program fields create and update share. A blank optional field is left out; the BFF sends an update's as `''`, which clears it. */
function toMentorshipEnrollProgramFields(
  form: MentorshipEnrollValidationInput,
  project: MentorshipLfProject
): Omit<MentorshipEnrollCreateRequest, 'terms' | 'termsAccepted'> {
  const request: Omit<MentorshipEnrollCreateRequest, 'terms' | 'termsAccepted'> = {
    projectId: project.id,
    projectSlug: project.slug,
    projectName: project.name,
    name: form.name.trim(),
    description: form.description,
    repositoryUrl: form.repositoryUrl.trim(),
    skills: uniqueMentorshipList(form.skills),
    prerequisites: form.prerequisites.map((item) => {
      const description = item.description.trim();
      const challengeUrl = item.challengeUrl?.trim();
      return {
        name: item.name.trim(),
        description: challengeUrl ? `${description}\n\nChallenge: ${challengeUrl}` : description,
        required: item.required,
        requireFile: item.requireFile === true,
        dueDate: item.dueDate || null,
      };
    }),
  };

  if (project.logoUrl) request.projectLogoUrl = project.logoUrl;
  const websiteUrl = form.websiteUrl.trim();
  if (websiteUrl) request.websiteUrl = websiteUrl;
  const codeOfConductUrl = form.codeOfConductUrl.trim();
  if (codeOfConductUrl) request.codeOfConductUrl = codeOfConductUrl;
  const ciiProjectId = form.ciiProjectId.trim();
  if (ciiProjectId) request.ciiProjectId = ciiProjectId;
  const industry = uniqueMentorshipList(form.technologies).join(', ');
  if (industry) request.industry = industry;
  return request;
}

/** A saved term as the wizard holds it. The term dialog picks months, so both term dates become the first of their month. */
export function toMentorshipEnrollTerm(
  row: Pick<MentorshipProgramTermRow, 'id' | 'name' | 'startDate' | 'endDate' | 'applicationStartDate' | 'applicationEndDate'>
): MentorshipProgramTerm {
  const toMonthStart = (date: string): string => {
    const parsed = parseMentorshipMonthYear(date);
    return parsed ? mentorshipMonthYearToStartDate(parsed.month, parsed.year) : date;
  };
  return {
    id: row.id,
    name: row.name,
    startDate: toMonthStart(row.startDate),
    endDate: toMonthStart(row.endDate),
    applicationStartDate: row.applicationStartDate,
    applicationEndDate: row.applicationEndDate,
  };
}

/** Whether `after` is the saved term `before` unchanged: the same name (trimmed) and dates. `false` when there is no saved term. */
export function isSameMentorshipTerm(before: MentorshipProgramTerm | undefined, after: MentorshipProgramTerm): boolean {
  return (
    before !== undefined &&
    before.name.trim() === after.name.trim() &&
    before.startDate === after.startDate &&
    before.endDate === after.endDate &&
    before.applicationStartDate === after.applicationStartDate &&
    before.applicationEndDate === after.applicationEndDate
  );
}

/**
 * The wizard form for an imported program. The template's details and prerequisites are copied; the terms are not, so the
 * form gets one default term, and the logo is not, so the admin picks one. `termsAccepted` starts over as `false`.
 */
export function formFromMentorshipEnrollImport(importProgramId: string, data: MentorshipEnrollImport): MentorshipEnrollForm {
  return {
    ...createEmptyMentorshipEnrollForm(),
    importProgramId,
    name: data.name,
    projectId: data.project?.id ?? '',
    technologies: [...data.technologies],
    description: data.description,
    repositoryUrl: data.repositoryUrl,
    websiteUrl: data.websiteUrl,
    ciiProjectId: data.ciiProjectId,
    codeOfConductUrl: data.codeOfConductUrl,
    skills: [...data.skills],
    terms: [createDefaultMentorshipTerm()],
    prerequisites: mergeImportedMentorshipPrerequisites(data.prerequisites),
  };
}

/**
 * The wizard form for editing a program: its details and prerequisites as import copies them, its open terms, and its current
 * logo as the preview. The terms were accepted when the program was created, so `termsAccepted` is `true`.
 */
export function formFromMentorshipEnrollEdit(data: MentorshipEnrollImport, terms: MentorshipProgramTerm[]): MentorshipEnrollForm {
  return {
    ...formFromMentorshipEnrollImport('', data),
    terms: terms.map((term) => ({ ...term })),
    logoFileName: data.logoUrl ? MENTORSHIP_ENROLL_CURRENT_LOGO_LABEL : '',
    logoPreviewUrl: data.logoUrl,
    termsAccepted: true,
  };
}

/**
 * Lays the imported prerequisites over the standard list. An imported item selects a standard row only when it is that row
 * as create sends it: the same name (ignoring case), description and file requirement, and no due date. The Coding
 * Challenge is compared without the `Challenge:` line create appends to its description, and gets that URL back. A
 * standard row's text, file requirement and due date cannot be edited, so any other imported item, a changed standard one
 * included, becomes a custom prerequisite that keeps its stored values. The standard rows the program did not use stay in
 * the list unselected.
 */
function mergeImportedMentorshipPrerequisites(imported: MentorshipPrerequisite[]): MentorshipPrerequisite[] {
  const standard = createEmptyMentorshipEnrollForm().prerequisites;
  const custom: MentorshipPrerequisite[] = [];
  for (const item of imported) {
    const name = item.name.trim().toLowerCase();
    const index = standard.findIndex((entry) => !entry.required && entry.name.toLowerCase() === name);
    const entry = index === -1 ? undefined : standard[index];
    const challenge = entry?.challengeUrl !== undefined ? splitImportedChallenge(item.description) : { text: item.description.trim(), url: '' };
    const isStandard = entry !== undefined && challenge.text === entry.description && Boolean(item.requireFile) === Boolean(entry.requireFile) && !item.dueDate;
    if (!isStandard) {
      custom.push({ ...item });
      continue;
    }
    standard[index] = { ...entry, required: true, ...(entry.challengeUrl !== undefined ? { challengeUrl: challenge.url } : {}) };
  }
  return [...standard, ...custom];
}

/**
 * Splits a Coding Challenge description into its text and the URL on its last line when that line is `Challenge: <url>`.
 * Without such a line the URL is `''` and the text is the whole description. Only the last line is matched, so a long
 * stored description never makes the pattern backtrack.
 */
function splitImportedChallenge(description: string): { text: string; url: string } {
  const text = description.trim();
  const newline = text.lastIndexOf('\n');
  const url = newline === -1 ? '' : (/^[ \t]*Challenge:[ \t]*(\S+)$/.exec(text.slice(newline + 1))?.[1] ?? '');
  return url ? { text: text.slice(0, newline).trimEnd(), url } : { text, url: '' };
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

function cleanMentorshipSkillList(skills: readonly string[] | null | undefined): string[] {
  return (skills ?? []).map((skill) => skill.trim()).filter((skill) => skill !== '');
}

/** Trims each item and drops blanks and case-insensitive repeats, keeping the first spelling and the order. */
function uniqueMentorshipList(items: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>();
  return cleanMentorshipSkillList(items).filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isSameMentorshipList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

/**
 * The changed groups of a mentee profile edit, or `{}` when nothing changed. `introduction` is the
 * editor's HTML and is sent when it differs from the stored `seed.aboutMe`: the editor writes to the
 * form only when the mentee types, so an untouched introduction is never sent. `skillSet` is present
 * when the skills (trimmed, blanks dropped, order-sensitive) or the trimmed notes differ from `seed`,
 * and then always carries all three fields, since upstream replaces the whole column. `country` is sent
 * when the picked code differs from `seed.country`. Never emits demographics or socioeconomics.
 */
export function buildMentorshipMenteeProfileUpdate(
  seed: MentorshipMenteeProfileDetails,
  value: MentorshipMenteeProfileFormValue
): MentorshipMenteeProfileUpdateRequest {
  const request: MentorshipMenteeProfileUpdateRequest = {};

  if (value.introduction !== (seed.aboutMe ?? '')) {
    request.introduction = value.introduction;
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

  if (value.country !== (seed.country ?? '')) {
    request.country = value.country;
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
 * Term date errors for the enroll wizard: the shared term rules, then the application windows upstream create refuses,
 * reported on `applicationEndDate`. The term dialog and the setup step both use it, so a term the dialog saves passes Next.
 * A saved term (`original`) whose dates are all unchanged has nothing to check, so renaming it never trips a rule its dates
 * were saved under, such as the one-day application window the Terms tab allows.
 */
export function getMentorshipEnrollTermDateErrors(
  term: Pick<MentorshipProgramTerm, 'startDate' | 'endDate' | 'applicationStartDate' | 'applicationEndDate'>,
  today = new Date(),
  original?: Pick<MentorshipProgramTerm, 'startDate' | 'endDate' | 'applicationStartDate' | 'applicationEndDate'>
): MentorshipTermDateErrors {
  const datesUnchanged =
    original !== undefined &&
    term.startDate === original.startDate &&
    term.endDate === original.endDate &&
    term.applicationStartDate === original.applicationStartDate &&
    term.applicationEndDate === original.applicationEndDate;
  if (datesUnchanged) return {};
  const errors = getMentorshipTermDateErrors(term, today, original);
  if (Object.keys(errors).length) return errors;
  const windowError = getMentorshipEnrollTermWindowError(term);
  return windowError ? { applicationEndDate: windowError } : errors;
}

/**
 * Field-keyed validation errors for a single enroll wizard step.
 *
 * The `details` step only requires a selected project; the picker offers live query-service
 * projects, so there is no client-side allowlist to check the id against.
 */
export function getMentorshipEnrollStepErrors(
  step: MentorshipEnrollStep,
  form: MentorshipEnrollValidationInput,
  edit?: MentorshipEnrollEditBaseline
): MentorshipEnrollFieldErrors {
  if (step === 'details') {
    const errors: MentorshipEnrollFieldErrors = {};
    if (isBlank(form.name)) {
      errors.name = 'Program name is required.';
    } else if (form.name.trim().length < MENTORSHIP_ENROLL_NAME_MIN || form.name.trim().length > MENTORSHIP_ENROLL_NAME_MAX) {
      errors.name = `Program name should be between ${MENTORSHIP_ENROLL_NAME_MIN} and ${MENTORSHIP_ENROLL_NAME_MAX} characters.`;
    }
    const projectId = form.projectId.trim();
    if (!projectId) {
      errors.projectId = MENTORSHIP_ENROLL_PROJECT_REQUIRED;
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
    // An edit keeps the program's logo unless a new file is picked, and a picked file is checked as it is picked.
    if (!edit && isBlank(form.logoFileName)) {
      errors.logoFileName = 'Logo is required.';
    } else if (!edit && !isMentorshipLogoFileName(form.logoFileName)) {
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
    // A program being edited that had only closed terms may stay that way; upstream keeps a program's last open term otherwise.
    if (!form.terms.length && (!edit || edit.terms.length > 0)) {
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
        // An edit sends nothing for a saved term the admin left as it was, so only new and changed terms are checked.
        const savedTerms = new Map((edit?.terms ?? []).map((term) => [term.id, term]));
        const firstTermError = form.terms
          .filter((term) => !isSameMentorshipTerm(savedTerms.get(term.id), term))
          .map((term) => Object.values(getMentorshipEnrollTermDateErrors(term, new Date(), savedTerms.get(term.id)))[0])
          .find(Boolean);
        if (firstTermError) errors.terms = firstTermError;
      }
    }
    return errors;
  }

  const errors: MentorshipEnrollFieldErrors = {};
  const todayFloor = mentorshipDateOnlyFloor();
  const savedPrerequisites = new Map((edit?.prerequisites ?? []).map((item) => [item.id, item]));
  const incompleteCustom = form.prerequisites.some((item) => {
    if (!item.custom) return false;
    if (isBlank(item.name) || item.name.trim().length > MENTORSHIP_CUSTOM_PREREQ_NAME_MAX) return true;
    // A due date the program already had, even none or a past one, stays valid while it is left unchanged.
    const keepsSavedDueDate = savedPrerequisites.has(item.id) && (savedPrerequisites.get(item.id)?.dueDate ?? '') === (item.dueDate ?? '');
    if (!keepsSavedDueDate && (isBlank(item.dueDate ?? '') || !isMentorshipIsoDate(item.dueDate ?? ''))) return true;
    if (!keepsSavedDueDate && (item.dueDate ?? '') < todayFloor) return true;
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
 * Validates the Become a Mentor form, and the `POST /api/mentorship/mentor/profile` body the BFF
 * receives, so the two are held to one rule set.
 *
 * Program requests are deliberately unvalidated. They are optional: a mentor may register
 * a profile now and apply to programs later, so the request list is not checked here and
 * does not reach this function at all. A skill outside `MENTORSHIP_SKILL_OPTIONS`
 * can only come from a tampered request (the picker offers nothing else), so it gets its
 * own message after the required check.
 */
export function getMentorshipMentorRegisterErrors(
  form: Pick<MentorshipMentorRegisterForm, 'introduction' | 'skills' | 'complianceAccepted' | 'termsAccepted'>
): MentorshipMentorRegisterFieldErrors {
  const errors: MentorshipMentorRegisterFieldErrors = getMentorshipMentorProfileErrors({ introduction: form.introduction, skills: form.skills });
  if (!isMentorshipTermsAccepted(form.complianceAccepted)) errors.complianceAccepted = 'Please confirm the compliance statement.';
  if (!isMentorshipTermsAccepted(form.termsAccepted)) errors.termsAccepted = 'Please accept the terms and conditions.';

  return errors;
}

/**
 * The introduction and skills rules a mentor profile is held to, on register and on edit, in the browser
 * and in the BFF. Only the fields present are checked, so an edit that leaves one out is not refused for
 * what is already stored. A skill outside `MENTORSHIP_SKILL_OPTIONS` can only come from a stored legacy
 * value or a tampered request (the picker offers nothing else), so it gets its own message after the
 * required check.
 */
export function getMentorshipMentorProfileErrors(input: MentorshipMentorProfileUpdateRequest): MentorshipMentorProfileFieldErrors {
  const errors: MentorshipMentorProfileFieldErrors = {};

  if (input.introduction !== undefined) {
    const introductionError = mentorshipRichTextError(
      input.introduction,
      MENTORSHIP_MENTOR_INTRODUCTION_MAX,
      'Introduction is required.',
      `Introduction must be ${MENTORSHIP_MENTOR_INTRODUCTION_MAX} characters or fewer.`
    );
    if (introductionError) errors.introduction = introductionError;
  }
  if (input.skills !== undefined) {
    if (!input.skills.length) errors.skills = 'Add at least one skill.';
    else if (hasUnknownMentorshipSkill(input.skills)) errors.skills = MENTORSHIP_REGISTER_ERROR_UNKNOWN_SKILL;
  }

  return errors;
}

/**
 * The changed fields of a mentor profile edit, or `{}` when nothing changed. `introduction` is the
 * editor's HTML and is sent when it differs from the stored one: the editor writes to the form only
 * when the mentor types, so an untouched introduction is never sent. `skills` is sent when the list
 * (trimmed, blanks dropped, order-sensitive) differs from `seed`, and then whole, since upstream
 * replaces the list.
 */
export function buildMentorshipMentorProfileUpdate(
  seed: MentorshipMentorProfileDetails,
  value: { introduction: string; skills: readonly string[] }
): MentorshipMentorProfileUpdateRequest {
  const request: MentorshipMentorProfileUpdateRequest = {};

  if (value.introduction !== (seed.aboutMe ?? '')) {
    request.introduction = value.introduction;
  }

  const skills = cleanMentorshipSkillList(value.skills);
  if (!isSameMentorshipList(skills, cleanMentorshipSkillList(seed.skills))) {
    request.skills = skills;
  }

  return request;
}

/** True when no field of the mentor profile update is present, so there is nothing to send. */
export function isMentorshipMentorProfileUpdateEmpty(request: MentorshipMentorProfileUpdateRequest): boolean {
  return MENTORSHIP_MENTOR_PROFILE_UPDATE_KEYS.every((key) => request[key] === undefined);
}

/**
 * Builds the `POST /api/mentorship/mentor/profile` body from the register form.
 */
export function buildMentorshipMentorRegisterRequest(
  form: MentorshipMentorRegisterForm,
  lfxProfile?: MentorshipLfxProfileFields
): MentorshipMentorRegisterRequest {
  return {
    introduction: form.introduction,
    skills: [...form.skills],
    complianceAccepted: isMentorshipTermsAccepted(form.complianceAccepted),
    termsAccepted: isMentorshipTermsAccepted(form.termsAccepted),
    ...(lfxProfile && Object.keys(lfxProfile).length ? { lfxProfile: { ...lfxProfile } } : {}),
  };
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
    country: '',
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
 * Validates the Become a Mentee form. Delegates to `getMentorshipMenteeRegisterRequestErrors`, so the
 * form and the request the BFF receives are held to one rule set.
 *
 * Both skills fields are required: `skillsHave` describes what the mentee brings and
 * `skillsWant` describes what they want to grow, and both sides feed the mentor-match.
 * The demographic fields (age, gender, income, education) are never checked here: each
 * is optional and gated behind its own consent checkbox, so declining one is a valid
 * answer rather than an error.
 */
export function getMentorshipMenteeRegisterErrors(form: MentorshipMenteeRegisterForm): MentorshipMenteeRegisterFieldErrors {
  return getMentorshipMenteeRegisterRequestErrors(form);
}

/**
 * The rule a mentee introduction (the rich editor's HTML) is held to, on register and in the profile
 * edit drawer, in the browser and in the BFF. Returns the message, or `undefined` when valid.
 */
export function getMentorshipMenteeIntroductionError(html: string): string | undefined {
  return mentorshipRichTextError(
    html,
    MENTORSHIP_MENTEE_INTRODUCTION_MAX,
    'Introduction is required.',
    `Introduction must be ${MENTORSHIP_MENTEE_INTRODUCTION_MAX} characters or fewer.`
  );
}

/**
 * The rule a mentee country is held to, on register and in the profile edit drawer, in the browser and in
 * the BFF: required, and one of the assigned ISO 3166-1 alpha-2 codes the dropdown offers. Returns the
 * message, or `undefined` when valid.
 */
export function getMentorshipMenteeCountryError(country: string): string | undefined {
  if (isBlank(country)) return MENTORSHIP_MENTEE_COUNTRY_REQUIRED_MESSAGE;
  return MENTORSHIP_MENTEE_COUNTRY_CODES.has(country) ? undefined : MENTORSHIP_MENTEE_COUNTRY_UNKNOWN_MESSAGE;
}

/**
 * The register rules, expressed over the wire request so the browser and the BFF share them. Keys are
 * assigned in form order because the submit toast shows `Object.values(errors)[0]`. A skill outside
 * `MENTORSHIP_SKILL_OPTIONS` can only come from a tampered request (the picker offers nothing else),
 * so it gets its own message after the required check. Each list is held to the profile edit's
 * `MENTORSHIP_MENTEE_PROFILE_SKILLS_MAX_ITEMS`: the picker offers more options than that, and a profile
 * registered over the cap could never be saved from the profile drawer again.
 */
export function getMentorshipMenteeRegisterRequestErrors(
  input: Pick<
    MentorshipMenteeRegisterRequest,
    'introduction' | 'skillsHave' | 'skillsWant' | 'country' | 'ageEligible' | 'workAuthorized' | 'noDuplicateProfile' | 'complianceAccepted' | 'termsAccepted'
  >
): MentorshipMenteeRegisterFieldErrors {
  const errors: MentorshipMenteeRegisterFieldErrors = {};

  const introductionError = getMentorshipMenteeIntroductionError(input.introduction);
  if (introductionError) errors.introduction = introductionError;
  if (!input.skillsHave.length) errors.skillsHave = 'Add at least one skill you currently have.';
  else if (input.skillsHave.length > MENTORSHIP_MENTEE_PROFILE_SKILLS_MAX_ITEMS) errors.skillsHave = MENTORSHIP_MENTEE_PROFILE_SKILLS_LIMIT_MESSAGE;
  else if (hasUnknownMentorshipSkill(input.skillsHave)) errors.skillsHave = MENTORSHIP_REGISTER_ERROR_UNKNOWN_SKILL;
  if (!input.skillsWant.length) errors.skillsWant = 'Add at least one skill you would like to improve.';
  else if (input.skillsWant.length > MENTORSHIP_MENTEE_PROFILE_SKILLS_MAX_ITEMS) errors.skillsWant = MENTORSHIP_MENTEE_PROFILE_SKILLS_LIMIT_MESSAGE;
  else if (hasUnknownMentorshipSkill(input.skillsWant)) errors.skillsWant = MENTORSHIP_REGISTER_ERROR_UNKNOWN_SKILL;
  const countryError = getMentorshipMenteeCountryError(input.country);
  if (countryError) errors.country = countryError;
  if (!isMentorshipTermsAccepted(input.ageEligible)) errors.ageEligible = 'Please confirm you are 18 years of age or older.';
  if (!isMentorshipTermsAccepted(input.workAuthorized)) errors.workAuthorized = 'Please confirm you are authorized to work in your country of residence.';
  if (!isMentorshipTermsAccepted(input.noDuplicateProfile)) errors.noDuplicateProfile = 'Please confirm you do not already have a mentee profile.';
  if (!isMentorshipTermsAccepted(input.complianceAccepted)) errors.complianceAccepted = 'Please confirm the compliance statement.';
  if (!isMentorshipTermsAccepted(input.termsAccepted)) errors.termsAccepted = 'Please accept the terms and conditions.';

  return errors;
}

function hasUnknownMentorshipSkill(skills: string[]): boolean {
  return skills.some((skill) => !MENTORSHIP_SKILL_OPTIONS.includes(skill));
}

/**
 * Builds the `POST /api/mentorship/mentee/profile` body from the register form. A demographic answer is
 * sent only when its consent box is checked and it is not blank, so declining a question never leaves
 * a stale answer on the wire. `lfxProfile` is the profile card's name and avatar, sent only when it has
 * at least one of them; the BFF adds the primary email itself.
 */
export function buildMentorshipMenteeRegisterRequest(
  form: MentorshipMenteeRegisterForm,
  lfxProfile?: MentorshipLfxProfileFields
): MentorshipMenteeRegisterRequest {
  const demographics: MentorshipMenteeDemographics = {};
  for (const row of MENTORSHIP_MENTEE_DEMOGRAPHIC_ROWS) {
    const answer = form[row.answerControl];
    if (isMentorshipTermsAccepted(form[row.consentControl]) && typeof answer === 'string' && !isBlank(answer)) {
      demographics[row.answerControl as keyof MentorshipMenteeDemographics] = answer;
    }
  }

  return {
    introduction: form.introduction,
    skillsHave: [...form.skillsHave],
    skillsWant: [...form.skillsWant],
    additionalNotes: form.additionalNotes.trim(),
    country: form.country,
    ...(Object.keys(demographics).length ? { demographics } : {}),
    ageEligible: isMentorshipTermsAccepted(form.ageEligible),
    workAuthorized: isMentorshipTermsAccepted(form.workAuthorized),
    noDuplicateProfile: isMentorshipTermsAccepted(form.noDuplicateProfile),
    complianceAccepted: isMentorshipTermsAccepted(form.complianceAccepted),
    termsAccepted: isMentorshipTermsAccepted(form.termsAccepted),
    ...(lfxProfile && Object.keys(lfxProfile).length ? { lfxProfile: { ...lfxProfile } } : {}),
  };
}

/**
 * Classifies a failed `POST /api/mentorship/{mentor,mentee}/profile` by status and error code, never by
 * message text (upstream wording is not a contract). `options` carries what differs by role: the
 * profile-exists code and copy, the fields a 400 may name, and the 422 copy. The mentee 422 has two
 * upstream causes (the eligibility flags, or the user row missing), so it gets one fixed message and the
 * checkboxes are not re-highlighted. The mentor form has no eligibility statements, so without
 * `ineligibleMessage` a 422 falls through to the fallback.
 */
export function mapMentorshipRegisterFailure<TFieldErrors extends object>(
  status: number,
  body: unknown,
  options: MentorshipRegisterFailureOptions<TFieldErrors>
): MentorshipRegisterSubmitFailure<TFieldErrors> {
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const code = record['code'];

  if (status === 409 && code === options.profileExistsCode) {
    return { kind: 'profile-exists', message: options.profileExistsMessage };
  }
  if (status === 409) return { kind: 'conflict', message: MENTORSHIP_REGISTER_ERROR_CONFLICT };
  if (status === 403 && code === MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE) {
    return { kind: 'read-only', message: MENTORSHIP_REGISTER_ERROR_READ_ONLY };
  }
  if (status === 400 && Array.isArray(record['errors'])) {
    const fieldErrors: Partial<Record<keyof TFieldErrors, string>> = {};
    for (const entry of record['errors'] as unknown[]) {
      const item = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};
      const field = options.fieldKeys.find((key) => key === item['field']);
      const message = item['message'];
      if (field && typeof message === 'string' && message.trim() && !fieldErrors[field]) fieldErrors[field] = message;
    }
    const firstMessage = Object.values(fieldErrors)[0];
    if (typeof firstMessage === 'string') return { kind: 'field-errors', message: firstMessage, fieldErrors: fieldErrors as TFieldErrors };
  }
  if (status === 422 && options.ineligibleMessage) return { kind: 'ineligible', message: options.ineligibleMessage };

  return { kind: 'error', message: MENTORSHIP_REGISTER_ERROR_FALLBACK };
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

/**
 * Submitted tasks waiting on the mentor: those of `accepted` mentees, so a graduated mentee's leftover
 * submission is not counted, the same rule as the My Programs card's tasks to review.
 */
export function mentorshipMentorSubmittedTaskCount(mentees: MentorshipProgramMentee[]): number {
  return mentees
    .filter((mentee) => mentee.status === 'accepted')
    .reduce((count, mentee) => count + (mentee.tasks ?? []).filter((task) => task.status === 'submitted').length, 0);
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
 * Flatten mentee tasks the mentor Tasks tab can show: `submitted` (Awaiting Review) on
 * `accepted` mentees, matching `mentorshipMentorSubmittedTaskCount`, and `completed`
 * (Approved) on any mentee. Newest `updatedOn` first.
 */
export function mentorshipMentorReviewTasks(mentees: MentorshipProgramMentee[]): MentorshipMentorReviewTask[] {
  const rows: MentorshipMentorReviewTask[] = [];

  for (const mentee of mentees) {
    for (const task of mentee.tasks ?? []) {
      if (task.status !== 'submitted' && task.status !== 'completed') continue;
      if (task.status === 'submitted' && mentee.status !== 'accepted') continue;
      rows.push({
        id: `${mentee.id}__${task.id}`,
        taskId: task.id,
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
 * Whether every prerequisite task has been submitted, judged as upstream's `tasks_submitted` status filter
 * judges it: an application with no tasks has none outstanding, so it counts as complete. Without counts (a
 * cross-program application carries none) nothing is known to be submitted.
 */
function mentorshipPrerequisitesComplete(person: MentorshipApplicationProgress): boolean {
  if (person.tasksTotal === undefined) return false;
  return (person.tasksSubmitted ?? 0) >= person.tasksTotal;
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
 * Progress the mentor Mentees tab shows as a bar plus percent. Counts
 * `status === 'completed'` on the embedded `tasks` list, excluding prerequisites,
 * which the View Tasks panel can hide with its `hidePrerequisite` toggle.
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

/** 1 when the status counts toward upstream's `tasks_submitted` (Submitted or Completed), else 0, so a status change can shift that count by a difference. */
export function mentorshipTaskSubmittedCount(status: MentorshipApplicantTaskStatus): number {
  return status === 'submitted' || status === 'completed' ? 1 : 0;
}

/**
 * The fields the task-edit dialog changed on a task, as the admin task update body: a field that still reads as it did is
 * left out, so saving one change never re-sends (and so never re-validates upstream) the rest. A cleared due date goes as
 * `''`, which upstream reads as clear it. Empty when nothing changed.
 */
export function buildMentorshipAdminTaskUpdate(task: MentorshipApplicantTask, value: MentorshipTaskFormValue): MentorshipAdminTaskUpdate {
  const update: MentorshipAdminTaskUpdate = {};
  if (value.name !== task.name) update.name = value.name;
  if (value.description !== task.description) update.description = value.description;
  if ((value.dueOn ?? '') !== (task.dueOn ?? '')) update.dueDate = value.dueOn ?? '';
  if (value.requiresFileSubmission !== !!task.requiresFileSubmission) update.requiresFileSubmission = value.requiresFileSubmission;
  if (value.status !== undefined && value.status !== task.status) update.status = value.status;
  return update;
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
 * Resolves a row's action keys into what its menu renders. It takes the label and icon
 * maps as arguments so it serves any action union; the shape it returns is what
 * `lfx-mentorship-row-actions` consumes, and `value` is the key the menu emits back.
 */
export function mentorshipRowActions<T extends string>(actions: readonly T[], labels: Record<T, string>, icons: Record<T, string>): MentorshipRowAction[] {
  return actions.map((action) => ({ value: action, label: labels[action], icon: icons[action] }));
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
 * (file already uploaded). `nowMs` decides `pastDue`.
 */
export function buildMentorshipMenteeTaskView(
  input: {
    id: string;
    title: string;
    description: string;
    status: MentorshipMenteeTaskStatus;
    submitFile: string | null;
    fileUrl?: string;
    dueDate?: string;
    submittedDate?: string;
  },
  nowMs: number = Date.now()
): MentorshipMenteeTaskView {
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
    pastDue: isMentorshipTaskPastDue(input.dueDate, nowMs),
    submittedDate: input.submittedDate ?? null,
  };
}

/** Whether a value is a status a mentee may request (`in_progress` or `submitted`). Narrows for the controller and the row. */
export function isMentorshipMenteeUpdatableTaskStatus(value: unknown): value is MentorshipMenteeUpdatableTaskStatus {
  return MENTORSHIP_MENTEE_UPDATABLE_TASK_STATUSES.includes(value as MentorshipMenteeUpdatableTaskStatus);
}

/** Whether a value is a review decision a mentor may send (`complete` or `incomplete`). Narrows for the controller. */
export function isMentorshipMentorTaskReviewDecision(value: unknown): value is MentorshipMentorTaskReviewDecision {
  return MENTORSHIP_MENTOR_TASK_REVIEW_DECISIONS.includes(value as MentorshipMentorTaskReviewDecision);
}

/**
 * Status dropdown state for one task row. A mentee can only move `pending → in_progress` and
 * `in_progress → submitted`, so the current option stays enabled, the legal next move is enabled
 * and every other option is disabled. A submitted (or complete) task is locked. `submitted` is also
 * disabled while the task requires a file that is not stored yet, since the BFF never sends `file`,
 * and once the task is past due, when a pending task can still be started. The hint explains a
 * disabled forward move or a locked row; only the past-due and file-required hints show on screen,
 * and past due wins over file required.
 */
export function getMentorshipMenteeTaskStatusOptions(task: MentorshipMenteeTaskView): MentorshipMenteeTaskStatusOptionsState {
  const status = normalizeMentorshipMenteeTaskStatus(task.status);
  const withDisabled = (isDisabled: (value: MentorshipMenteeTaskStatus) => boolean): MentorshipMenteeTaskStatusOptionsState['options'] =>
    MENTORSHIP_MENTEE_TASK_STATUS_OPTIONS.map((option) => ({ ...option, disabled: isDisabled(option.value) }));

  if (status === 'submitted') {
    return { options: withDisabled(() => true), locked: true, hint: MENTORSHIP_MENTEE_TASK_HINT_LOCKED, hintVisible: false };
  }
  if (task.pastDue) {
    const blocked = (value: MentorshipMenteeTaskStatus): boolean => value === 'submitted' || (status === 'in_progress' && value === 'pending');
    return { options: withDisabled(blocked), locked: false, hint: MENTORSHIP_MENTEE_TASK_HINT_PAST_DUE, hintVisible: true };
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

/**
 * Build the card for a pending, accepted or graduated application with its display status. Its task
 * rows are ordered by name, A to Z; `nowMs` decides which of them are past due.
 */
export function buildMentorshipMenteeApplicationView(
  app: MentorshipMenteeApplication,
  status: MentorshipMenteeApplicationStatus,
  nowMs: number = Date.now()
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
    tasks: tasks
      .map((task) =>
        buildMentorshipMenteeTaskView(
          {
            id: task.id,
            title: task.name,
            description: task.description,
            status: task.status,
            submitFile: task.submitFile,
            fileUrl: task.fileUrl,
            dueDate: task.dueDate,
            submittedDate: task.submittedOn,
          },
          nowMs
        )
      )
      // Pinned to 'en' so the server render and the browser sort titles the same way.
      .sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base', numeric: true })),
  };
}

/**
 * Derive the mentee overview from the mentee's applications. Pending, accepted and graduated
 * applications become cards ordered active → graduated → awaiting review → in progress; declined, withdrawn
 * and held applications become Past Applications rows, newest first. `nowMs` decides which tasks are past due.
 */
export function buildMentorshipMenteeOverview(applications: readonly MentorshipMenteeApplication[], nowMs: number = Date.now()): MentorshipMenteeOverview {
  const cards: MentorshipMenteeApplicationView[] = [];
  const past: MentorshipMenteePastApplication[] = [];
  for (const app of applications) {
    const status = mentorshipMenteeDisplayStatus(app);
    if (status) {
      cards.push(buildMentorshipMenteeApplicationView(app, status, nowMs));
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

/** Whether a value has the shape of an upstream mentor invite token: two base64url parts joined by a dot. */
export function isMentorshipMentorInviteToken(value: string): boolean {
  return value.length <= MENTORSHIP_MENTOR_INVITE_TOKEN_MAX_LENGTH && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

/**
 * Graduate confirmation warning from a row's task counts, so no task read is needed. Counts the tasks that are
 * neither Submitted nor Completed; `undefined` when none are outstanding.
 */
export function buildMentorshipGraduateTaskWarning(tasksTotal: number, tasksSubmitted: number): string | undefined {
  const count = Math.max(tasksTotal - tasksSubmitted, 0);
  if (count === 0) {
    return undefined;
  }
  const template = count === 1 ? MENTORSHIP_ADMIN_GRADUATE_TASK_WARNING_SINGULAR_TEMPLATE : MENTORSHIP_ADMIN_GRADUATE_TASK_WARNING_TEMPLATE;
  return template.replace('{count}', String(count));
}
