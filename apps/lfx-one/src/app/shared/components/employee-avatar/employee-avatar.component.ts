// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';

/** Small circular employee avatar for picker suggestion rows: renders the photo when present, falling back to initials (and on a broken image URL). */
@Component({
  selector: 'lfx-employee-avatar',
  imports: [],
  templateUrl: './employee-avatar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmployeeAvatarComponent {
  public readonly initials = input.required<string>();
  public readonly avatarUrl = input<string | null>(null);

  // Track the URL that failed rather than a permanent boolean: this component instance is reused across
  // rows in the picker/@for list, so a stale failure must not suppress a later, valid avatar URL.
  protected readonly failedAvatarUrl = signal<string | null>(null);

  protected onImageError(): void {
    this.failedAvatarUrl.set(this.avatarUrl());
  }
}
