// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Directive, inject, input } from '@angular/core';
import { UiCommandGroup, UiCommandItem, UiCommandMenuConfig } from '@lfx-one/shared/interfaces';
import { type Meta, moduleMetadata, type StoryObj } from '@storybook/angular';

import { UiCommandMenuComponent } from './command-menu.component';
import { UiCommandMenuService } from './command-menu.service';

/** Story helper: opens the palette through `UiCommandMenuService` when the host is clicked and shows what it resolved with. */
@Directive({ selector: '[lfxStoryOpensCommandMenu]', host: { '(click)': 'open()' } })
class StoryOpensCommandMenuDirective {
  public readonly lfxStoryOpensCommandMenu = input.required<UiCommandMenuConfig>();
  public chosen: UiCommandItem | undefined;

  private readonly service = inject(UiCommandMenuService);

  protected open(): void {
    this.service.open(this.lfxStoryOpensCommandMenu()).closed.subscribe((item) => (this.chosen = item));
  }
}

const groups: UiCommandGroup[] = [
  {
    label: 'Projects',
    items: [
      { value: 'kubernetes', label: 'Kubernetes', icon: 'fa-light fa-cube', keywords: ['k8s'] },
      { value: 'envoy', label: 'Envoy', icon: 'fa-light fa-cube' },
      { value: 'prometheus', label: 'Prometheus', icon: 'fa-light fa-cube', disabled: true },
    ],
  },
  {
    label: 'Actions',
    items: [
      { value: 'committee', label: 'Create Committee', icon: 'fa-light fa-users', shortcut: ['C'] },
      { value: 'meeting', label: 'Schedule Meeting', icon: 'fa-light fa-calendar', keywords: ['calendar', 'call'], shortcut: ['M'] },
      { value: 'theme', label: 'Change Theme…', icon: 'fa-light fa-palette' },
    ],
  },
];

const meta: Meta<UiCommandMenuComponent> = {
  title: 'Uikit/CommandMenu',
  component: UiCommandMenuComponent,
  decorators: [moduleMetadata({ imports: [StoryOpensCommandMenuDirective, UiCommandMenuComponent] })],
  parameters: { layout: 'padded' },
  args: { label: 'Command menu', placeholder: 'Search projects, people and actions…', groups },
  render: (args) => ({
    props: { config: { groups: args.groups, label: args.label, placeholder: args.placeholder } },
    template: `
      <!-- The trigger is a plain button styled like the library's secondary button; lfx-ui-button is not realigned yet. -->
      <button type="button" class="edge inline-flex h-ui-medium items-center gap-[8px] rounded-ui-sm bg-ui-background-100 px-[14px] label-14 font-medium text-ui-neutral-900 focus-visible:shadow-focus focus-visible:outline-none" [lfxStoryOpensCommandMenu]="config">
        <i class="fa-light fa-magnifying-glass" aria-hidden="true"></i> Open command menu
      </button>`,
  }),
};
export default meta;
type Story = StoryObj<UiCommandMenuComponent>;

/** Opens in a modal with the search field focused. Type to filter, Arrow Down and Arrow Up to move, Enter to choose, Escape to close. */
export const Default: Story = {};

/** "calendar" is a keyword of Schedule Meeting, not part of its label, and still finds it. */
export const MatchesKeywords: Story = {};

/** The palette rendered in place, without a modal, as the library draws it. In an app it always opens through the service. */
export const InlineLayout: Story = {
  render: (args) => ({
    props: args,
    template: `
      <div class="flex justify-center rounded-ui-md bg-ui-overlay p-[24px]">
        <lfx-ui-command-menu [groups]="groups" [label]="label" [placeholder]="placeholder" />
      </div>`,
  }),
};

/** With nothing to match, the list gives way to a message that names the search. */
export const EmptyState: Story = {
  render: (args) => ({
    props: args,
    template: `
      <div class="flex justify-center rounded-ui-md bg-ui-overlay p-[24px]">
        <lfx-ui-command-menu [groups]="[]" [label]="label" [placeholder]="placeholder" />
      </div>`,
  }),
};
