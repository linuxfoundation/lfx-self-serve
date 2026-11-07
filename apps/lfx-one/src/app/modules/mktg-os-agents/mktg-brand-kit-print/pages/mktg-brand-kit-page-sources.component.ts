// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { MktgRevisionApproval } from '@lfx-one/shared/interfaces';
import { brandKitPortraitApprovalLine, brandKitPortraitSources, brandKitPortraitSourcesFit } from '@lfx-one/shared/utils';
import { MktgPortraitPageComponent } from '../../components/mktg-portrait/mktg-portrait-page/mktg-portrait-page.component';
import { MktgPortraitRectDirective } from '../../components/mktg-portrait/mktg-portrait-rect.directive';
import { MktgBrandKitPageBase } from './mktg-brand-kit-page.base';
import { MKTG_PORTRAIT_BLOCK_HOST } from '../../components/mktg-portrait/mktg-portrait-host';

/**
 * The Sources & decisions page (mock 16), from the revision's own run record
 * only: what was read, what could not be read and why, the warnings and
 * gaps, what is missing with its fix, the colour conflicts with the value
 * kept, and the box saying what was accepted at approval (only with a
 * recorded approval). A line the record does not hold is not printed. The
 * two columns are measured with the fit model and set smaller together when
 * the record would overrun their room (`brandKitPortraitSourcesFit`).
 */
@Component({
  selector: 'lfx-mktg-brand-kit-page-sources',
  imports: [MktgPortraitPageComponent, MktgPortraitRectDirective],
  templateUrl: './mktg-brand-kit-page-sources.component.html',
  styles: [MKTG_PORTRAIT_BLOCK_HOST],
})
export class MktgBrandKitPageSourcesComponent extends MktgBrandKitPageBase {
  /** The revision's recorded approval, or null before one. */
  public readonly approval = input<MktgRevisionApproval | null>(null);
  protected readonly approvalLine = computed(() => brandKitPortraitApprovalLine(this.approval()));
  /** The lists fitted to the two columns' room (above the accepted box when it prints): the scale the columns are set at, and the lists as printed. */
  protected readonly fit = computed(() => brandKitPortraitSourcesFit(brandKitPortraitSources(this.view()), this.approvalLine() !== ''));
  protected readonly sources = computed(() => this.fit().sources);
  protected readonly intro = computed(() => {
    const version = this.view().versionLabel;
    const approved = this.approvalLine() !== '';
    const tail = approved && version ? `, and what was accepted when ${version} was approved` : '';
    return `What this kit was built from, what could not be read, what is still missing${tail}. Nothing on the other pages comes from anywhere else.`;
  });
}
