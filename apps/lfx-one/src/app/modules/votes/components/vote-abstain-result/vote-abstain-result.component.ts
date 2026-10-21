// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { VoteParticipationStats } from '@lfx-one/shared/interfaces';

/** Vote-level abstention row — muted and never winner-styled; `live` matches the live option bars, `final` the final option cards. */
@Component({
  selector: 'lfx-vote-abstain-result',
  templateUrl: './vote-abstain-result.component.html',
  host: { class: 'contents' },
})
export class VoteAbstainResultComponent {
  // === Inputs ===
  public readonly stats = input.required<VoteParticipationStats>();
  public readonly variant = input<'live' | 'final'>('final');
  public readonly testId = input<string>('vote-results-option-abstain');
}
