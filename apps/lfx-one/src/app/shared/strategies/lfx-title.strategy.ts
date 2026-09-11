// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject, Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRouteSnapshot, PRIMARY_OUTLET, RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { formatLfxDocumentTitle } from '@lfx-one/shared/utils';

/**
 * Applies a per-route document title on every navigation (SSR and client).
 *
 * Prefers Angular's route `title` (the first-class key). When a leaf has none, falls back to
 * `data.title` — many org-lens routes already store page-header copy there, and that wording
 * is the document title we want. The result is always formatted as `Page · LFX` unless the
 * value is already branded (docs / public profile).
 *
 * Leaves untitled routes at the brand (`LFX`) rather than keeping a previous page's title.
 */
@Injectable({ providedIn: 'root' })
export class LfxTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);

  public override updateTitle(routerState: RouterStateSnapshot): void {
    this.title.setTitle(formatLfxDocumentTitle(this.resolvePageTitle(routerState)));
  }

  private resolvePageTitle(snapshot: RouterStateSnapshot): string | undefined {
    let page: string | undefined;
    let route: ActivatedRouteSnapshot | undefined = snapshot.root;
    while (route) {
      const resolved = this.getResolvedTitleForRoute(route);
      const dataTitle = route.data['title'];
      const fromRoute = typeof resolved === 'string' ? resolved.trim() : '';
      const fromData = typeof dataTitle === 'string' ? dataTitle.trim() : '';
      const candidate = fromRoute || fromData;
      if (candidate) {
        page = candidate;
      }
      route = route.children.find((child) => child.outlet === PRIMARY_OUTLET);
    }
    return page;
  }
}
