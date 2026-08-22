// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { MeetingComposerService } from './meeting-composer.service';

/**
 * Keeps `/meetings/create` and `/meetings/:id/edit` deep-linkable (GH-1452).
 * @description Renders nothing: it opens the composer, then replaces the URL with the meetings
 * list so the composer sits over a real page. Composer state lives in a root service, so it
 * survives this component being destroyed by the redirect.
 */
@Component({
  selector: 'lfx-meeting-composer-route',
  templateUrl: './meeting-composer-route.component.html',
})
export class MeetingComposerRouteComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly composer = inject(MeetingComposerService);

  public constructor() {
    const snapshot = this.route.snapshot;
    const meetingUid = snapshot.paramMap.get('id');

    // Create lands on the quick dialog — the same surface the dashboard's "Create meeting" dropdown
    // opens — with no `meetingType`, so nothing is pre-selected and no template prefill runs. Edit
    // still opens the full drawer, which is the only surface that renders every section.
    this.composer.open({
      mode: meetingUid ? 'edit' : 'create',
      meetingUid: meetingUid ?? undefined,
      committeeUid: snapshot.queryParamMap.get('committee_uid') ?? undefined,
      variant: meetingUid ? 'drawer' : 'quick',
    });

    // Redirect within the same lens prefix and keep the query params. A bare `/meetings` would drop
    // both the lens segment and `?project=`, leaving the project context to resolve from the persisted
    // cookie — the composer would then save against a different project than the one writerGuard
    // authorised. `create` contributes one URL segment, `:id/edit` two.
    const segments = this.route.pathFromRoot.flatMap((route) => route.snapshot.url.map((segment) => segment.path));
    const listSegments = segments.slice(0, meetingUid ? -2 : -1);

    void this.router.navigate(['/', ...listSegments], { queryParams: snapshot.queryParams, replaceUrl: true });
  }
}
