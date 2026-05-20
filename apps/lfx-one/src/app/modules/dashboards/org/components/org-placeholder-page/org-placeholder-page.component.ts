// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Data } from '@angular/router';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';

interface OrgPlaceholderRouteData {
  title?: string;
  description?: string;
  icon?: string;
}

@Component({
  selector: 'lfx-org-placeholder-page',
  imports: [EmptyStateComponent],
  templateUrl: './org-placeholder-page.component.html',
})
export class OrgPlaceholderPageComponent {
  private readonly route = inject(ActivatedRoute);

  private readonly routeData: Signal<Data> = toSignal(this.route.data, { initialValue: {} as Data });

  protected readonly title = computed(() => (this.routeData() as OrgPlaceholderRouteData).title ?? 'Coming Soon');
  protected readonly description = computed(() => (this.routeData() as OrgPlaceholderRouteData).description ?? 'This view is in development.');
  protected readonly icon = computed(() => (this.routeData() as OrgPlaceholderRouteData).icon ?? 'fa-light fa-screwdriver-wrench');
}
