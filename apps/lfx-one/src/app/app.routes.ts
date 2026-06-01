// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';

import { authGuard } from './shared/guards/auth.guard';
import { executiveDirectorGuard } from './shared/guards/executive-director.guard';
import { lensRedirectGuard } from './shared/guards/lens-redirect.guard';
import { newsletterAccessGuard } from './shared/guards/newsletter-access.guard';
import { orgLensEnabledGuard } from './shared/guards/org-lens-enabled.guard';
import { projectQueryParamGuard } from './shared/guards/project-query-param.guard';

const loadOrgPlaceholderPage = () =>
  import('./modules/dashboards/org/components/org-placeholder-page/org-placeholder-page.component').then((m) => m.OrgPlaceholderPageComponent);

const loadOrgProfilePage = () => import('./modules/dashboards/org/org-profile/org-profile.component').then((m) => m.OrgProfileComponent);

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
        canActivate: [projectQueryParamGuard],
        loadComponent: () => import('./modules/dashboards/dashboard.component').then((m) => m.DashboardComponent),
      },
      // Foundation Lens — Health Metrics page (ED-only)
      {
        path: 'foundation/health-metrics',
        data: { lens: 'foundation' },
        canActivate: [executiveDirectorGuard, projectQueryParamGuard],
        loadComponent: () => import('./modules/dashboards/health-metrics/health-metrics.component').then((m) => m.HealthMetricsComponent),
      },
      // Foundation Lens — Marketing Impact page (ED-only)
      {
        path: 'foundation/marketing-impact',
        data: { lens: 'foundation' },
        canActivate: [executiveDirectorGuard, projectQueryParamGuard],
        loadComponent: () => import('./modules/dashboards/marketing-impact/marketing-impact.component').then((m) => m.MarketingImpactComponent),
      },
      // Foundation Lens — Projects page
      {
        path: 'foundation/projects',
        data: { lens: 'foundation' },
        canActivate: [projectQueryParamGuard],
        loadComponent: () => import('./modules/dashboards/foundation-projects/foundation-projects.component').then((m) => m.FoundationProjectsComponent),
      },
      // Project Lens dashboard (placeholder — reuses DashboardComponent for now)
      {
        path: 'project/overview',
        data: { lens: 'project' },
        canActivate: [projectQueryParamGuard],
        loadComponent: () => import('./modules/dashboards/dashboard.component').then((m) => m.DashboardComponent),
      },
      // Org Lens — dark-launched behind `org-lens-enabled` (CanMatch); /org/* is invisible when the flag is off.
      {
        path: 'org',
        canMatch: [orgLensEnabledGuard],
        data: { lens: 'org' },
        children: [
          {
            path: '',
            pathMatch: 'full',
            redirectTo: 'overview',
          },
          {
            path: 'overview',
            data: {
              lens: 'org',
              title: 'Org Overview',
              description: 'A summary of your organization across the Linux Foundation.',
              icon: 'fa-light fa-grid-2',
              showDevelopmentNotice: true,
            },
            loadComponent: () => import('./modules/dashboards/org/org-overview/org-overview.component').then((m) => m.OrgOverviewComponent),
          },
          {
            path: 'memberships',
            data: { lens: 'org', title: 'Memberships', description: 'Active memberships and tier history.', icon: 'fa-light fa-display' },
            loadComponent: () => import('./modules/dashboards/org/org-memberships/org-memberships.component').then((m) => m.OrgMembershipsComponent),
          },
          {
            path: 'memberships/:foundationSlug',
            data: {
              lens: 'org',
              title: 'Membership Detail',
              description: 'Key contacts, board, governance, and documentation for a membership.',
              icon: 'fa-light fa-id-card',
            },
            loadComponent: () =>
              import('./modules/dashboards/org/org-membership-detail/org-membership-detail.component').then((m) => m.OrgMembershipDetailComponent),
          },
          {
            path: 'projects',
            data: { lens: 'org', title: 'Projects', description: 'Projects your organization participates in.', icon: 'fa-light fa-folder' },
            loadComponent: loadOrgPlaceholderPage,
          },
          {
            path: 'roi',
            data: { lens: 'org', title: 'ROI', description: 'Return on investment across your memberships and engagement.', icon: 'fa-light fa-chart-line-up' },
            loadComponent: loadOrgPlaceholderPage,
          },
          {
            path: 'governance',
            data: { lens: 'org', title: 'Governance', description: 'Board seats and governance participation.', icon: 'fa-light fa-layer-group' },
            loadComponent: loadOrgPlaceholderPage,
          },
          {
            path: 'people',
            data: { lens: 'org', title: 'People', description: 'Employees and contributors associated with your organization.', icon: 'fa-light fa-users' },
            loadComponent: () => import('./modules/dashboards/org/org-people/org-people.component').then((m) => m.OrgPeopleComponent),
          },
          {
            path: 'contributions',
            data: {
              lens: 'org',
              title: 'Code Contributions',
              description: "Open-source contributions from your organization's contributors.",
              icon: 'fa-light fa-code',
            },
            loadComponent: loadOrgPlaceholderPage,
          },
          {
            path: 'events',
            data: { lens: 'org', title: 'Events', description: 'Events your organization is sponsoring or attending.', icon: 'fa-light fa-calendar' },
            loadComponent: () => import('./modules/events/org-events-dashboard/org-events-dashboard.component').then((m) => m.OrgEventsDashboardComponent),
          },
          {
            path: 'training',
            data: {
              lens: 'org',
              title: 'Training & Certification',
              description: 'Training enrollments and certifications across your organization.',
              icon: 'fa-light fa-graduation-cap',
            },
            loadComponent: loadOrgPlaceholderPage,
          },
          {
            path: 'meetings',
            data: { lens: 'org', title: 'Meetings', description: 'Meetings your organization is participating in.', icon: 'fa-light fa-video' },
            loadComponent: loadOrgPlaceholderPage,
          },
          {
            path: 'groups',
            data: { lens: 'org', title: 'Groups', description: 'Committees your organization participates in.', icon: 'fa-light fa-users-rectangle' },
            loadComponent: loadOrgPlaceholderPage,
          },
          {
            path: 'profile',
            data: { lens: 'org', title: 'Profile', description: 'Public-facing details about your organization.', icon: 'fa-light fa-file' },
            loadComponent: loadOrgProfilePage,
          },
        ],
      },
      // Foundation Lens — feature routes (lens-tagged so deep links restore the foundation lens)
      {
        path: 'foundation/meetings',
        data: { lens: 'foundation' },
        canActivate: [projectQueryParamGuard],
        loadChildren: () => import('./modules/meetings/meetings.routes').then((m) => m.MEETING_ROUTES),
      },
      {
        path: 'foundation/events',
        data: { lens: 'foundation' },
        canActivate: [projectQueryParamGuard],
        loadChildren: () => import('./modules/events/events.routes').then((m) => m.EVENTS_ROUTES),
      },
      {
        path: 'foundation/mailing-lists',
        data: { lens: 'foundation' },
        canActivate: [projectQueryParamGuard],
        loadChildren: () => import('./modules/mailing-lists/mailing-lists.routes').then((m) => m.MAILING_LIST_ROUTES),
      },
      {
        path: 'foundation/groups',
        data: { lens: 'foundation' },
        canActivate: [projectQueryParamGuard],
        loadChildren: () => import('./modules/committees/committees.routes').then((m) => m.COMMITTEE_ROUTES),
      },
      {
        path: 'foundation/documents',
        data: { lens: 'foundation' },
        canActivate: [projectQueryParamGuard],
        loadChildren: () => import('./modules/documents/documents.routes').then((m) => m.DOCUMENT_ROUTES),
      },
      {
        path: 'foundation/votes',
        data: { lens: 'foundation' },
        canActivate: [projectQueryParamGuard],
        loadChildren: () => import('./modules/votes/votes.routes').then((m) => m.VOTE_ROUTES),
      },
      {
        path: 'foundation/surveys',
        data: { lens: 'foundation' },
        canActivate: [projectQueryParamGuard],
        loadChildren: () => import('./modules/surveys/surveys.routes').then((m) => m.SURVEY_ROUTES),
      },
      {
        path: 'foundation/newsletters',
        data: { lens: 'foundation' },
        canActivate: [newsletterAccessGuard, projectQueryParamGuard],
        loadChildren: () => import('./modules/newsletters/newsletters.routes').then((m) => m.NEWSLETTER_ROUTES),
      },
      {
        path: 'foundation/settings',
        data: { lens: 'foundation' },
        canActivate: [projectQueryParamGuard],
        loadChildren: () => import('./modules/settings/settings.routes').then((m) => m.SETTINGS_ROUTES),
      },
      // Project Lens — feature routes (lens-tagged so deep links restore the project lens)
      {
        path: 'project/meetings',
        data: { lens: 'project' },
        canActivate: [projectQueryParamGuard],
        loadChildren: () => import('./modules/meetings/meetings.routes').then((m) => m.MEETING_ROUTES),
      },
      {
        path: 'project/mailing-lists',
        data: { lens: 'project' },
        canActivate: [projectQueryParamGuard],
        loadChildren: () => import('./modules/mailing-lists/mailing-lists.routes').then((m) => m.MAILING_LIST_ROUTES),
      },
      {
        path: 'project/groups',
        data: { lens: 'project' },
        canActivate: [projectQueryParamGuard],
        loadChildren: () => import('./modules/committees/committees.routes').then((m) => m.COMMITTEE_ROUTES),
      },
      {
        path: 'project/documents',
        data: { lens: 'project' },
        canActivate: [projectQueryParamGuard],
        loadChildren: () => import('./modules/documents/documents.routes').then((m) => m.DOCUMENT_ROUTES),
      },
      {
        path: 'project/votes',
        data: { lens: 'project' },
        canActivate: [projectQueryParamGuard],
        loadChildren: () => import('./modules/votes/votes.routes').then((m) => m.VOTE_ROUTES),
      },
      {
        path: 'project/surveys',
        data: { lens: 'project' },
        canActivate: [projectQueryParamGuard],
        loadChildren: () => import('./modules/surveys/surveys.routes').then((m) => m.SURVEY_ROUTES),
      },
      {
        path: 'project/newsletters',
        data: { lens: 'project' },
        canActivate: [newsletterAccessGuard, projectQueryParamGuard],
        loadChildren: () => import('./modules/newsletters/newsletters.routes').then((m) => m.NEWSLETTER_ROUTES),
      },
      {
        path: 'project/settings',
        data: { lens: 'project' },
        canActivate: [projectQueryParamGuard],
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
        path: 'newsletters',
        canActivate: [lensRedirectGuard, newsletterAccessGuard],
        loadChildren: () => import('./modules/newsletters/newsletters.routes').then((m) => m.NEWSLETTER_ROUTES),
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
  // Invite acceptance — authGuard preserves ?token= through the Auth0 login redirect.
  {
    path: 'invite',
    canActivate: [authGuard],
    loadComponent: () => import('./modules/invite/invite.component').then((m) => m.InviteComponent),
  },
  // Error page is outside the auth guard so expired/invalid links are visible without login.
  {
    path: 'invite/error',
    loadComponent: () => import('./modules/invite/invite-error/invite-error.component').then((m) => m.InviteErrorComponent),
  },
];
