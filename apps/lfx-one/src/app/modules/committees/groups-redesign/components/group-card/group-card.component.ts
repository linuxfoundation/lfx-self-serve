// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, input, Signal, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BEHAVIORAL_CLASS_CONFIG, GROUPS_HOME_LINK_STATE } from '@lfx-one/shared/constants';
import { BehavioralClassDisplayConfig, MyCommittee } from '@lfx-one/shared/interfaces';
import { getGroupCommands } from '@lfx-one/shared/utils';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';

import { GroupChannelsComponent } from '../group-channels/group-channels.component';
import { GroupScopeLinkComponent } from '../group-scope-link/group-scope-link.component';
import { GroupVisibilityComponent } from '../group-visibility/group-visibility.component';

/**
 * One group on the Groups page card grid: type, name, project eyebrow, description, visibility, members, channels and voting.
 * @description The name link covers the card, so clicking the card opens the group. Content marked `group-card-menu`
 * is projected at the top right.
 */
@Component({
  selector: 'lfx-group-card',
  imports: [RouterLink, UiBadgeComponent, UiTooltipDirective, GroupChannelsComponent, GroupScopeLinkComponent, GroupVisibilityComponent],
  templateUrl: './group-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class GroupCardComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly name = viewChild.required<ElementRef<HTMLElement>>('name');

  public readonly group = input.required<MyCommittee>();

  protected readonly classDisplay: Signal<BehavioralClassDisplayConfig> = computed(
    () => this.group().classDisplay ?? BEHAVIORAL_CLASS_CONFIG[this.group().behavioralClass ?? 'other']
  );
  /** The group's own type, such as "Technical Advisory Committee"; the class label when it has none. */
  protected readonly typeLabel: Signal<string> = computed(() => this.group().category?.trim() || this.classDisplay().label);
  protected readonly commands: Signal<string[]> = computed(() => getGroupCommands(this.group()) ?? ['/groups', this.group().uid]);
  protected readonly queryParams: Signal<Record<string, string> | null> = computed(() => {
    const slug = this.group().project_slug;
    return slug ? { project: slug } : null;
  });
  protected readonly linkState = GROUPS_HOME_LINK_STATE;
  /** True while the name is cut off, so its tooltip shows the full name. */
  protected readonly nameTruncated = signal(false);

  public constructor() {
    afterNextRender(() => {
      const name = this.name().nativeElement;
      const observer = new ResizeObserver(() => this.nameTruncated.set(name.scrollWidth > name.clientWidth));
      observer.observe(name);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }
}
