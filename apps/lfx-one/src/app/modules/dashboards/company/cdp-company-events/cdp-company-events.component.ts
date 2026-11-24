// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, Signal } from '@angular/core';
import type { CdpCompanyEventRow } from '@lfx-one/shared/interfaces';
import { CardComponent } from '@components/card/card.component';
import { TableComponent } from '@components/table/table.component';

import { CdpCompanySectionFrameComponent } from '../components/cdp-company-section-frame/cdp-company-section-frame.component';
import { CdpCompanySectionLoader } from '../cdp-company-section.loader';

/** CDP Events (spec 062 FR-028, FR-030): events attended by at least 5 of the company's people, with the attendee count. */
@Component({
  selector: 'lfx-cdp-company-events',
  imports: [CdpCompanySectionFrameComponent, CardComponent, TableComponent, DatePipe, DecimalPipe],
  templateUrl: './cdp-company-events.component.html',
})
export class CdpCompanyEventsComponent {
  protected readonly section = new CdpCompanySectionLoader('events');

  protected readonly rows: Signal<CdpCompanyEventRow[]> = computed(() => this.section.data()?.rows ?? []);
}
