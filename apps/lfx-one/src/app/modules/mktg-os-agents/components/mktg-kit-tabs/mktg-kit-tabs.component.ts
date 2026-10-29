// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { IsActiveMatchOptions, NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { MKTG_KIT_TABS, MKTG_KIT_SHOW_COMING_SOON, MKTG_OS_AGENTS_ROUTE_SEGMENT } from '@lfx-one/shared/constants';
import { ProjectContextService } from '@services/project-context.service';
import { filter, map, startWith } from 'rxjs';

@Component({
  selector: 'lfx-mktg-kit-tabs',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './mktg-kit-tabs.component.html',
})
export class MktgKitTabsComponent {
  private readonly router = inject(Router);
  private readonly context = inject(ProjectContextService);
  protected readonly tabs = MKTG_KIT_TABS.filter((tab) => MKTG_KIT_SHOW_COMING_SOON || !tab.soon);
  protected readonly exactMatch: IsActiveMatchOptions = { paths: 'exact', queryParams: 'ignored', matrixParams: 'ignored', fragment: 'ignored' };
  protected readonly subsetMatch: IsActiveMatchOptions = { ...this.exactMatch, paths: 'subset' };
  protected readonly basePath: Signal<string> = this.initBasePath();
  protected readonly projectQueryParams = computed(() => ({ project: this.context.activeContext()?.slug ?? null }));

  private initBasePath(): Signal<string> {
    return toSignal(
      this.router.events.pipe(
        filter((event) => event instanceof NavigationEnd),
        startWith(null),
        map(() => `${this.router.url.split(MKTG_OS_AGENTS_ROUTE_SEGMENT)[0]}${MKTG_OS_AGENTS_ROUTE_SEGMENT}`)
      ),
      { initialValue: '' }
    );
  }
}
