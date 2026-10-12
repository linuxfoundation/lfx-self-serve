// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, input, output, Signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { ButtonComponent } from '@components/button/button.component';
import { MyNewsletterFoundation, MyNewsletterInviter } from '@lfx-one/shared/interfaces';
import { TooltipModule } from 'primeng/tooltip';

/**
 * One foundation on the Me-lens My Newsletters grid — the dashboard meeting card's layout (header
 * strip, identity tile, chips, two footer actions) with the foundation logo in the date tile's place.
 */
@Component({
  selector: 'lfx-newsletter-foundation-card',
  imports: [AvatarComponent, ButtonComponent, DatePipe, RouterLink, TooltipModule],
  templateUrl: './newsletter-foundation-card.component.html',
})
export class NewsletterFoundationCardComponent {
  // === Inputs ===
  public readonly foundation = input.required<MyNewsletterFoundation>();
  public readonly inviter = input.required<MyNewsletterInviter>();

  // === Outputs ===
  public readonly invite = output<MyNewsletterFoundation>();

  // === Computed Signals ===
  protected readonly detailLink: Signal<string[]> = computed(() => ['/newsletters/my', this.foundation().slug]);
  protected readonly initial: Signal<string> = computed(() => this.foundation().name.charAt(0).toUpperCase());
  protected readonly receivedLabel: Signal<string> = computed(() => {
    const count = this.foundation().received_count;
    return `${count} ${count === 1 ? 'newsletter' : 'newsletters'} received`;
  });
  /** Why Invite is disabled — empty when it is enabled. */
  protected readonly inviteDisabledReason: Signal<string> = this.initInviteDisabledReason();

  // === Protected Methods ===
  protected onInvite(): void {
    if (this.foundation().can_invite) {
      this.invite.emit(this.foundation());
    }
  }

  // === Private Initializers ===
  private initInviteDisabledReason(): Signal<string> {
    return computed(() => {
      if (this.foundation().can_invite) return '';
      const inviter = this.inviter();
      if (inviter.denied_reason === 'unavailable') return "Invites aren't available right now. Please try again later.";
      if (!inviter.eligible) return 'Invites are available to employees of Linux Foundation member companies, using a verified company email.';
      return "Invites are available once you're on this foundation's newsletter list.";
    });
  }
}
