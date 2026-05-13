// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';

import { authGuard } from './shared/guards/auth.guard';
import { executiveDirectorGuard } from './shared/guards/executive-director.guard';
import { lensRedirectGuard } from './shared/guards/lens-redirect.guard';

export const routes: Routes = [
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layouts/main-layout/main-layout.component').then((m) => m.MainLayoutComponent),
    children: [
      // Me Lens dashboard (root route)
      {
        path: '',
        pathMatch: 'full',
        data: { lens: 'me' },
        loadComponent: () => import('./modules/dashboards/dashboard.component').then((m) => m.DashboardComponent),
      },
      // Foundation Lens dashboard (placeholder — reuses DashboardComponent for now)
      {
        path: 'foundation/overview',
        data: { lens: 'foundation' },
        loadComponent: () => import('./modules/dashboards/dashboard.component').then((m) => m.DashboardComponent),
      },
      // Foundation Lens — Health Metrics page (ED-only)
      {
        path: 'foundation/health-metrics',
        data: { lens: 'foundation' },
        canActivate: [executiveDirectorGuard],
        loadComponent: () => import('./modules/dashboards/health-metrics/health-metrics.component').then((m) => m.HealthMetricsComponent),
      },
      // Foundation Lens — Marketing Impact page (ED-only)
      {
        path: 'foundation/marketing-impact',
        data: { lens: 'foundation' },
        canActivate: [executiveDirectorGuard],
        loadComponent: () => import('./modules/dashboards/marketing-impact/marketing-impact.component').then((m) => m.MarketingImpactComponent),
      },
      // Foundation Lens — Projects page
      {
        path: 'foundation/projects',
        data: { lens: 'foundation' },
        loadComponent: () => import('./modules/dashboards/foundation-projects/foundation-projects.component').then((m) => m.FoundationProjectsComponent),
      },
      {
        path: 'foundation/events',
        data: { lens: 'foundation' },
        loadChildren: () => import('./modules/events/events.routes').then((m) => m.EVENTS_ROUTES),
      },
      // Project Lens dashboard (placeholder — reuses DashboardComponent for now)
      {
        path: 'project/overview',
        data: { lens: 'project' },
        loadComponent: () => import('./modules/dashboards/dashboard.component').then((m) => m.DashboardComponent),
      },
      // Org Lens dashboard (placeholder — reuses DashboardComponent for now)
      {
        path: 'org',
        data: { lens: 'org' },
        loadComponent: () => import('./modules/dashboards/dashboard.component').then((m) => m.DashboardComponent),
      },
      // Foundation Lens — feature routes (lens-tagged so deep links restore the foundation lens)
      {
        path: 'foundation/meetings',
        data: { lens: 'foundation' },
        loadChildren: () => import('./modules/meetings/meetings.routes').then((m) => m.MEETING_ROUTES),
      },
      {
        path: 'foundation/events',
        data: { lens: 'foundation' },
        loadChildren: () => import('./modules/events/events.routes').then((m) => m.EVENTS_ROUTES),
      },
      {
        path: 'foundation/mailing-lists',
        data: { lens: 'foundation' },
        loadChildren: () => import('./modules/mailing-lists/mailing-lists.routes').then((m) => m.MAILING_LIST_ROUTES),
      },
      {
        path: 'foundation/groups',
        data: { lens: 'foundation' },
        loadChildren: () => import('./modules/committees/committees.routes').then((m) => m.COMMITTEE_ROUTES),
      },
      {
        path: 'foundation/documents',
        data: { lens: 'foundation' },
        loadChildren: () => import('./modules/documents/documents.routes').then((m) => m.DOCUMENT_ROUTES),
      },
      {
        path: 'foundation/votes',
        data: { lens: 'foundation' },
        loadChildren: () => import('./modules/votes/votes.routes').then((m) => m.VOTE_ROUTES),
      },
      {
        path: 'foundation/surveys',
        data: { lens: 'foundation' },
        loadChildren: () => import('./modules/surveys/surveys.routes').then((m) => m.SURVEY_ROUTES),
      },
      {
        path: 'foundation/settings',
        data: { lens: 'foundation' },
        loadChildren: () => import('./modules/settings/settings.routes').then((m) => m.SETTINGS_ROUTES),
      },
      // Project Lens — feature routes (lens-tagged so deep links restore the project lens)
      {
        path: 'project/meetings',
        data: { lens: 'project' },
        loadChildren: () => import('./modules/meetings/meetings.routes').then((m) => m.MEETING_ROUTES),
      },
      {
        path: 'project/mailing-lists',
        data: { lens: 'project' },
        loadChildren: () => import('./modules/mailing-lists/mailing-lists.routes').then((m) => m.MAILING_LIST_ROUTES),
      },
      {
        path: 'project/groups',
        data: { lens: 'project' },
        loadChildren: () => import('./modules/committees/committees.routes').then((m) => m.COMMITTEE_ROUTES),
      },
      {
        path: 'project/documents',
        data: { lens: 'project' },
        loadChildren: () => import('./modules/documents/documents.routes').then((m) => m.DOCUMENT_ROUTES),
      },
      {
        path: 'project/votes',
        data: { lens: 'project' },
        loadChildren: () => import('./modules/votes/votes.routes').then((m) => m.VOTE_ROUTES),
      },
      {
        path: 'project/surveys',
        data: { lens: 'project' },
        loadChildren: () => import('./modules/surveys/surveys.routes').then((m) => m.SURVEY_ROUTES),
      },
      {
        path: 'project/settings',
        data: { lens: 'project' },
        loadChildren: () => import('./modules/settings/settings.routes').then((m) => m.SETTINGS_ROUTES),
      },
      {
        path: 'meetings',
        canActivate: [lensRedirectGuard],
        loadChildren: () => import('./modules/meetings/meetings.routes').then((m) => m.MEETING_ROUTES),
      },
      {
        path: 'groups',
        canActivate: [lensRedirectGuard],
        loadChildren: () => import('./modules/committees/committees.routes').then((m) => m.COMMITTEE_ROUTES),
      },
      {
        path: 'mailing-lists',
        canActivate: [lensRedirectGuard],
        loadChildren: () => import('./modules/mailing-lists/mailing-lists.routes').then((m) => m.MAILING_LIST_ROUTES),
      },
      {
        path: 'votes',
        canActivate: [lensRedirectGuard],
        loadChildren: () => import('./modules/votes/votes.routes').then((m) => m.VOTE_ROUTES),
      },
      {
        path: 'surveys',
        canActivate: [lensRedirectGuard],
        loadChildren: () => import('./modules/surveys/surveys.routes').then((m) => m.SURVEY_ROUTES),
      },
      {
        path: 'documents',
        canActivate: [lensRedirectGuard],
        loadChildren: () => import('./modules/documents/documents.routes').then((m) => m.DOCUMENT_ROUTES),
      },
      {
        path: 'settings',
        canActivate: [lensRedirectGuard],
        loadChildren: () => import('./modules/settings/settings.routes').then((m) => m.SETTINGS_ROUTES),
      },
      {
        path: 'profile',
        loadChildren: () => import('./modules/profile/profile.routes').then((m) => m.PROFILE_ROUTES),
      },
      {
        path: 'me/training',
        loadChildren: () => import('./modules/trainings/trainings.routes').then((m) => m.TRAINING_ROUTES),
      },
      {
        path: 'badges',
        loadChildren: () => import('./modules/badges/badges.routes').then((m) => m.BADGE_ROUTES),
      },
      {
        path: 'me/transactions',
        loadChildren: () => import('./modules/transactions/transactions.routes').then((m) => m.TRANSACTION_ROUTES),
      },
      {
        path: 'events',
        canActivate: [lensRedirectGuard],
        loadChildren: () => import('./modules/events/events.routes').then((m) => m.EVENTS_ROUTES),
      },
      {
        path: 'me/events',
        redirectTo: 'events',
        pathMatch: 'full',
      },
      {
        path: 'me/badges',
        redirectTo: 'badges',
        pathMatch: 'full',
      },
    ],
  },
  {
    path: 'meetings/not-found',
    loadComponent: () => import('./modules/meetings/meeting-not-found/meeting-not-found.component').then((m) => m.MeetingNotFoundComponent),
  },
  {
    path: 'meetings/:id',
    loadComponent: () => import('./modules/meetings/meeting-join/meeting-join.component').then((m) => m.MeetingJoinComponent),
  },
];
