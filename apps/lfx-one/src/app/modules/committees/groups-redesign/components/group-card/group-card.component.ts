// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, input, Signal, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { BEHAVIORAL_CLASS_CONFIG } from '@lfx-one/shared/constants';
import { BehavioralClassDisplayConfig, GroupChannel, MeetingHomeRowProject, MyCommittee } from '@lfx-one/shared/interfaces';
import { getGroupChannels, getGroupCommands, getMeetingHomeRowProject } from '@lfx-one/shared/utils';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';

import { MeetingProjectLogoComponent } from '../../../../meetings/meetings-redesign/components/meeting-project-logo/meeting-project-logo.component';

/**
 * One group on the Groups page card grid: type, name, project eyebrow, description, visibility, members, channels and voting.
 * @description The name link covers the card, so clicking the card opens the group. Content marked `group-card-menu`
 * is projected at the top right.
 */
@Component({
  selector: 'lfx-group-card',
  imports: [RouterLink, UiBadgeComponent, UiButtonComponent, UiTooltipDirective, MeetingProjectLogoComponent],
  templateUrl: './group-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class GroupCardComponent {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly name = viewChild.required<ElementRef<HTMLElement>>('name');

  public readonly group = input.required<MyCommittee>();

  protected readonly classDisplay: Signal<BehavioralClassDisplayConfig> = computed(
    () => this.group().classDisplay ?? BEHAVIORAL_CLASS_CONFIG[this.group().behavioralClass ?? 'other']
  );
  /** The group's own type, such as "Technical Advisory Committee"; the class label when it has none. */
  protected readonly typeLabel: Signal<string> = computed(() => this.group().category?.trim() || this.classDisplay().label);
  protected readonly project: Signal<MeetingHomeRowProject | null> = computed(() => getMeetingHomeRowProject(this.group()));
  protected readonly channels: Signal<GroupChannel[]> = computed(() => getGroupChannels(this.group()));
  protected readonly commands: Signal<string[]> = computed(() => getGroupCommands(this.group()) ?? ['/groups', this.group().uid]);
  protected readonly queryParams: Signal<Record<string, string> | null> = computed(() => {
    const slug = this.group().project_slug;
    return slug ? { project: slug } : null;
  });
  protected readonly linkState = { backLabel: 'Groups', fromMeLens: true };
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

  protected onProjectClick(event: MouseEvent, url: string): void {
    if (this.isModifiedClick(event)) return;
    event.preventDefault();
    void this.router.navigateByUrl(url);
  }

  /** An in-app mailing list opens in the app on a plain click, with the Groups back label for a group page. */
  protected onChannelClick(event: MouseEvent, channel: GroupChannel): void {
    const link = channel.link;
    if (!link || this.isModifiedClick(event)) return;
    event.preventDefault();
    void this.router.navigate(link.commands, { queryParams: link.queryParams, state: link.target === 'group' ? this.linkState : undefined });
  }

  private isModifiedClick(event: MouseEvent): boolean {
    return event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey;
  }
}
