// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { booleanAttribute, ChangeDetectionStrategy, Component, computed, inject, input, Signal } from '@angular/core';
import { Router } from '@angular/router';
import { MeetingHomeRowProject, MyCommittee } from '@lfx-one/shared/interfaces';
import { getMeetingHomeRowProject, isModifiedClick } from '@lfx-one/shared/utils';

import { MeetingProjectLogoComponent } from '../../../../meetings/meetings-redesign/components/meeting-project-logo/meeting-project-logo.component';

/** A group's foundation or project as a 12px link to its dashboard; the arrow slides in on hover and focus. */
@Component({
  selector: 'lfx-group-scope-link',
  imports: [MeetingProjectLogoComponent],
  templateUrl: './group-scope-link.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-w-0 max-w-full empty:hidden' },
})
export class GroupScopeLinkComponent {
  private readonly router = inject(Router);

  public readonly group = input.required<MyCommittee>();
  /** Shows the project logo before the name, as on the cards. */
  public readonly logo = input<boolean, unknown>(false, { transform: booleanAttribute });

  protected readonly project: Signal<MeetingHomeRowProject | null> = computed(() => getMeetingHomeRowProject(this.group()));

  protected onClick(event: MouseEvent, url: string): void {
    if (isModifiedClick(event)) return;
    event.preventDefault();
    void this.router.navigateByUrl(url);
  }
}
