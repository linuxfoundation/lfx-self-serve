// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { ExpandableTextComponent } from '@components/expandable-text/expandable-text.component';
import { CommentResponseView } from '@lfx-one/shared/interfaces';
import { LinkifyPipe } from '@pipes/linkify.pipe';

/** One voter comment — shared by the Comments tab and the Overview preview so both apply the same anonymity rules (#4448). */
@Component({
  selector: 'lfx-vote-comment-item',
  imports: [DatePipe, ButtonComponent, ExpandableTextComponent, LinkifyPipe],
  templateUrl: './vote-comment-item.component.html',
  styleUrl: './vote-comment-item.component.scss',
  host: { class: 'contents' },
})
export class VoteCommentItemComponent {
  // === Inputs ===
  public readonly response = input.required<CommentResponseView>();
  /** Text only — no author, date, abstained label or ballot link: a pseudo-anonymous vote (#3916), or a non-manager on a named vote (#4330). */
  public readonly anonymous = input<boolean>(false);
  /** Adds a "View ballot" link — vote managers on named votes only (#3914). */
  public readonly showBallotLink = input<boolean>(false);

  // === Outputs ===
  /** The response's `vote_id` — the vote response (ballot) uid the Voters tab opens. */
  public readonly viewBallot = output<string>();
}
