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
 * is the document title we want. The result is always formatted as `{Page} · LFX` unless the
 * value is already branded (docs / public profile).
 *
 * Leaves untitled routes at the brand (`LFX`) rather than keeping a previous page's title.
 *
 * Same-config-chain navigations (query params, path params on the same component tree) do not
 * reset a title a component already applied via `bindLfxDocumentTitle` or `Title.setTitle`.
 */
@Injectable({ providedIn: 'root' })
export class LfxTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private lastChainKey: string | undefined;
  private lastAppliedRouteTitle: string | undefined;

  public override updateTitle(routerState: RouterStateSnapshot): void {
    const chainKey = this.primaryConfigChain(routerState.root);
    const sameChain = chainKey === this.lastChainKey;
    this.lastChainKey = chainKey;

    const next = formatLfxDocumentTitle(this.resolvePageTitle(routerState));
    // A component (entity binder, docs article, public profile) already owns the title for
    // this activation — keep it instead of flashing the static route title on ?tab= / ?step=.
    if (sameChain && this.lastAppliedRouteTitle !== undefined && this.title.getTitle() !== this.lastAppliedRouteTitle) {
      return;
    }
    this.lastAppliedRouteTitle = next;
    this.title.setTitle(next);
  }

  private primaryConfigChain(root: ActivatedRouteSnapshot): string {
    const parts: string[] = [];
    let route: ActivatedRouteSnapshot | undefined = root;
    while (route) {
      parts.push(route.routeConfig?.path ?? '');
      route = route.children.find((child) => child.outlet === PRIMARY_OUTLET);
    }
    return parts.join('/');
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
