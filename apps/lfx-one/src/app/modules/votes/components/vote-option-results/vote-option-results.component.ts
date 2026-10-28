// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output } from '@angular/core';
import { VoteResultsOption } from '@lfx-one/shared/interfaces';

/** Option result rows for one generic question — `live` (leading highlight), `final` (creator, white track) or `voter-final` (voter, slate-100 track). */
@Component({
  selector: 'lfx-vote-option-results',
  templateUrl: './vote-option-results.component.html',
  host: { class: 'contents' },
})
export class VoteOptionResultsComponent {
  // === Inputs ===
  public readonly options = input.required<VoteResultsOption[]>();
  public readonly variant = input<'live' | 'final' | 'voter-final'>('final');
  /** Each row's test id is this prefix plus the option's choice id. */
  public readonly testIdPrefix = input<string>('vote-results-option-');
  /** Turns each option's vote count into a link to its voters — vote managers on named votes only (#3914). */
  public readonly showVoterLinks = input<boolean>(false);

  // === Outputs ===
  /** The `choiceId` of the option whose voters were asked for. */
  public readonly viewVoters = output<string>();
}
