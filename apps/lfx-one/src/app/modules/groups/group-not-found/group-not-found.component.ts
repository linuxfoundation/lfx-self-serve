// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';

@Component({
  selector: 'lfx-group-not-found',
  imports: [RouterLink, ButtonComponent, CardComponent, OpenIntercomDirective],
  templateUrl: './group-not-found.component.html',
})
export class GroupNotFoundComponent {}
