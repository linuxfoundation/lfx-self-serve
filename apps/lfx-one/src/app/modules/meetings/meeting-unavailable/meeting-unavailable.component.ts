// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';

@Component({
  selector: 'lfx-meeting-unavailable',
  imports: [RouterLink, ButtonComponent, CardComponent, OpenIntercomDirective],
  templateUrl: './meeting-unavailable.component.html',
})
export class MeetingUnavailableComponent {}
