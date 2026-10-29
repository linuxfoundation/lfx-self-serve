// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, input, signal } from '@angular/core';
import { PublicProjectSummary } from '@lfx-one/shared/interfaces';

/**
 * Compact header block for the login-free ballot page (#4692): project logo (LFX mark when there is none), project
 * name, vote title, status chip and deadline. Branding is optional; with no project it shows the LFX mark and the title.
 */
@Component({
  selector: 'lfx-vote-link-header',
  imports: [DatePipe],
  templateUrl: './vote-link-header.component.html',
})
export class VoteLinkHeaderComponent {
  public readonly project = input<PublicProjectSummary | null>(null);
  public readonly title = input.required<string>();
  public readonly endTime = input<string | null>(null);
  /** Shown as the status chip; omitted when empty. */
  public readonly statusLabel = input<string>('');

  /** The logo URL that failed to load; it falls back to the LFX mark rather than a broken image. */
  private readonly failedLogoUrl = signal<string | null>(null);
  protected readonly logoUrl = computed(() => {
    const url = this.project()?.logo_url;
    return url && url !== this.failedLogoUrl() ? url : null;
  });

  protected onLogoError(): void {
    this.failedLogoUrl.set(this.project()?.logo_url ?? null);
  }
}
