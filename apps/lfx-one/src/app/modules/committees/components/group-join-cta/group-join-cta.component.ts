// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, output, Signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { Committee } from '@lfx-one/shared/interfaces';

/**
 * Visitor join CTA shared between the Overview and About tabs — a single "Interested in
 * joining?" card (or an invite-only notice) driven by the committee's `join_mode`.
 *
 * `canJoin()` only fires for `open` mode and `showInviteOnlyNotice()` only for `invite_only`/unset,
 * so an `application`-mode visitor sees neither — application-based joining is product-disabled
 * for now (no ticket yet), so the label/icon/description computeds below only handle the two
 * modes that actually render.
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

  // Complex computed via private init functions
  public canJoin: Signal<boolean> = this.initCanJoin();
  public showInviteOnlyNotice: Signal<boolean> = this.initShowInviteOnlyNotice();
  public joinButtonLabel: Signal<string> = this.initJoinButtonLabel();
  public joinButtonIcon: Signal<string> = this.initJoinButtonIcon();
  public joinCtaIcon: Signal<string> = this.initJoinCtaIcon();
  public joinCtaTitle: Signal<string> = this.initJoinCtaTitle();
  public joinCtaDescription: Signal<string> = this.initJoinCtaDescription();
  public inviteOnlyTitle: Signal<string> = this.initInviteOnlyTitle();
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

  private initJoinButtonLabel(): Signal<string> {
    return computed(() => (this.committee().join_mode === 'open' ? 'Join Group' : 'Contact Admin'));
  }

  /** Icon for the CTA button — matches the header button icon */
  private initJoinButtonIcon(): Signal<string> {
    return computed(() => (this.committee().join_mode === 'open' ? 'fa-light fa-user-plus' : 'fa-light fa-envelope'));
  }

  /** Large illustrative icon above the CTA card title */
  private initJoinCtaIcon(): Signal<string> {
    return computed(() => 'fa-light fa-users');
  }

  private initJoinCtaTitle(): Signal<string> {
    return computed(() => `Interested in ${this.committee().name}?`);
  }

  private initJoinCtaDescription(): Signal<string> {
    return computed(() => 'Participate in meetings, vote on proposals, access resources, and collaborate with the group.');
  }

  private initInviteOnlyTitle(): Signal<string> {
    return computed(() => 'Membership is by invitation only');
  }

  private initInviteOnlyDescription(): Signal<string> {
    return computed(() => {
      const name = this.committee().name;
      return `${name} is invite only. A group admin must send you an invitation before you can join.`;
    });
  }
}
