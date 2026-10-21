// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MktgBreadcrumbItem } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-mktg-breadcrumb',
  imports: [RouterLink],
  templateUrl: './mktg-breadcrumb.component.html',
})
export class MktgBreadcrumbComponent {
  public readonly crumbs = input.required<MktgBreadcrumbItem[]>();
  /** The active project slug, supplied by the page context, not copied from the URL. */
  public readonly project = input<string | null>(null);
  protected readonly items = computed(() => this.crumbs().map((crumb) => ({ ...crumb, queryParams: { ...crumb.queryParams, project: this.project() } })));
}
