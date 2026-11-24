// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Company Lens — CDP companies (lfx-self-serve#2092, spec 062): page and navigation copy of a CDP company page.
// User-facing copy says "company" (copy-terminology).

import type { CdpSectionKey } from '../interfaces/cdp-company.interface';
import type { CdpCompanyOffNavItem, CdpCompanySectionMeta } from '../interfaces/cdp-company-view.interface';

/** The section `/company/{CDP id}` opens on, and the one a merge redirect falls back to. */
export const CDP_COMPANY_DEFAULT_SECTION: CdpSectionKey = 'dashboard';

/** Navigation label, icon and page-header description of every CDP section (FR-025). */
export const CDP_COMPANY_SECTION_META: Record<CdpSectionKey, CdpCompanySectionMeta> = {
  dashboard: {
    key: 'dashboard',
    label: 'Dashboard',
    icon: 'fa-light fa-grid-2',
    description: "This company's open source activity over the last 2 years.",
  },
  projects: {
    key: 'projects',
    label: 'Projects',
    icon: 'fa-light fa-folders',
    description: 'Linux Foundation projects this company contributed to in the last 2 years.',
  },
  profile: {
    key: 'profile',
    label: 'Company Profile',
    icon: 'fa-light fa-memo',
    description: 'What is known about this company from open source activity.',
  },
  events: {
    key: 'events',
    label: 'Events',
    icon: 'fa-light fa-ticket',
    description: "Linux Foundation events this company's people attended.",
  },
  training: {
    key: 'training',
    label: 'Training & Certification',
    icon: 'fa-light fa-graduation-cap',
    description: "Training enrollments and certifications of this company's people.",
  },
  meetings: {
    key: 'meetings',
    label: 'Meetings',
    icon: 'fa-light fa-calendar',
    description: "Meeting attendance of this company's people, by project and meeting type.",
  },
  groups: {
    key: 'groups',
    label: 'Groups',
    icon: 'fa-light fa-users-between-lines',
    description: 'Active seats this company holds on Linux Foundation project groups.',
  },
};

/** CDP sections listed in the Company Engagement part of the navigation, in order. */
export const CDP_COMPANY_ENGAGEMENT_SECTION_KEYS: readonly CdpSectionKey[] = ['events', 'training', 'meetings', 'groups'];

/**
 * Company Lens sections a CDP company never offers, greyed in its navigation where the company navigation shows them
 * (FR-025, EasyCLA included). Keyed by their Company Lens page.
 */
export const CDP_COMPANY_OFF_NAV_ITEMS = {
  memberships: { key: 'memberships', label: 'Memberships', icon: 'fa-light fa-folder-bookmark' },
  people: { key: 'people', label: 'People', icon: 'fa-light fa-people-group' },
  contributions: { key: 'contributions', label: 'Code Contributions', icon: 'fa-light fa-code' },
  initiatives: { key: 'initiatives', label: 'Crowdfunding Initiatives', icon: 'fa-light fa-box-dollar' },
  donations: { key: 'donations', label: 'Crowdfunding Donations', icon: 'fa-light fa-hand-holding-heart' },
  easycla: { key: 'easycla', label: 'EasyCLA', icon: 'fa-light fa-file-signature' },
  roi: { key: 'roi', label: 'ROI Metrics', icon: 'fa-light fa-chart-mixed-up-circle-dollar' },
} as const satisfies Record<string, CdpCompanyOffNavItem>;

/** Plural nouns of the CDP table sections, for their "nothing recorded" state. */
export const CDP_COMPANY_SECTION_EMPTY_NOUN: Partial<Record<CdpSectionKey, string>> = {
  projects: 'project activity',
  events: 'event attendance',
  meetings: 'meeting attendance',
  groups: 'group seats',
};

/** Shown in place of a Training & Certification total the server withheld because fewer than 5 people make it up (FR-029, FR-030). */
export const CDP_COMPANY_HIDDEN_COUNT_LABEL = 'Fewer than 5';
