// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, computed, input, output, Signal } from '@angular/core';
import { ORG_MAINTAINER_ROLES_UNAVAILABLE_HINT, PERSON_DETAIL_TRAINING_WINDOW_NOTE } from '@lfx-one/shared/constants';
import type { OrgAllEmployeeDetail, OrgPersonCodeCount } from '@lfx-one/shared/interfaces';
import { orgPersonCodeCount } from '@lfx-one/shared/utils';
import { TooltipModule } from 'primeng/tooltip';

/** Expandable detail sub-table for one All Employees row — up to five sections; the training section is always shown so its window note stays visible. */
@Component({
  selector: 'lfx-org-people-all-employees-detail',
  imports: [DecimalPipe, TooltipModule],
  templateUrl: './all-employees-detail.component.html',
})
export class AllEmployeesDetailComponent {
  public readonly detail = input.required<OrgAllEmployeeDetail | null | undefined>();
  public readonly loading = input<boolean>(false);
  public readonly error = input<boolean>(false);
  public readonly retry = output<void>();

  protected readonly maintainerRolesUnavailableHint = ORG_MAINTAINER_ROLES_UNAVAILABLE_HINT;
  // The code column counts what the row does — the page's range, project type and code count (lfx-self-serve#4404).
  protected readonly codeCount: Signal<OrgPersonCodeCount> = computed(() => orgPersonCodeCount(this.detail()?.codeView));

  protected readonly trainingWindowNote = PERSON_DETAIL_TRAINING_WINDOW_NOTE;

  protected readonly boardSeats = computed(() => this.detail()?.boardSeats ?? []);
  protected readonly committeeSeats = computed(() => this.detail()?.committeeSeats ?? []);
  protected readonly code = computed(() => this.detail()?.code ?? []);
  protected readonly events = computed(() => this.detail()?.events ?? []);
  protected readonly training = computed(() => this.detail()?.training ?? []);

  // Server denormalizes the aggregate on every event row; render once in the section header instead of repeating per row.
  protected readonly eventsTotal = computed(() => this.events()[0]?.eventsCount ?? 0);
}
