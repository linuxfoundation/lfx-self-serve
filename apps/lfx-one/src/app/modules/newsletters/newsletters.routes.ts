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
    // Me-lens member feed: sent newsletters reachable via the user's committee
    // memberships. authGuard only — newsletterAccessGuard is the manager
    // (ED/project-writer) gate and must not block regular committee members.
    path: 'my',
    title: 'My Newsletters',
    canActivate: [authGuard],
    loadComponent: () => import('./my-newsletters/my-newsletters.component').then((m) => m.MyNewslettersComponent),
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
