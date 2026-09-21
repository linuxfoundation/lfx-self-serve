// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component } from '@angular/core';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';

/**
 * My Application Tasks tab — placeholder until the full implementation lands.
 * The shell owns the H1 and tab bar; this component renders only the tab body.
 */
@Component({
  selector: 'lfx-mentorship-mentee-application-tasks',
  imports: [EmptyStateComponent],
  templateUrl: './mentee-application-tasks.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenteeApplicationTasksComponent {}
