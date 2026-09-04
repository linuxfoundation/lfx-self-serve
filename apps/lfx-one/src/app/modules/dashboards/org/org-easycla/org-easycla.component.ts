// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component } from '@angular/core';

import { EmptyStateComponent } from '@components/empty-state/empty-state.component';

@Component({
  selector: 'lfx-org-easycla',
  imports: [EmptyStateComponent],
  templateUrl: './org-easycla.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgEasyclaComponent {}
