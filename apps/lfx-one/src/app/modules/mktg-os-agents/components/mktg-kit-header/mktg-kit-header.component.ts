// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { MKTG_KIT_LABELS } from '@lfx-one/shared/constants';
import { PageHeaderComponent } from '@components/page-header/page-header.component';

@Component({
  selector: 'lfx-mktg-kit-header',
  imports: [PageHeaderComponent],
  templateUrl: './mktg-kit-header.component.html',
})
export class MktgKitHeaderComponent {
  public readonly projectName = input.required<string>();
  public readonly titleTestId = input('mktg-kit-title');
  public readonly withDescription = input(false);
  protected readonly labels = MKTG_KIT_LABELS;
}
