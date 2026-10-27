// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, effect, inject, input, PLATFORM_ID, signal } from '@angular/core';

/** Quiet-zone width in modules; the QR spec asks for 4, 2 still scans reliably on a projector and keeps the code large. */
const QR_QUIET_ZONE_MODULES = 2;

/**
 * Client-generated QR code rendered as inline SVG (#4142).
 * @description Encodes in the browser only — `uqr` is dynamic-imported so it never reaches the server bundle or the
 * initial chunk, and SSR renders an empty box. Modules are drawn as one `<path>` from the boolean matrix, so there is no
 * `innerHTML` and the SVG carries `role="img"` with the link as its label.
 */
@Component({
  selector: 'lfx-vote-qr',
  templateUrl: './vote-qr.component.html',
  host: { class: 'block' },
})
export class VoteQrComponent {
  private readonly platformId = inject(PLATFORM_ID);

  // === Inputs ===
  public readonly value = input.required<string>();
  public readonly label = input<string>('QR code');

  // === Signals ===
  private readonly matrix = signal<boolean[][] | null>(null);
  protected readonly size = computed(() => (this.matrix()?.length ?? 0) + QR_QUIET_ZONE_MODULES * 2);
  protected readonly path = computed(() => this.buildPath(this.matrix()));

  public constructor() {
    effect(() => {
      const value = this.value();
      if (!isPlatformBrowser(this.platformId)) return;
      void import('uqr').then(({ encode }) => {
        // Ignore a stale encode if the input changed while the chunk was loading.
        if (value === this.value()) this.matrix.set(encode(value, { ecc: 'M', border: 0 }).data);
      });
    });
  }

  private buildPath(matrix: boolean[][] | null): string {
    if (!matrix) return '';
    const segments: string[] = [];
    matrix.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) segments.push(`M${x + QR_QUIET_ZONE_MODULES} ${y + QR_QUIET_ZONE_MODULES}h1v1h-1z`);
      });
    });
    return segments.join('');
  }
}
