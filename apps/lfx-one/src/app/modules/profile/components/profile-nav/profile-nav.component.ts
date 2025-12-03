// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@app/shared/components/button/button.component';

@Component({
  selector: 'lfx-profile-nav',
  standalone: true,
  imports: [RouterLink, ButtonComponent],
  templateUrl: './profile-nav.component.html',
})
export class ProfileNavComponent {}
