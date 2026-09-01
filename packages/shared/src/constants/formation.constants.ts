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
 * `FormationIntake` keys the intake form treats as required. Centralized so a required-ness
 * change (the field list is explicitly pending Scott's Google-Form confirmation — see #1962) is
 * a one-line diff here, read by both the Angular FormGroup builder and the server-side validator,
 * instead of two places drifting independently.
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
