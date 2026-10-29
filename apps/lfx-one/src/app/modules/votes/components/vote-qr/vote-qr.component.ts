// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, input, PLATFORM_ID, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { VOTE_QR_QUIET_ZONE_MODULES } from '@lfx-one/shared/constants';
import { VoteQrState } from '@lfx-one/shared/interfaces';
import { catchError, EMPTY, from, map, of, switchMap, tap } from 'rxjs';

/**
 * Client-generated QR code rendered as inline SVG (#4142).
 * @description Encodes in the browser only: `uqr` is dynamic-imported so it never reaches the server bundle or the
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
  /** switchMap drops a stale encode if the input changes while the chunk is still loading. */
  private readonly encodeFailed = signal(false);
  private readonly matrix = toSignal(
    toObservable(this.value).pipe(
      tap(() => this.encodeFailed.set(false)),
      switchMap((value) =>
        isPlatformBrowser(this.platformId)
          ? from(import('uqr')).pipe(
              map(({ encode }) => encode(value, { ecc: 'M', border: 0 }).data),
              catchError((error) => {
                console.error('Failed to generate the vote QR code', error);
                this.encodeFailed.set(true);
                return of(null);
              })
            )
          : EMPTY
      )
    ),
    { initialValue: null }
  );
  /** Lets an exporter wait for the code instead of capturing an empty box. */
  public readonly state = computed<VoteQrState>(() => {
    if (this.matrix()) return 'ready';
    return this.encodeFailed() ? 'failed' : 'pending';
  });
  protected readonly size = computed(() => (this.matrix()?.length ?? 0) + VOTE_QR_QUIET_ZONE_MODULES * 2);
  protected readonly path = computed(() => this.buildPath(this.matrix()));

  private buildPath(matrix: boolean[][] | null): string {
    if (!matrix) return '';
    const segments: string[] = [];
    matrix.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) segments.push(`M${x + VOTE_QR_QUIET_ZONE_MODULES} ${y + VOTE_QR_QUIET_ZONE_MODULES}h1v1h-1z`);
      });
    });
    return segments.join('');
  }
}
