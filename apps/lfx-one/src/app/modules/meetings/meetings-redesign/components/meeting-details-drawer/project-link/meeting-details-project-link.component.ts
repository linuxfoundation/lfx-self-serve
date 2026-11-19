// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { MeetingHomeRowProject } from '@lfx-one/shared/interfaces';
import { UiDrawerContext } from '@shared/uikit/drawer/drawer.context';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';

import { MeetingProjectLogoComponent } from '../../meeting-project-logo/meeting-project-logo.component';

/** Project eyebrow of the meeting details drawer: logo and name, linking to the project overview when it has one. */
@Component({
  selector: 'lfx-meeting-details-project-link',
  imports: [MeetingProjectLogoComponent, UiTooltipDirective],
  templateUrl: './meeting-details-project-link.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-w-0' },
})
export class MeetingDetailsProjectLinkComponent {
  private readonly router = inject(Router);
  private readonly drawer = inject(UiDrawerContext, { optional: true });

  public readonly project = input.required<MeetingHomeRowProject>();
  /** `small` is the 12px compact header line, `default` the 14px line above the title. */
  public readonly size = input<'small' | 'default'>('default');

  /** A plain click closes the drawer, if any, and navigates in-app; modified clicks keep the browser's behaviour. */
  protected onClick(event: MouseEvent, url: string): void {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    this.drawer?.requestClose();
    void this.router.navigateByUrl(url);
  }
}
