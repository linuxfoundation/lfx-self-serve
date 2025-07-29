// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { InplaceModule } from 'primeng/inplace';

@Component({
  selector: 'lfx-inplace',
  standalone: true,
  imports: [CommonModule, InplaceModule],
  templateUrl: './inplace.component.html',
})
export class InplaceComponent {
  // Basic properties we need for form toggle
  public readonly active = input<boolean>(false);
  public readonly disabled = input<boolean>(false);
  public readonly styleClass = input<string>('');

  // Events
  public readonly activeChanged = output<boolean>();
  public readonly onActivate = output<Event>();
  public readonly onDeactivate = output<Event>();

  protected handleActivate(event: Event): void {
    this.onActivate.emit(event);
  }

  protected handleDeactivate(event: Event): void {
    this.onDeactivate.emit(event);
  }
}
