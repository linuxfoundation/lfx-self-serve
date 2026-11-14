// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MeetingDetailsDrawerData } from '@lfx-one/shared/interfaces';
import { UiDrawerComponent } from '@shared/uikit/drawer/drawer.component';
import { bindLfxDocumentTitle } from '@shared/utils/document-title.util';

import { MeetingsHomeDeleteService } from '../../services/meetings-home-delete.service';
import { MeetingsHomeEditService } from '../../services/meetings-home-edit.service';
import { MeetingDetailsBodyComponent } from './body/meeting-details-body.component';
import { MeetingDetailsContext } from './meeting-details.context';
import { provideMeetingDetailsDrawerSource } from './meeting-details.source';
import { MeetingDetailsArtifactsService } from './tools/meeting-details-artifacts.service';

/**
 * The meeting details drawer, opened by `MeetingsHomeDetailsService`: the drawer chrome around `MeetingDetailsBodyComponent`.
 * @description The page's store and edit flow are not reachable from the drawer's own injector, so they are forwarded from the page.
 */
@Component({
  selector: 'lfx-meeting-details-drawer',
  imports: [MeetingDetailsBodyComponent, UiDrawerComponent],
  templateUrl: './meeting-details-drawer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    MeetingDetailsContext,
    MeetingDetailsArtifactsService,
    provideMeetingDetailsDrawerSource(),
    { provide: MeetingsHomeEditService, useFactory: () => inject<MeetingDetailsDrawerData>(DIALOG_DATA).injector.get(MeetingsHomeEditService) },
    { provide: MeetingsHomeDeleteService, useFactory: () => inject<MeetingDetailsDrawerData>(DIALOG_DATA).injector.get(MeetingsHomeDeleteService) },
  ],
})
export class MeetingDetailsDrawerComponent {
  protected readonly context = inject(MeetingDetailsContext);

  public constructor() {
    // The tab shows the meeting; MeetingsHomeDetailsService restores the page's title once no drawer is open.
    bindLfxDocumentTitle(computed(() => this.context.shownRow().title));
  }
}
