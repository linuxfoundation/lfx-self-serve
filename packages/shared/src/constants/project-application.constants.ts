// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ProjectStage } from '../enums/project-stage.enum';
import type { FilterPillOption } from '../interfaces/dashboard-metric.interface';
import type {
  ProjectApplicationOption,
  ProjectApplicationSectionConfig,
  ProjectApplicationStateMeta,
  ProjectApplicationStatusCalloutCopy,
} from '../interfaces/project-application.interface';

/** Page-level tab ids (`?tab=`) on My Formations and the foundation Formations queue (#3037). */
export const PROJECT_APPLICATION_TABS = {
  formations: 'formations',
  proposals: 'proposals',
} as const;

/** Browser-facing BFF base path for project applications. */
export const PROJECT_APPLICATION_API_BASE_PATH = '/api/project-applications';

/** `Cache-Control` for every project-application BFF response — answers are private. */
export const PROJECT_APPLICATION_CACHE_CONTROL = 'private, no-store';

/** Answer key the BFF writes the formation team's chosen parent project to before accepting. */
export const PROJECT_APPLICATION_PARENT_KEY = 'parent_project_uid';

/** Answer key the BFF writes the formation team's chosen project slug to before creating the project (#1995). */
export const PROJECT_APPLICATION_SLUG_KEY = 'project_slug';

/** Answer key the BFF writes the created project's UID to, so a retried accept never creates it twice (#1995). */
export const PROJECT_APPLICATION_PROJECT_UID_KEY = 'project_uid';

/**
 * Answer keys only the formation team may set — the placement and project-creation record written at accept.
 * The BFF strips them at submit and from any revise by someone outside the team, so a submitter can neither
 * place their project nor plant a `project_uid` that would make accept skip creating it.
 */
export const PROJECT_APPLICATION_STAFF_KEYS: readonly string[] = [
  PROJECT_APPLICATION_PARENT_KEY,
  PROJECT_APPLICATION_SLUG_KEY,
  PROJECT_APPLICATION_PROJECT_UID_KEY,
];

/** project-service's slug rule (`CreateProjectRequestBody.slug`): starts with a letter, ends alphanumeric. */
export const PROJECT_SLUG_REGEX = /^[a-z][a-z0-9_-]*[a-z0-9]$/;

/** Stage the project created at accept starts in. */
export const PROJECT_APPLICATION_CREATED_STAGE = ProjectStage.FormationExploratory;

/** Legal entity type of the project created at accept — a subproject of the chosen parent. */
export const PROJECT_APPLICATION_CREATED_LEGAL_ENTITY_TYPE = 'Subproject';

/** Category of the created project when the proposal says it will publish a specification or standard. */
export const PROJECT_APPLICATION_SPEC_CATEGORY = 'Standards';

/** Character limit on "About the project" — the design's counter. */
export const PROJECT_APPLICATION_DESCRIPTION_MAX = 1000;

/** Character limit on the single-line text answers. */
export const PROJECT_APPLICATION_TEXT_MAX = 255;

/** Character limit on the mission statement. */
export const PROJECT_APPLICATION_MISSION_MAX = 500;

/** Most additional formation contacts one application may list. */
export const PROJECT_APPLICATION_FORMATION_LIST_MAX = 25;

/** Contact for questions before submitting, shown on the propose page. */
export const PROJECT_APPLICATION_CONTACT_EMAIL = 'formation@linuxfoundation.org';

/** The canonical answer keys formation-service validates, in form order. */
export const PROJECT_APPLICATION_CANONICAL_KEYS = [
  'project_name',
  'project_repository_url',
  'project_website',
  'trademark_status',
  'contributing_organization',
  'legal_contact_email',
  'formation_list',
  'license',
  'chat_platform',
  'mission_statement',
  'agreement_type',
  'is_spec_project',
  'description',
] as const;

/** Answer keys formation-service validates as http(s) URLs. */
export const PROJECT_APPLICATION_URL_KEYS: ReadonlySet<string> = new Set(['project_repository_url', 'project_website']);

/** URL answer keys that must also carry a hostname (the repository rule; the website rule does not). */
export const PROJECT_APPLICATION_URL_KEYS_REQUIRING_HOST: ReadonlySet<string> = new Set(['project_repository_url']);

/** Answer keys formation-service validates as booleans. */
export const PROJECT_APPLICATION_BOOLEAN_KEYS: ReadonlySet<string> = new Set(['is_spec_project']);

/** Answer keys formation-service validates as lists of email strings. */
export const PROJECT_APPLICATION_EMAIL_LIST_KEYS: ReadonlySet<string> = new Set(['formation_list']);

/** Answer keys formation-service validates with the legal-contact email rule. */
export const PROJECT_APPLICATION_EMAIL_KEYS: ReadonlySet<string> = new Set(['legal_contact_email']);

/**
 * Characters that keep an email answer from becoming a `mailto:` link: whitespace, address-syntax specials
 * (`<>"'(),;:`), mailto-header (`?&=%`) and URI-delimiter (`#/\`) characters, so a link always targets exactly
 * the address it displays. A single-character class, so testing it runs in linear time on any input.
 */
export const PROJECT_APPLICATION_MAILTO_FORBIDDEN_CHARS_REGEX = /[\s<>"'(),;:?&=%#/\\]/;

/** Long-form prose answers the detail view renders full width under their label. */
export const PROJECT_APPLICATION_LONG_TEXT_KEYS: ReadonlySet<string> = new Set(['mission_statement', 'description']);

/** UI labels per answer key. Keys missing here fall back to a humanized key in the detail view. */
export const PROJECT_APPLICATION_FIELD_LABELS: Record<string, string> = {
  project_name: 'Project name',
  project_repository_url: 'Repository location',
  project_website: 'Website',
  trademark_status: 'Is the name or logo a registered trademark?',
  contributing_organization: 'Assigning organization',
  legal_contact_email: 'Legal contact',
  formation_list: 'Additional formation contact emails',
  license: 'Code license',
  chat_platform: 'Chat platform',
  mission_statement: 'Mission statement',
  agreement_type: 'CLA/DCO',
  is_spec_project: 'Will the project publish a specification or standard?',
  description: 'About the project',
  parent_project_uid: 'Parent project',
  project_slug: 'Project slug',
  project_uid: 'Created project',
};

/** Detail-view grouping — mirrors the intake form's section cards. */
export const PROJECT_APPLICATION_SECTIONS: ProjectApplicationSectionConfig[] = [
  { title: 'Project', keys: ['project_name', 'project_repository_url', 'project_website', 'trademark_status'] },
  { title: 'Contributing organization', keys: ['contributing_organization', 'legal_contact_email', 'formation_list'] },
  { title: 'Governance and licensing', keys: ['license', 'chat_platform', 'mission_statement', 'agreement_type', 'is_spec_project'] },
  { title: 'About the project', keys: ['description'] },
];

export const PROJECT_APPLICATION_TRADEMARK_OPTIONS: ProjectApplicationOption[] = [
  { label: 'Yes', value: 'Yes' },
  { label: 'No', value: 'No' },
  { label: 'Not sure', value: 'Not sure' },
];

export const PROJECT_APPLICATION_CHAT_OPTIONS: ProjectApplicationOption[] = [
  { label: 'Slack', value: 'Slack' },
  { label: 'Discord', value: 'Discord' },
  { label: "Parent's", value: "Parent's" },
];

export const PROJECT_APPLICATION_AGREEMENT_OPTIONS: ProjectApplicationOption[] = [
  { label: 'CLA', value: 'CLA' },
  { label: 'DCO only', value: 'DCO' },
];

export const PROJECT_APPLICATION_SPEC_OPTIONS: ProjectApplicationOption<boolean>[] = [
  { label: 'Yes', value: true },
  { label: 'No', value: false },
];

/** SPDX identifiers offered for the code license; `Other` lets the team follow up. */
export const PROJECT_APPLICATION_LICENSE_OPTIONS: ProjectApplicationOption[] = [
  'Apache-2.0',
  'MIT',
  'BSD-3-Clause',
  'BSD-2-Clause',
  'MPL-2.0',
  'EPL-2.0',
  'GPL-2.0-only',
  'GPL-3.0-only',
  'LGPL-2.1-only',
  'AGPL-3.0-only',
  'CC-BY-4.0',
  'CDLA-Permissive-2.0',
  'Other',
].map((license) => ({ label: license, value: license }));

/** Display metadata per known state; unknown states fall back to {@link PROJECT_APPLICATION_UNKNOWN_STATE_META}. */
export const PROJECT_APPLICATION_STATE_META: Record<string, ProjectApplicationStateMeta> = {
  submitted: { label: 'Submitted', severity: 'info' },
  withdrawn: { label: 'Withdrawn', severity: 'secondary' },
  accepted: { label: 'Accepted', severity: 'success' },
  denied: { label: 'Denied', severity: 'danger' },
};

export const PROJECT_APPLICATION_UNKNOWN_STATE_META: ProjectApplicationStateMeta = { label: 'Unknown', severity: 'secondary' };

/** Status explainer under the detail drawer's header, per state and persona. Unlisted states show none. */
export const PROJECT_APPLICATION_STATUS_CALLOUTS: Record<string, ProjectApplicationStatusCalloutCopy> = {
  submitted: {
    severity: 'info',
    icon: 'fa-light fa-hourglass-half',
    submitter: 'The formation team is reviewing your proposal. You can revise or withdraw it until a decision is made.',
    staff: 'Awaiting a decision. Review the answers below, then accept or deny the proposal.',
  },
  accepted: {
    severity: 'success',
    icon: 'fa-light fa-circle-check',
    submitter: 'Your proposal was accepted. The formation team will follow up with next steps.',
    staff: 'This proposal was accepted.',
  },
  denied: {
    severity: 'warn',
    icon: 'fa-light fa-circle-xmark',
    submitter: 'Your proposal was not accepted. Contact the formation team if you have questions.',
    staff: 'This proposal was denied. The submitter is not notified automatically.',
  },
  withdrawn: {
    severity: 'secondary',
    icon: 'fa-light fa-arrow-rotate-left',
    submitter: 'You withdrew this proposal. It can no longer be revised or reviewed.',
    staff: 'The submitter withdrew this proposal. It can no longer be accepted or denied.',
  },
};

/** State filter pills on the formation team's review queue. */
export const PROJECT_APPLICATION_STATE_FILTER_OPTIONS: FilterPillOption[] = [
  { id: 'all', label: 'All' },
  { id: 'submitted', label: 'Submitted' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'denied', label: 'Denied' },
  { id: 'withdrawn', label: 'Withdrawn' },
];

/** Page-level tabs on the Me-lens My Formations page. */
export const MY_FORMATIONS_PAGE_TAB_OPTIONS: FilterPillOption[] = [
  { id: PROJECT_APPLICATION_TABS.formations, label: 'My formations' },
  { id: PROJECT_APPLICATION_TABS.proposals, label: 'Submitted proposals' },
];

/** Page-level tabs on the foundation Formations queue (The Linux Foundation + formation team only). */
export const FORMATIONS_QUEUE_PAGE_TAB_OPTIONS: FilterPillOption[] = [
  { id: PROJECT_APPLICATION_TABS.formations, label: 'Formations' },
  { id: PROJECT_APPLICATION_TABS.proposals, label: 'Project proposals' },
];
