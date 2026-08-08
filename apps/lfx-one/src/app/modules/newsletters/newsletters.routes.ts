// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';
import { authGuard } from '@shared/guards/auth.guard';
import { newsletterAccessGuard } from '@shared/guards/newsletter-access.guard';

export const NEWSLETTER_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    canActivate: [authGuard, newsletterAccessGuard],
    loadComponent: () => import('./newsletter-publication-list/newsletter-publication-list.component').then((m) => m.NewsletterPublicationListComponent),
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
    // Specific routes with two segments must come before the generic :pubId
    // to avoid being caught by the :pubId matcher.
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
    // Publication editions list: /newsletters/:pubId shows all editions for that publication.
    // This must come after the more specific two-segment routes.
    path: ':pubId',
    canActivate: [authGuard, newsletterAccessGuard],
    loadComponent: () => import('./newsletter-list/newsletter-list.component').then((m) => m.NewsletterListComponent),
    data: { preload: false },
  },
];
