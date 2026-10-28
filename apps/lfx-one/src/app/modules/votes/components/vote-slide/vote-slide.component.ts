// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, viewChild } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { VOTE_SLIDE_HEIGHT_PX, VOTE_SLIDE_QR_READY_TIMEOUT_MS, VOTE_SLIDE_WIDTH_PX } from '@lfx-one/shared/constants';
import { VoteQrState } from '@lfx-one/shared/interfaces';
import { truncateVoteTitle } from '@lfx-one/shared/utils';

import { catchError, filter, firstValueFrom, of, timeout } from 'rxjs';

import { VoteQrComponent } from '../vote-qr/vote-qr.component';

/**
 * Static 16:9 "vote now" slide (#4145, design artboard 4): white ground, LFX mark, title, one-line instruction, large QR,
 * short link and eligibility line. No live data, so it never carries counts, choices or voter names. Rendered off-screen at
 * a fixed 1920×1080 and exported to PNG by exportVoteSlide.
 */
@Component({
  selector: 'lfx-vote-slide',
  imports: [VoteQrComponent],
  templateUrl: './vote-slide.component.html',
})
export class VoteSlideComponent {
  public readonly title = input.required<string>();
  public readonly link = input.required<string>();

  /** Same 80-char word-safe cap as the presenter, so a long title never overflows the fixed artboard. */
  protected readonly displayTitle = computed(() => truncateVoteTitle(this.title()));
  protected readonly width = VOTE_SLIDE_WIDTH_PX;
  protected readonly height = VOTE_SLIDE_HEIGHT_PX;

  private readonly qr = viewChild(VoteQrComponent);
  private readonly qrState = computed<VoteQrState>(() => this.qr()?.state() ?? 'pending');
  private readonly qrState$ = toObservable(this.qrState);

  /** Resolves true once the QR has rendered, false if it failed or did not render in time — an export must not capture a blank code. */
  public whenQrReady(): Promise<boolean> {
    return firstValueFrom(
      this.qrState$.pipe(
        filter((state) => state !== 'pending'),
        timeout({ first: VOTE_SLIDE_QR_READY_TIMEOUT_MS }),
        catchError(() => of<VoteQrState>('failed'))
      )
    ).then((state) => state === 'ready');
  }
}
