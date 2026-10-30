// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, input } from '@angular/core';
import { PublicProjectSummary, VoteAnswerSummaryLine } from '@lfx-one/shared/interfaces';

import { VoteLinkMarkComponent } from '../vote-link-mark/vote-link-mark.component';

/**
 * Full-screen confirmation after a successful submit or update on the login-free ballot page (#4692). Shows the
 * project and vote title, what the voter chose (or that the ballot is secret), and the deadline. Two plain links into Self
 * Serve (the LFX mark and the votes list); no sign-in prompt, nothing about the voter or the token.
 */
@Component({
  selector: 'lfx-vote-link-thank-you',
  imports: [DatePipe, VoteLinkMarkComponent],
  templateUrl: './vote-link-thank-you.component.html',
  host: { class: 'block' },
})
export class VoteLinkThankYouComponent {
  public readonly project = input<PublicProjectSummary | null>(null);
  public readonly title = input.required<string>();
  public readonly endTime = input<string | null>(null);
  public readonly updated = input<boolean>(false);
  public readonly abstained = input<boolean>(false);
  /** Pseudo-anonymous votes never echo the answers back. */
  public readonly secret = input<boolean>(false);
  public readonly answers = input<VoteAnswerSummaryLine[]>([]);
}
