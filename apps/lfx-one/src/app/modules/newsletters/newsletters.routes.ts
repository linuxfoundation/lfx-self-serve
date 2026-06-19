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
    // Dev/preview surface for the Phase-1 block composer (LFXV2-2381). Mounts the
    // standalone composer with the loaded manifest so it can be exercised in the
    // running app without touching the existing newsletter wizard.
    path: 'composer-preview',
    canActivate: [authGuard, newsletterAccessGuard],
    loadComponent: () => import('./newsletter-composer-preview/newsletter-composer-preview.component').then((m) => m.NewsletterComposerPreviewComponent),
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
];
