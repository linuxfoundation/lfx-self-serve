// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, input, signal } from '@angular/core';
import { PublicProjectSummary } from '@lfx-one/shared/interfaces';

import { VoteLinkMarkComponent } from '../vote-link-mark/vote-link-mark.component';

/**
 * Compact header block for the login-free ballot page (#4692): LFX mark (always, top-left), project logo when there
 * is one, project name, vote title, status chip and deadline. Branding is optional; with no project logo the LFX mark is the only mark.
 */
@Component({
  selector: 'lfx-vote-link-header',
  imports: [DatePipe, VoteLinkMarkComponent],
  templateUrl: './vote-link-header.component.html',
})
export class VoteLinkHeaderComponent {
  public readonly project = input<PublicProjectSummary | null>(null);
  public readonly title = input.required<string>();
  public readonly endTime = input<string | null>(null);
  /** Shown as the status chip; omitted when empty. */
  public readonly statusLabel = input<string>('');

  /** The logo URL that failed to load; it is dropped rather than shown as a broken image. */
  private readonly failedLogoUrl = signal<string | null>(null);
  protected readonly logoUrl = computed(() => {
    const url = this.project()?.logo_url;
    return url && url !== this.failedLogoUrl() ? url : null;
  });

  protected onLogoError(): void {
    this.failedLogoUrl.set(this.project()?.logo_url ?? null);
  }
}
