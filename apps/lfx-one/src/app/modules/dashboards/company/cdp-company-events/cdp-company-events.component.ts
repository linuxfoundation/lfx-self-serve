// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, computed, Signal } from '@angular/core';
import type { CdpCompanyEventRow } from '@lfx-one/shared/interfaces';
import { CardComponent } from '@components/card/card.component';
import { TableComponent } from '@components/table/table.component';

import { CdpCompanySectionFrameComponent } from '../components/cdp-company-section-frame/cdp-company-section-frame.component';
import { CdpCompanySectionLoader } from '../cdp-company-section.loader';
import { formatCdpCompanyDate } from '../cdp-company.util';

/** CDP Events: events attended by at least 5 of the company's people, with the attendee count. */
@Component({
  selector: 'lfx-cdp-company-events',
  imports: [CdpCompanySectionFrameComponent, CardComponent, TableComponent, DecimalPipe],
  templateUrl: './cdp-company-events.component.html',
})
export class CdpCompanyEventsComponent {
  protected readonly section = new CdpCompanySectionLoader('events');

  /** Each row with its date-only `eventDate` formatted as a calendar date (never shifted by a timezone). */
  protected readonly rows: Signal<(CdpCompanyEventRow & { eventDateLabel: string | null })[]> = computed(() =>
    (this.section.data()?.rows ?? []).map((row) => ({ ...row, eventDateLabel: formatCdpCompanyDate(row.eventDate) }))
  );
}
