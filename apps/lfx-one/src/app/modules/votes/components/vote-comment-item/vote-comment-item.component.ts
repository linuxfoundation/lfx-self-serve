// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, input, output, Signal } from '@angular/core';
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
  /**
   * `button` (default) shows a trailing "View ballot" button. `row` drops it: the commenter's name becomes the keyboard
   * control and a pointer click outside the comment prose opens the ballot too. Only effective where `showBallotLink` is allowed.
   */
  public readonly linkStyle = input<'button' | 'row'>('button');

  // === Outputs ===
  /** The response's `vote_id` — the vote response (ballot) uid the Voters tab opens. */
  public readonly viewBallot = output<string>();

  // === Computed Signals ===
  /** The ballot uid a click may open: manager on a named vote, a non-anonymous row and a known ballot. */
  protected readonly ballotId: Signal<string | null> = computed(() => (!this.anonymous() && this.showBallotLink() ? (this.response().vote_id ?? null) : null));
  protected readonly rowClickable: Signal<boolean> = computed(() => this.linkStyle() === 'row' && this.ballotId() !== null);

  // === Protected Methods ===
  /** Pointer convenience for row mode; prose stays selectable and nested links/buttons keep their own behavior. */
  protected onRowClick(event: MouseEvent): void {
    const voteId = this.ballotId();
    if (!this.rowClickable() || !voteId) return;
    const target = event.target as Element | null;
    if (target?.closest('.comment-text, a, button')) return;
    // Selecting a quote in this row is not an intent to open its ballot.
    const selection = target?.ownerDocument.defaultView?.getSelection();
    const row = event.currentTarget as Node | null;
    if (selection && !selection.isCollapsed && row) {
      for (let index = 0; index < selection.rangeCount; index++) {
        if (selection.getRangeAt(index).intersectsNode(row)) return;
      }
    }
    this.viewBallot.emit(voteId);
  }
}
