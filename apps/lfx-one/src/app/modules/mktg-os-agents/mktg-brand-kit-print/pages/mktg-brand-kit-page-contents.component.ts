// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { MktgPortraitPlacedPage, MktgRevisionApproval } from '@lfx-one/shared/interfaces';
import { brandKitPortraitApprovalLine, brandKitPortraitBuiltFrom, brandKitPortraitContentsLayout } from '@lfx-one/shared/utils';
import { MktgPortraitPageComponent } from '../../components/mktg-portrait/mktg-portrait-page/mktg-portrait-page.component';
import { MktgPortraitRectDirective } from '../../components/mktg-portrait/mktg-portrait-rect.directive';
import { MktgBrandKitArtworkComponent } from './mktg-brand-kit-artwork.component';
import { MktgBrandKitPageBase } from './mktg-brand-kit-page.base';
import { MKTG_PORTRAIT_BLOCK_HOST } from '../../components/mktg-portrait/mktg-portrait-host';

/**
 * The contents page (mock 02, "What's inside"): the list of every page after it with its number (from the plan, never hand-numbered) in 34 px rows, then two blocks at y 690 (lower when the list needs the room; the list in two columns past that: `brandKitPortraitContentsLayout`): what the kit is built from (no file names) with the Sources page's number, and the At-a-glance card (the lockup, the palette dots, the type family and weights, and the approval line when the store holds one; the version prints on the cover and the back cover only, the ruling's two places).
 */
@Component({
  selector: 'lfx-mktg-brand-kit-page-contents',
  imports: [MktgPortraitPageComponent, MktgPortraitRectDirective, MktgBrandKitArtworkComponent],
  templateUrl: './mktg-brand-kit-page-contents.component.html',
  styles: [MKTG_PORTRAIT_BLOCK_HOST],
})
export class MktgBrandKitPageContentsComponent extends MktgBrandKitPageBase {
  /** Every placed page of the book, for the list and the Sources page's number. */
  public readonly pages = input.required<readonly MktgPortraitPlacedPage[]>();
  /** The approved revision's approval, when the document has it; null leaves the line out. */
  public readonly approval = input<MktgRevisionApproval | null>(null);
  /** The content pages after this one, as the list prints them: the back cover is not a content page (the editor's ruling) and is not listed. */
  protected readonly entries = computed(() => {
    const pages = this.pages();
    const index = pages.findIndex((page) => page.id === this.page().id);
    return pages.slice(index + 1).filter((entry) => entry.id !== 'back-cover');
  });
  /** One or two columns and the lower blocks' top, from the number of rows. */
  protected readonly layout = computed(() => brandKitPortraitContentsLayout(this.entries().length));
  protected readonly sourcesPage = computed(() => this.pages().find((page) => page.id === 'sources')?.number ?? null);
  protected readonly builtFrom = computed(() => brandKitPortraitBuiltFrom(this.view()));
  protected readonly approvalLine = computed(() => brandKitPortraitApprovalLine(this.approval()));
  protected readonly weights = computed(() => this.view().type.weights.join(', '));
}
