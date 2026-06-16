// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { CardComponent } from '@components/card/card.component';
import { ButtonComponent } from '@components/button/button.component';

@Component({
  selector: 'lfx-initiative-announcements',
  imports: [CardComponent, ButtonComponent],
  templateUrl: './initiative-announcements.component.html',
  styleUrl: './initiative-announcements.component.scss',
})
export class InitiativeAnnouncementsComponent {}
