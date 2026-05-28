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
    path: ':id/edit',
    canActivate: [authGuard, newsletterAccessGuard],
    loadComponent: () => import('./newsletter-manage/newsletter-manage.component').then((m) => m.NewsletterManageComponent),
    data: { preload: false },
  },
  {
    path: ':id/analytics',
    canActivate: [authGuard, newsletterAccessGuard],
    loadComponent: () => import('./newsletter-analytics/newsletter-analytics.component').then((m) => m.NewsletterAnalyticsComponent),
    data: { preload: false },
  },
];
