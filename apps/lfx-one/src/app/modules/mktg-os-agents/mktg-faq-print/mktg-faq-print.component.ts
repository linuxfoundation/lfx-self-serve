// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { FAQ_VIEW_TABS } from '@lfx-one/shared/constants';
import { FaqPrintView } from '@lfx-one/shared/interfaces';
import { MktgPrintRunningHeadComponent } from '../components/mktg-print-running-head/mktg-print-running-head.component';

@Component({
  selector: 'lfx-mktg-faq-print',
  imports: [MktgPrintRunningHeadComponent],
  templateUrl: './mktg-faq-print.component.html',
  styleUrl: '../mktg-framework-print/mktg-framework-print.component.scss',
})
export class MktgFaqPrintComponent {
  public readonly view = input.required<FaqPrintView>();
  public readonly number = input.required<string>();
  public readonly projectName = input.required<string>();
  protected readonly unansweredLabel = FAQ_VIEW_TABS.find((tab) => tab.id === 'unanswered')?.label;
}
