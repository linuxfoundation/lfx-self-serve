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
    // Flat, cross-publication list of the project's newsletters (with draft/
    // scheduled/sent tabs). NewsletterListComponent renders unfiltered when no
    // :pubId is present. This is the post-action landing target for the manage
    // and analytics flows (goToList / goBack navigate to ['list']); it must
    // stay a real route so those navigations don't fall through to the
    // :projectUid/:pubId/editions matcher below and render a broken
    // "publication 'list'" editions view. Single-segment, so it precedes it.
    path: 'list',
    canActivate: [authGuard, newsletterAccessGuard],
    loadComponent: () => import('./newsletter-list/newsletter-list.component').then((m) => m.NewsletterListComponent),
    data: { preload: false },
  },
  {
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
  // NOTE: the shareable reader permalink (/newsletters/:projectSlug/:id) is
  // deliberately NOT a child here. This routes file is mounted at the flat
  // `newsletters` path (behind lensRedirectGuard) and at the lens-prefixed
  // /foundation/newsletters and /project/newsletters mounts (behind
  // newsletterAccessGuard) — either mount would break the any-authenticated-user
  // access model. The reader is mounted directly in app.routes.ts, ahead of the
  // flat mount.
  {
    // Publication editions list: /newsletters/:projectUid/:pubId/editions shows
    // all editions for that publication. projectUid travels in the URL rather
    // than being read off the active-context cookie — the same rationale as the
    // sibling edit/analytics routes above: a deep link opened next to a stale
    // or different active-context cookie must still resolve the publication's
    // own project, not whichever project the cookie currently points at.
    //
    // Three segments, not two: this file is also mounted at the flat
    // `newsletters` path in app.routes.ts, where a two-segment
    // `:projectUid/:pubId` would collide with the sibling shareable reader
    // permalink route declared there (`newsletters/:projectSlug/:id`, checked
    // first) and never be reached. The trailing `editions` segment disambiguates
    // it, mirroring the edit/analytics routes' own trailing keyword. Must come
    // after the more specific routes above.
    path: ':projectUid/:pubId/editions',
    canActivate: [authGuard, newsletterAccessGuard],
    loadComponent: () => import('./newsletter-list/newsletter-list.component').then((m) => m.NewsletterListComponent),
    data: { preload: false },
  },
];
