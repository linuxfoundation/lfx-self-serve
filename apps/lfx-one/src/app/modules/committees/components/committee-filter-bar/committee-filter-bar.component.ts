// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { COMMITTEE_LABEL } from '@lfx-one/shared/constants';

/**
 * Search + foundation/project/voting-status filter bar shared by the committee table and the
 * groups-dashboard card/grouped views, so a filter change (new control, testid, copy) is made in
 * one place instead of three near-identical inline copies.
 */
@Component({
  selector: 'lfx-committee-filter-bar',
  imports: [ReactiveFormsModule, InputTextComponent, SelectComponent],
  templateUrl: './committee-filter-bar.component.html',
})
export class CommitteeFilterBarComponent {
  public readonly committeeLabel = COMMITTEE_LABEL;

  public readonly searchForm = input.required<FormGroup>();
  public readonly votingStatusOptions = input.required<{ label: string; value: string | null }[]>();
  public readonly showFoundationFilter = input<boolean>(false);
  public readonly showProjectFilter = input<boolean>(false);
  public readonly foundationOptions = input<{ label: string; value: string | null }[]>([]);
  public readonly projectOptions = input<{ label: string; value: string | null }[]>([]);

  public readonly foundationFilterChange = output<string | null>();
  public readonly projectFilterChange = output<string | null>();
}
