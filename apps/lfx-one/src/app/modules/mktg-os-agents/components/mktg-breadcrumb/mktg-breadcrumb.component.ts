// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { MktgBreadcrumbItem, MktgBreadcrumbPage } from '@lfx-one/shared/interfaces';
import { buildMktgBreadcrumbs, mktgKitRootPath } from '@lfx-one/shared/utils';
import { ProjectContextService } from '@services/project-context.service';
import { filter, map } from 'rxjs';

@Component({
  selector: 'lfx-mktg-breadcrumb',
  imports: [RouterLink],
  templateUrl: './mktg-breadcrumb.component.html',
})
export class MktgBreadcrumbComponent {
  private readonly context = inject(ProjectContextService);
  private readonly router = inject(Router);

  public readonly page = input.required<MktgBreadcrumbPage>();

  private readonly url = this.initUrl();
  private readonly kitRoot = computed(() => mktgKitRootPath(this.url()));
  protected readonly items = this.initItems();

  private initUrl(): Signal<string> {
    return toSignal(
      this.router.events.pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        map((event) => event.urlAfterRedirects)
      ),
      { initialValue: this.router.url }
    );
  }

  private initItems(): Signal<MktgBreadcrumbItem[]> {
    return computed(() => {
      const project = this.context.activeContext();
      return buildMktgBreadcrumbs(this.page(), this.kitRoot(), project?.name ?? '').map((crumb) => ({
        ...crumb,
        queryParams: { project: project?.slug ?? null },
      }));
    });
  }
}
