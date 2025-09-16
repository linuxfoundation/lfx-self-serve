// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { CardComponent } from '@shared/components/card/card.component';

@Component({
  selector: 'lfx-profile-password',
  standalone: true,
  imports: [CommonModule, CardComponent],
  templateUrl: './profile-password.component.html',
})
export class ProfilePasswordComponent {
  // TODO: Implement password change functionality
}
