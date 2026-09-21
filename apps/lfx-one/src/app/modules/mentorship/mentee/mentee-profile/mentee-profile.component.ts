// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component } from '@angular/core';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';

/**
 * Mentee Profile tab — placeholder until the full implementation lands.
 * The shell owns the H1 and tab bar; this component renders only the tab body.
 */
@Component({
  selector: 'lfx-mentorship-mentee-profile',
  imports: [EmptyStateComponent],
  templateUrl: './mentee-profile.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenteeProfileComponent {}
