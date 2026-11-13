// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { environment } from '@environments/environment';
import { Committee } from '@lfx-one/shared/interfaces';
import { DialogService } from 'primeng/dynamicdialog';

import { IcalSubscribeDialogComponent } from '../components/ical-subscribe-dialog/ical-subscribe-dialog.component';

/** Opens the shared iCal Subscribe dialog (copy URL + Google/Outlook/Apple links) for a committee's calendar feed. */
export function openIcalSubscribeDialog(dialogService: DialogService, committee: Committee): void {
  const feedUrl = `${environment.urls.home}/public/api/committees/${encodeURIComponent(committee.uid)}/calendar.ics`;
  openSubscribeDialog(dialogService, feedUrl, committee.name ?? 'Committee');
}

/** Opens the shared iCal Subscribe dialog for a project's calendar feed. */
export function openProjectIcalSubscribeDialog(dialogService: DialogService, projectUid: string, name: string): void {
  const feedUrl = `${environment.urls.home}/public/api/projects/${encodeURIComponent(projectUid)}/calendar.ics`;
  openSubscribeDialog(dialogService, feedUrl, name);
}

function openSubscribeDialog(dialogService: DialogService, feedUrl: string, name: string): void {
  dialogService.open(IcalSubscribeDialogComponent, {
    header: `Subscribe — ${name}`,
    width: '480px',
    modal: true,
    closable: true,
    dismissableMask: true,
    data: { feedUrl, name },
  });
}
