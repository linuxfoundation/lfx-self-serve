// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import type { FormationItem, FormationItemStatus } from '@lfx-one/shared/interfaces';
import type { TagSeverity } from '@lfx-one/shared/interfaces';

const STATUS_LABEL: Record<FormationItemStatus, string> = {
  done: 'Done',
  in_progress: 'In progress',
  waiting_on_partner: 'Waiting on partner',
  not_started: 'Not started',
  skipped: 'Skipped',
};

const STATUS_SEVERITY: Record<FormationItemStatus, TagSeverity> = {
  done: 'success',
  in_progress: 'warn',
  waiting_on_partner: 'accent',
  not_started: 'secondary',
  skipped: 'secondary',
};

@Component({
  selector: 'lfx-formation-checklist-row',
  imports: [TagComponent, ButtonComponent],
  templateUrl: './formation-checklist-row.component.html',
  styleUrl: './formation-checklist-row.component.scss',
})
export class FormationChecklistRowComponent {
  public readonly item = input.required<FormationItem>();

  public readonly openDrawer = output<FormationItem>();
  /** Fired for the `manual`/`provisionable`/`request` action kinds — the orchestrator owns the actual service call. */
  public readonly actionTriggered = output<FormationItem>();

  protected readonly statusLabel = computed(() => STATUS_LABEL[this.item().status]);
  protected readonly statusSeverity = computed(() => STATUS_SEVERITY[this.item().status]);
  protected readonly statusOutlined = computed(() => this.item().status === 'not_started');

  protected onOpenDrawer(): void {
    this.openDrawer.emit(this.item());
  }

  protected onAction(): void {
    this.actionTriggered.emit(this.item());
  }
}
