// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * The single seeded "Project formation" template applied to every formation in Epic 1 (#1959).
 * No template editor/versioning exists yet — this is a fixed string until #1957/#1959 land.
 */
export const FORMATION_TEMPLATE_VERSION = 'project-formation-v1';

/** Code-point caps for the two free-text fields (`maxCodePointsValidator`, not `Validators.maxLength`). */
export const FORMATION_MISSION_STATEMENT_MAX_LENGTH = 600;
export const FORMATION_DESCRIPTION_MAX_LENGTH = 1200;

/**
 * Bounds for every other field the server-side validator accepts, so the fixture store (an
 * hour-long, size-unbounded-by-TTL-alone in-memory `Map`, see `formation.service.ts`) can't be
 * grown by an authenticated caller pushing arbitrarily large strings/arrays into a single POST.
 * The client form has no equivalent caps beyond its own `lfx-select`/text-input widths — these
 * are the server's own floor, not a mirror of client validation.
 */
export const FORMATION_SHORT_TEXT_MAX_LENGTH = 200;
export const FORMATION_URL_MAX_LENGTH = 2048;
export const FORMATION_CONTACT_NAME_MAX_LENGTH = 100;
export const FORMATION_MAX_ADDITIONAL_CONTACTS = 20;

/**
 * `FormationIntake` keys the intake form treats as required. The server-side validator
 * (`formation-validation.helper.ts`) reads this set directly for its generic required-field
 * check. The Angular `FormGroup` (`propose.component.ts`'s `createFormGroup`) does NOT read it —
 * each control there needs a specific validator *type* chosen by hand (`trimmedRequired()` for
 * text fields, `Validators.required` for selects), so a bare membership check wouldn't remove
 * real coupling. Keep the two in sync by convention when the field list changes (still pending
 * Scott's Google-Form confirmation — see #1962); this constant is the source of truth for
 * required-ness on the server side, not an automatic driver of the client form.
 */
export const FORMATION_REQUIRED_FIELDS = [
  'project_name',
  'trademark_status',
  'contributing_org_name',
  'license',
  'chat_platform',
  'mission_statement',
  'agreement_type',
  'description',
] as const;

/** Best-current-guess option set — flagged pending Scott's Google-Form/PCC field confirmation, same as the field list itself. */
export const FORMATION_TRADEMARK_STATUS_OPTIONS = [
  { label: 'Not yet filed', value: 'not_filed' },
  { label: 'Filed / pending', value: 'pending' },
  { label: 'Registered', value: 'registered' },
  { label: 'Not applicable', value: 'not_applicable' },
] as const;

export const FORMATION_LICENSE_OPTIONS = [
  { label: 'Apache License 2.0', value: 'Apache-2.0' },
  { label: 'MIT License', value: 'MIT' },
  { label: 'BSD 3-Clause License', value: 'BSD-3-Clause' },
  { label: 'GNU General Public License v3.0', value: 'GPL-3.0' },
  { label: 'Mozilla Public License 2.0', value: 'MPL-2.0' },
  { label: 'Other', value: 'other' },
] as const;

export const FORMATION_CHAT_PLATFORM_OPTIONS = [
  { label: 'Slack', value: 'slack' },
  { label: 'Discord', value: 'discord' },
  { label: 'Zulip', value: 'zulip' },
  { label: 'Mattermost', value: 'mattermost' },
  { label: 'Other', value: 'other' },
] as const;

export const FORMATION_AGREEMENT_TYPE_OPTIONS = [
  { label: 'CLA (Individual + Corporate)', value: 'cla' },
  { label: 'DCO (Signed-off-by)', value: 'dco' },
  { label: 'Both CLA and DCO', value: 'both' },
  { label: 'Not yet decided', value: 'undecided' },
] as const;

/**
 * "What are you proposing?" segmented control on `propose.component.ts` — orientation copy only
 * (architecture review on #1957 flagged that the form read as if it only covered brand-new
 * projects/foundations). There is no matching field on `FormationIntake`: the selection is never
 * read by `buildIntakePayload` or sent to the server.
 */
export const FORMATION_PROPOSAL_TYPE_OPTIONS = [
  { label: 'A project or subproject', value: 'project' },
  { label: 'A new foundation', value: 'foundation' },
] as const;
