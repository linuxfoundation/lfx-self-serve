// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { VoteParticipationStats } from '@lfx-one/shared/interfaces';

/** Participation summary card for vote results — participants, responses, response rate, optional Abstained stat. */
@Component({
  selector: 'lfx-vote-participation-card',
  templateUrl: './vote-participation-card.component.html',
  host: { class: 'contents' },
})
export class VoteParticipationCardComponent {
  // === Inputs ===
  public readonly stats = input.required<VoteParticipationStats>();
  /** Shows the 4th "Abstained" stat — callers pass true when the vote allows abstain or results report abstentions. */
  public readonly showAbstained = input<boolean>(false);
  /** Pseudo-anonymous results are held (#3916): the abstention count is withheld, so the stat reads "—" rather than a false 0. */
  public readonly abstainedHeld = input<boolean>(false);
  public readonly testId = input<string>('vote-results-participation');
}
