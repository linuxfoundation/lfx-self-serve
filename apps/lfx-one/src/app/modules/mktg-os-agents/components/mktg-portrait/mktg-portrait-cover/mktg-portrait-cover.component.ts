// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { MKTG_PORTRAIT_COVER_STRIP, MKTG_PORTRAIT_PAGE } from '@lfx-one/shared/constants';
import { mktgPortraitCoverStrip, mktgPortraitPlatePadding } from '@lfx-one/shared/utils';
import { MktgPortraitLogo, MktgPortraitLook, MktgPortraitBook } from '@lfx-one/shared/interfaces';
import { MktgPortraitPageComponent } from '../mktg-portrait-page/mktg-portrait-page.component';
import { MktgPortraitPlateDirective } from '../mktg-portrait-plate.directive';
import { MktgPortraitRectDirective } from '../mktg-portrait-rect.directive';
import { MKTG_PORTRAIT_BLOCK_HOST } from '../mktg-portrait-host';

/**
 * A portrait document's cover: a bare dark frame on the grid ground (kit
 * dark, a radial accent glow, a 32 px accent grid), the reversed lockup at
 * (72, 300) 84 px tall, the title (76/1) and its lede (17/1.5) at y 560,
 * and the bottom strip at y 984 (project · a Linux Foundation project |
 * url · version · month) over a 25 % white rule. Without a reversed logo
 * the lockup's slot stays empty: nothing is drawn in its place. The strip's
 * halves share one line: a long project name or host loses words with an
 * ellipsis first (`mktgPortraitCoverStrip`); only when one word each still
 * does not fit does the strip wrap, moved up a line so it ends where the
 * one line did.
 */
@Component({
  selector: 'lfx-mktg-portrait-cover',
  imports: [MktgPortraitPageComponent, MktgPortraitRectDirective, MktgPortraitPlateDirective],
  templateUrl: './mktg-portrait-cover.component.html',
  styles: [MKTG_PORTRAIT_BLOCK_HOST],
})
export class MktgPortraitCoverComponent {
  public readonly look = input.required<MktgPortraitLook>();
  public readonly book = input.required<MktgPortraitBook>();
  /** The book page number (1 standalone). */
  public readonly page = input(1);
  /** `Brand Kit`. */
  public readonly title = input.required<string>();
  /** The brand line and one sentence of purpose. */
  public readonly lede = input('');
  /** The reversed (white) lockup, or null. */
  public readonly logo = input<MktgPortraitLogo | null>(null);
  /** `Agentic AI Foundation (AAIF) · a Linux Foundation project`. */
  public readonly stripLeft = input('');
  /** `aaif.io · V4.0 · November 2026`. */
  public readonly stripRight = input('');
  protected readonly geometry = MKTG_PORTRAIT_PAGE;
  protected readonly ground = computed((): readonly [number, number, number, number] => [0, 0, this.geometry.width, this.geometry.height]);
  /** The lockup's drawn height, and the white plate's padding under a lockup the kit cannot reverse: half of it. */
  protected readonly lockupHeight = 84;
  protected readonly platePadding = mktgPortraitPlatePadding(this.lockupHeight);
  /** The plate's outer height: the lockup in its padding above and below. */
  protected readonly plateHeight = this.lockupHeight + 2 * this.platePadding;
  /** The lockup's block at y 300; a plated lockup's block starts a padding higher, so the artwork itself stays at y 300. */
  protected readonly lockup = computed((): readonly [number, number, number] => [
    this.geometry.coverInset,
    300 - (this.logo()?.plate ? this.platePadding : 0),
    600,
  ]);
  protected readonly text = computed((): readonly [number, number, number] => [
    this.geometry.coverInset,
    560,
    this.geometry.width - 2 * this.geometry.coverInset,
  ]);
  protected readonly stripWidth = this.geometry.width - 2 * this.geometry.coverInset;
  protected readonly stripText = computed(() => mktgPortraitCoverStrip(this.stripLeft(), this.stripRight(), this.stripWidth, this.look().fontStack));
  protected readonly strip = computed((): readonly [number, number, number] => [
    this.geometry.coverInset,
    MKTG_PORTRAIT_COVER_STRIP.top - (this.stripText().wraps ? MKTG_PORTRAIT_COVER_STRIP.size * MKTG_PORTRAIT_COVER_STRIP.lineHeight : 0),
    this.stripWidth,
  ]);
}
