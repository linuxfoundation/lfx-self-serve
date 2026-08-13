// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { MeetingComposerService } from './meeting-composer.service';

/**
 * Keeps `/meetings/create` and `/meetings/:id/edit` deep-linkable (LFXV2-3234).
 * @description Renders nothing: it opens the composer, then replaces the URL with the meetings
 * dashboard so the composer sits over a real page. Composer state lives in a root service, so it
 * survives this component being destroyed by the redirect.
 */
@Component({
  selector: 'lfx-meeting-composer-route',
  template: '',
})
export class MeetingComposerRouteComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly composer = inject(MeetingComposerService);

  public constructor() {
    const meetingUid = this.route.snapshot.paramMap.get('id');
    const committeeUid = this.route.snapshot.queryParamMap.get('committee_uid');

    this.composer.open({
      mode: meetingUid ? 'edit' : 'create',
      meetingUid: meetingUid ?? undefined,
      committeeUid: committeeUid ?? undefined,
    });

    void this.router.navigate(['/meetings'], { replaceUrl: true });
  }
}
