// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, output, Signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { Committee } from '@lfx-one/shared/interfaces';

/**
 * Visitor join CTA shared between the Overview and About tabs — driven by the committee's `join_mode`.
 */
@Component({
  selector: 'lfx-group-join-cta',
  imports: [ButtonComponent],
  templateUrl: './group-join-cta.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GroupJoinCtaComponent {
  public readonly committee = input.required<Committee>();
  public readonly isVisitor = input<boolean>(false);
  public readonly hasPendingInvite = input<boolean>(false);

  public readonly joinRequested = output<void>();

  public readonly joinButtonLabel = 'Join Group';
  public readonly joinButtonIcon = 'fa-light fa-user-plus';
  public readonly applyButtonLabel = 'Apply to Join';
  public readonly applyButtonIcon = 'fa-light fa-file-signature';
  public readonly joinCtaIcon = 'fa-light fa-users';
  public readonly applyCtaIcon = 'fa-light fa-inbox';
  public readonly joinCtaDescription = 'Participate in meetings, vote on proposals, access resources, and collaborate with the group.';
  public readonly applyCtaDescription = 'Submit a request to join this group. A group admin will review your application and notify you of their decision.';
  public readonly inviteOnlyTitle = 'Membership is by invitation only';

  public canJoin: Signal<boolean> = this.initCanJoin();
  public canApply: Signal<boolean> = this.initCanApply();
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

  private initCanApply(): Signal<boolean> {
    return computed(() => {
      const mode = this.committee().join_mode;
      return this.isVisitor() && mode === 'application' && !this.hasPendingInvite();
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
      return `${name} is invite only. A group member or admin must send you an invitation before you can join.`;
    });
  }
}
