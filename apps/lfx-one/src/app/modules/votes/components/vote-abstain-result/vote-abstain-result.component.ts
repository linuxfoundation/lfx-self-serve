// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { VoteParticipationStats } from '@lfx-one/shared/interfaces';

/** Vote-level abstention row — muted and never winner-styled; `live` matches the live option bars, `final` the final option cards. */
@Component({
  selector: 'lfx-vote-abstain-result',
  imports: [NgTemplateOutlet],
  templateUrl: './vote-abstain-result.component.html',
  host: { class: 'contents' },
})
export class VoteAbstainResultComponent {
  // === Inputs ===
  public readonly stats = input.required<VoteParticipationStats>();
  public readonly variant = input<'live' | 'final'>('final');
  public readonly testId = input<string>('vote-results-option-abstain');
  /** Turns the abstention count into a link to the abstainers when someone abstained — vote managers on named votes only (#3914). */
  public readonly showVoterLinks = input<boolean>(false);

  // === Outputs ===
  public readonly viewVoters = output<void>();
}
