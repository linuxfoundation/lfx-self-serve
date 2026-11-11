// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';
import { authGuard } from '@shared/guards/auth.guard';
import { newsletterAccessGuard } from '@shared/guards/newsletter-access.guard';
import { newsletterPublicationsEnabledGuard } from '@shared/guards/newsletter-publications-enabled.guard';

export const NEWSLETTER_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'list',
  },
  {
    path: 'list',
    // No title: inherit the mount (`Newsletters` / `Foundation Newsletters` / `Project Newsletters`)
    // so those history entries stay distinguishable.
    canActivate: [authGuard, newsletterAccessGuard],
    loadComponent: () => import('./newsletter-list/newsletter-list.component').then((m) => m.NewsletterListComponent),
    data: { preload: false },
  },
  {
    path: 'create',
    title: 'Create Newsletter',
    canActivate: [authGuard, newsletterAccessGuard],
    loadComponent: () => import('./newsletter-manage/newsletter-manage.component').then((m) => m.NewsletterManageComponent),
    data: { preload: false },
  },
  {
    // Publications carry projectUid and a third segment on purpose: the flat mount's reader
    // permalink owns any two-segment /newsletters/:projectSlug/:id (see the note below).
    path: ':projectUid/publications/create',
    title: 'New Publication',
    canMatch: [newsletterPublicationsEnabledGuard],
    canActivate: [authGuard, newsletterAccessGuard],
    loadComponent: () => import('./newsletter-publication-form/newsletter-publication-form.component').then((m) => m.NewsletterPublicationFormComponent),
    data: { preload: false },
  },
  {
    path: ':projectUid/publications/:publicationUid/edit',
    title: 'Edit Publication',
    canMatch: [newsletterPublicationsEnabledGuard],
    canActivate: [authGuard, newsletterAccessGuard],
    loadComponent: () => import('./newsletter-publication-form/newsletter-publication-form.component').then((m) => m.NewsletterPublicationFormComponent),
    data: { preload: false },
  },
  {
    // projectUid is in the URL so edit/analytics survive a foundation-vs-project
    // context switch — the owning project travels with the link rather than being
    // re-derived from whatever context happens to be active when the route loads.
    path: ':projectUid/:id/edit',
    title: 'Edit Newsletter',
    canActivate: [authGuard, newsletterAccessGuard],
    loadComponent: () => import('./newsletter-manage/newsletter-manage.component').then((m) => m.NewsletterManageComponent),
    data: { preload: false },
  },
  {
    path: ':projectUid/:id/analytics',
    title: 'Newsletter Analytics',
    canActivate: [authGuard, newsletterAccessGuard],
    loadComponent: () => import('./newsletter-analytics/newsletter-analytics.component').then((m) => m.NewsletterAnalyticsComponent),
    data: { preload: false },
  },
  // NOTE: the shareable reader permalink (/newsletters/:projectSlug/:id) is
  // deliberately NOT a child here. This routes file is mounted at the flat
  // `newsletters` path (behind lensRedirectGuard) and at the lens-prefixed
  // /foundation/newsletters and /project/newsletters mounts (behind
  // newsletterAccessGuard) — either mount would break the any-authenticated-user
  // access model. The reader is mounted directly in app.routes.ts, ahead of the
  // flat mount.
];
