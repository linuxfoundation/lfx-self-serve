// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { environment } from '@environments/environment';

@Component({
  selector: 'lfx-meeting-not-found',
  imports: [RouterLink, ButtonComponent, CardComponent],
  templateUrl: './meeting-not-found.component.html',
})
export class MeetingNotFoundComponent {
  public readonly supportUrl = environment.urls.support || 'mailto:support@linuxfoundation.org';
}
