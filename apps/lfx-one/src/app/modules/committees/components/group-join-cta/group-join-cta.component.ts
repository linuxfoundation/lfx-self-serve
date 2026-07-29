// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, output, Signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { Committee } from '@lfx-one/shared/interfaces';

/**
 * Visitor join CTA shared between the Overview and About tabs — a single "Interested in
 * joining?" card (or an invite-only notice) driven by the committee's `join_mode`.
 *
 * `canJoin()` only fires for `open` mode, so the CTA card's label/icon/description never actually
 * branch on mode — they're plain constants, not computeds. `showInviteOnlyNotice()` only fires for
 * `invite_only`/unset. Neither ever resolves for `application` mode (product-disabled for now, no
 * ticket yet), so an application-mode visitor sees neither card.
 */
@Component({
  selector: 'lfx-group-join-cta',
  imports: [ButtonComponent],
  templateUrl: './group-join-cta.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GroupJoinCtaComponent {
  // Inputs
  public readonly committee = input.required<Committee>();
  public readonly isVisitor = input<boolean>(false);
  public readonly hasPendingInvite = input<boolean>(false);

  // Outputs
  public readonly joinRequested = output<void>();

  // Constants — the only two modes that ever reach the template (see class doc) share one label/
  // icon/description each, so there's nothing left to branch on.
  public readonly joinButtonLabel = 'Join Group';
  public readonly joinButtonIcon = 'fa-light fa-user-plus';
  public readonly joinCtaIcon = 'fa-light fa-users';
  public readonly joinCtaDescription = 'Participate in meetings, vote on proposals, access resources, and collaborate with the group.';
  public readonly inviteOnlyTitle = 'Membership is by invitation only';

  // Complex computed via private init functions
  public canJoin: Signal<boolean> = this.initCanJoin();
  public showInviteOnlyNotice: Signal<boolean> = this.initShowInviteOnlyNotice();
  public joinCtaTitle: Signal<string> = this.initJoinCtaTitle();
  public inviteOnlyDescription: Signal<string> = this.initInviteOnlyDescription();

  public onJoinClick(): void {
    this.joinRequested.emit();
  }

  private initCanJoin(): Signal<boolean> {
    return computed(() => {
      const mode = this.committee().join_mode;
      return this.isVisitor() && mode === 'open' && !this.hasPendingInvite();
    });
  }

  private initShowInviteOnlyNotice(): Signal<boolean> {
    return computed(() => {
      const mode = this.committee().join_mode;
      return this.isVisitor() && (mode === 'invite_only' || !mode) && !this.hasPendingInvite();
    });
  }

  private initJoinCtaTitle(): Signal<string> {
    return computed(() => `Interested in ${this.committee().name}?`);
  }

  private initInviteOnlyDescription(): Signal<string> {
    return computed(() => {
      const name = this.committee().name;
      return `${name} is invite only. A group admin must send you an invitation before you can join.`;
    });
  }
}
