// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';
import { CDP_COMPANY_DEFAULT_SECTION, CDP_COMPANY_SECTION_META } from '@lfx-one/shared/constants';

/**
 * Sections of a CDP company page, `/company/{CDP id}/{section}`. Every section is routable: which ones
 * are off is the server's answer, delivered with the page, so an off section renders "off by design" in place.
 * Titles are static — a CDP company's name never reaches the document title before the server has answered.
 */
export const CDP_COMPANY_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: CDP_COMPANY_DEFAULT_SECTION },
  {
    path: 'dashboard',
    data: { lens: 'org', title: CDP_COMPANY_SECTION_META.dashboard.label },
    loadComponent: () => import('./cdp-company-dashboard/cdp-company-dashboard.component').then((m) => m.CdpCompanyDashboardComponent),
  },
  {
    path: 'projects',
    data: { lens: 'org', title: CDP_COMPANY_SECTION_META.projects.label },
    loadComponent: () => import('./cdp-company-projects/cdp-company-projects.component').then((m) => m.CdpCompanyProjectsComponent),
  },
  {
    path: 'profile',
    data: { lens: 'org', title: CDP_COMPANY_SECTION_META.profile.label },
    loadComponent: () => import('./cdp-company-profile/cdp-company-profile.component').then((m) => m.CdpCompanyProfileComponent),
  },
  {
    path: 'events',
    data: { lens: 'org', title: CDP_COMPANY_SECTION_META.events.label },
    loadComponent: () => import('./cdp-company-events/cdp-company-events.component').then((m) => m.CdpCompanyEventsComponent),
  },
  {
    path: 'training',
    data: { lens: 'org', title: CDP_COMPANY_SECTION_META.training.label },
    loadComponent: () => import('./cdp-company-training/cdp-company-training.component').then((m) => m.CdpCompanyTrainingComponent),
  },
  {
    path: 'meetings',
    data: { lens: 'org', title: CDP_COMPANY_SECTION_META.meetings.label },
    loadComponent: () => import('./cdp-company-meetings/cdp-company-meetings.component').then((m) => m.CdpCompanyMeetingsComponent),
  },
  {
    path: 'groups',
    data: { lens: 'org', title: CDP_COMPANY_SECTION_META.groups.label },
    loadComponent: () => import('./cdp-company-groups/cdp-company-groups.component').then((m) => m.CdpCompanyGroupsComponent),
  },
  // A Company Lens page a CDP company has no route for (`/company/{CDP id}/memberships`) opens its Dashboard.
  { path: '**', redirectTo: CDP_COMPANY_DEFAULT_SECTION },
];
