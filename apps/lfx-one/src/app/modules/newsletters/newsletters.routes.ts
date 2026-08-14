// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';
import { authGuard } from '@shared/guards/auth.guard';
import { newsletterAccessGuard } from '@shared/guards/newsletter-access.guard';

export const NEWSLETTER_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'list',
  },
  {
    path: 'list',
    canActivate: [authGuard, newsletterAccessGuard],
    loadComponent: () => import('./newsletter-list/newsletter-list.component').then((m) => m.NewsletterListComponent),
    data: { preload: false },
  },
  {
    path: 'create',
    canActivate: [authGuard, newsletterAccessGuard],
    loadComponent: () => import('./newsletter-manage/newsletter-manage.component').then((m) => m.NewsletterManageComponent),
    data: { preload: false },
  },
  {
    // Me-lens member feed: sent newsletters reachable via the user's committee
    // memberships. authGuard only — newsletterAccessGuard is the manager
    // (ED/project-writer) gate and must not block regular committee members.
    path: 'my',
    canActivate: [authGuard],
    loadComponent: () => import('./my-newsletters/my-newsletters.component').then((m) => m.MyNewslettersComponent),
    data: { preload: false },
  },
  {
    // projectUid is in the URL so edit/analytics survive a foundation-vs-project
    // context switch — the owning project travels with the link rather than being
    // re-derived from whatever context happens to be active when the route loads.
    path: ':projectUid/:id/edit',
    canActivate: [authGuard, newsletterAccessGuard],
    loadComponent: () => import('./newsletter-manage/newsletter-manage.component').then((m) => m.NewsletterManageComponent),
    data: { preload: false },
  },
  {
    path: ':projectUid/:id/analytics',
    canActivate: [authGuard, newsletterAccessGuard],
    loadComponent: () => import('./newsletter-analytics/newsletter-analytics.component').then((m) => m.NewsletterAnalyticsComponent),
    data: { preload: false },
  },
  {
    // Reader page for shareable newsletter permalinks. Any authenticated user
    // may view sent newsletters (gated upstream on project#viewer, which includes
    // user:* wildcard). Non-managers cannot view drafts. projectSlug enables
    // human-readable URLs; slug-to-uid resolution happens in the component.
    path: ':projectSlug/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./newsletter-reader/newsletter-reader.component').then((m) => m.NewsletterReaderComponent),
    data: { preload: false },
  },
];
