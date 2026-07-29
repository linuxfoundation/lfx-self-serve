// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { environment } from '@environments/environment';
import { Committee } from '@lfx-one/shared/interfaces';
import { DialogService } from 'primeng/dynamicdialog';

import { IcalSubscribeDialogComponent } from '../components/ical-subscribe-dialog/ical-subscribe-dialog.component';

/** Opens the shared iCal Subscribe dialog (copy URL + Google/Outlook/Apple links) for a committee's calendar feed. */
export function openIcalSubscribeDialog(dialogService: DialogService, committee: Committee): void {
  const feedUrl = `${environment.urls.home}/public/api/committees/${encodeURIComponent(committee.uid)}/calendar.ics`;
  const committeeName = committee.name ?? 'Committee';
  dialogService.open(IcalSubscribeDialogComponent, {
    header: `Subscribe — ${committeeName}`,
    width: '480px',
    modal: true,
    closable: true,
    dismissableMask: true,
    data: { feedUrl, name: committeeName },
  });
}
