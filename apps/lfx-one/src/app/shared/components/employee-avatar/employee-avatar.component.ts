// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, signal } from '@angular/core';

/** Small circular employee avatar for picker suggestion rows: renders the photo when present, falling back to initials (and on a broken image URL). */
@Component({
  selector: 'lfx-employee-avatar',
  imports: [],
  templateUrl: './employee-avatar.component.html',
})
export class EmployeeAvatarComponent {
  public readonly initials = input.required<string>();
  public readonly avatarUrl = input<string | null>(null);

  protected readonly imageError = signal<boolean>(false);

  protected onImageError(): void {
    this.imageError.set(true);
  }
}
