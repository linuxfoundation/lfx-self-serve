// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { HeaderComponent } from '@components/header/header.component';

@Component({
  selector: 'lfx-invite-error',
  imports: [RouterLink, HeaderComponent, CardComponent, ButtonComponent],
  templateUrl: './invite-error.component.html',
})
export class InviteErrorComponent {
  private readonly route = inject(ActivatedRoute);

  protected readonly reason: string;
  protected readonly title: string;
  protected readonly description: string;

  public constructor() {
    this.reason = this.route.snapshot.queryParamMap.get('reason') ?? 'failed';
    this.title = this.initTitle();
    this.description = this.initDescription();
  }

  private initTitle(): string {
    switch (this.reason) {
      case 'expired':
        return 'Invite Link Expired';
      case 'missing':
        return 'Invalid Invite Link';
      default:
        return 'Could Not Accept Invite';
    }
  }

  private initDescription(): string {
    switch (this.reason) {
      case 'expired':
        return 'This invitation link has expired. Please ask the sender to generate a new invite.';
      case 'missing':
        return 'This invitation link is not valid. Please check the URL and try again.';
      default:
        return 'Something went wrong while accepting your invitation. Please try again or contact support.';
    }
  }
}
