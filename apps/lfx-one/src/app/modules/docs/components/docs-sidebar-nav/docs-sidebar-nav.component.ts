// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { isDocsPath } from '@lfx-one/shared/utils';
import { TooltipModule } from 'primeng/tooltip';
import { filter, map, startWith } from 'rxjs';

/**
 * Public minimal small-left-nav surfaced inside `DocsLayoutComponent` for
 * unauthenticated visitors (FR-009b).
 *
 * Layout matches `LensSwitcherComponent`'s 64-px column so the visual gestalt
 * stays continuous across auth states (FR-009c). No lens switcher, no avatar
 * — just the docs icon, the "What's new" placeholder, and a sign-in entry.
 *
 * Sign-in CTA: links to `/login?returnTo=<current path>` so the existing
 * Auth0 / Authelia handler returns the visitor to wherever they were on the
 * docs portal. The returnTo is derived from `router.url` and recomputed on
 * every NavigationEnd so deep links retain context.
 *
 * "What's new" stays a visual cue — the underlying changelog endpoint is
 * authenticated (`/api/changelog`), so for anonymous visitors the icon
 * deep-links to the same sign-in flow with returnTo preserved. This avoids
 * a ghost button and keeps the public surface consistent with FR-026.
 */
@Component({
  selector: 'lfx-docs-sidebar-nav',
  standalone: true,
  imports: [NgClass, RouterLink, TooltipModule],
  templateUrl: './docs-sidebar-nav.component.html',
})
export class DocsSidebarNavComponent {
  private readonly router = inject(Router);

  /** Active when the route lives under `/docs/*` — matches the lens-switcher behaviour. */
  protected readonly isDocsActive = this.initIsDocsActive();

  /**
   * Encoded returnTo query parameter for the sign-in CTA. Falls back to
   * `/docs` so the destination is always meaningful even before the first
   * NavigationEnd fires.
   */
  protected readonly signInUrl = this.initSignInUrl();

  protected readonly whatsNewHref = computed(() => this.signInUrl());

  private initIsDocsActive() {
    return toSignal(
      this.router.events.pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        map((event) => isDocsPath(event.urlAfterRedirects)),
        startWith(isDocsPath(this.router.url))
      ),
      { requireSync: true }
    );
  }

  private initSignInUrl() {
    return toSignal(
      this.router.events.pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        map(() => this.buildLoginHref()),
        startWith(this.buildLoginHref())
      ),
      { requireSync: true }
    );
  }

  private buildLoginHref(): string {
    // SSR: router.url is the request path; in the browser it's the live URL
    // — both produce the encoded returnTo without platform branching.
    const target = this.router.url || '/docs';
    return `/login?returnTo=${encodeURIComponent(target)}`;
  }
}
