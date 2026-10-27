// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { VOTE_SLIDE_HEIGHT_PX, VOTE_SLIDE_WIDTH_PX } from '@lfx-one/shared/constants';

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

  protected readonly width = VOTE_SLIDE_WIDTH_PX;
  protected readonly height = VOTE_SLIDE_HEIGHT_PX;
}
