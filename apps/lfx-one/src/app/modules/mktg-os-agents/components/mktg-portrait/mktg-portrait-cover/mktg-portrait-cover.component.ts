// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { MKTG_PORTRAIT_PAGE } from '@lfx-one/shared/constants';
import { MktgPortraitLogo, MktgPortraitLook, MktgPortraitBook } from '@lfx-one/shared/interfaces';
import { MktgPortraitPageComponent } from '../mktg-portrait-page/mktg-portrait-page.component';
import { MktgPortraitRectDirective } from '../mktg-portrait-rect.directive';

/**
 * A portrait document's cover: a bare dark frame on the grid ground (kit
 * dark, a radial accent glow, a 32 px accent grid), the reversed lockup at
 * (72, 300) 84 px tall, the title (76/1) and its lede (17/1.5) at y 560,
 * and the bottom strip at y 984 (project · a Linux Foundation project |
 * url · version · month) over a 25 % white rule. Without a reversed logo
 * the lockup's slot stays empty: nothing is drawn in its place.
 */
@Component({
  selector: 'lfx-mktg-portrait-cover',
  imports: [MktgPortraitPageComponent, MktgPortraitRectDirective],
  templateUrl: './mktg-portrait-cover.component.html',
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
  protected readonly lockup = computed((): readonly [number, number, number] => [this.geometry.coverInset, 300, 600]);
  protected readonly text = computed((): readonly [number, number, number] => [
    this.geometry.coverInset,
    560,
    this.geometry.width - 2 * this.geometry.coverInset,
  ]);
  protected readonly strip = computed((): readonly [number, number, number] => [
    this.geometry.coverInset,
    984,
    this.geometry.width - 2 * this.geometry.coverInset,
  ]);
}
