// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { MKTG_PRINT_FAMILY_COVER_BOXES, MKTG_PRINT_FAMILY_COVER_TITLE_SIZE, MKTG_PRINT_LANDSCAPE_CLASS } from '@lfx-one/shared/constants';
import { MktgFamilyPrintView } from '@lfx-one/shared/interfaces';
import { mktgPrintFamilyCover, mktgPrintPageLook } from '@lfx-one/shared/utils';
import { MktgPrintCoverComponent } from '../mktg-print-cover/mktg-print-cover.component';

/**
 * The family PDF's cover: the deck's cover with the family's strings (the
 * project's eyebrow line, the newest revision's month, the family's name,
 * the brand line and the versions of the parts present), built once in the
 * shared builder and bound to the generic landscape cover in the family's
 * own title and subtitle boxes, the project's reversed lockup on its dark
 * ground.
 */
@Component({
  selector: 'lfx-mktg-print-family-cover',
  imports: [MktgPrintCoverComponent],
  templateUrl: './mktg-print-family-cover.component.html',
  host: { class: `block ${MKTG_PRINT_LANDSCAPE_CLASS}` },
})
export class MktgPrintFamilyCoverComponent {
  public readonly view = input.required<MktgFamilyPrintView>();
  public readonly familyName = input.required<string>();
  protected readonly titleSize = MKTG_PRINT_FAMILY_COVER_TITLE_SIZE;
  protected readonly boxes = MKTG_PRINT_FAMILY_COVER_BOXES;
  protected readonly look = computed(() => mktgPrintPageLook(this.view().brand));
  protected readonly cover = computed(() => mktgPrintFamilyCover(this.view(), this.familyName()));
}
