// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { CardComponent } from '@shared/components/card/card.component';

@Component({
  selector: 'lfx-profile-email',
  standalone: true,
  imports: [CommonModule, CardComponent],
  templateUrl: './profile-email.component.html',
})
export class ProfileEmailComponent {
  // TODO: Implement email change functionality
}
