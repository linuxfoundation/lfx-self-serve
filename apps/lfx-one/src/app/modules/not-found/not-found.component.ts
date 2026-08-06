// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Location } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { HeaderComponent } from '@components/header/header.component';

@Component({
  selector: 'lfx-not-found',
  imports: [HeaderComponent, CardComponent, ButtonComponent, RouterLink],
  templateUrl: './not-found.component.html',
})
export class NotFoundComponent {
  private readonly location = inject(Location);

  protected goBack(): void {
    this.location.back();
  }
}
