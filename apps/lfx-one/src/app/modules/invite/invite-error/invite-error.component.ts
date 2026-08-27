// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { HeaderComponent } from '@components/header/header.component';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';

@Component({
  selector: 'lfx-invite-error',
  imports: [RouterLink, HeaderComponent, CardComponent, ButtonComponent, OpenIntercomDirective],
  templateUrl: './invite-error.component.html',
})
export class InviteErrorComponent {
  private readonly route = inject(ActivatedRoute);

  protected readonly reason: string;
  protected readonly title: string;
  protected readonly description: string;
  protected readonly isGenericError: boolean;

  public constructor() {
    this.reason = this.route.snapshot.queryParamMap.get('reason') ?? 'failed';
    // One switch owns all three fields so a future specific `case` can't drift apart from the
    // generic-error flag that gates the Contact support CTA.
    const content = this.initContent();
    this.title = content.title;
    this.description = content.description;
    this.isGenericError = content.isGenericError;
  }

  private initContent(): { title: string; description: string; isGenericError: boolean } {
    switch (this.reason) {
      case 'expired':
        return {
          title: 'Invite Link Expired',
          description: 'This invitation link has expired. Please ask the sender to generate a new invite.',
          isGenericError: false,
        };
      case 'missing':
        return {
          title: 'Invalid Invite Link',
          description: 'This invitation link is not valid. Please check the URL and try again.',
          isGenericError: false,
        };
      default:
        return {
          title: 'Could Not Accept Invite',
          description: 'Something went wrong while accepting your invitation. Please try again.',
          isGenericError: true,
        };
    }
  }
}
