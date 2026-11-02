// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { type Meta, moduleMetadata, type StoryObj } from '@storybook/angular';

import { UiButtonComponent } from '../button/button.component';
import { UiMenuGroupComponent } from './menu-group.component';
import { UiMenuItemComponent } from './menu-item.component';
import { UiMenuSeparatorComponent } from './menu-separator.component';
import { UiMenuComponent } from './menu.component';

// The triggers are `lfx-ui-button [menu]`.
const meta: Meta<UiMenuComponent> = {
  title: 'Uikit/Menu',
  component: UiMenuComponent,
  subcomponents: { UiMenuItemComponent, UiMenuGroupComponent, UiMenuSeparatorComponent },
  decorators: [moduleMetadata({ imports: [UiButtonComponent, UiMenuComponent, UiMenuItemComponent, UiMenuGroupComponent, UiMenuSeparatorComponent] })],
  parameters: { layout: 'padded' },
  args: { ariaLabel: 'Project actions' },
  // Aliased CDK menu item inputs and output; Compodoc cannot see host-directive aliases.
  argTypes: {
    disabled: {
      description: 'On `lfx-ui-menu-item`: greys the item out, sets `aria-disabled` and ignores clicks.',
      control: 'boolean',
      table: { category: 'lfx-ui-menu-item' },
    },
    typeaheadLabel: {
      description: 'On `lfx-ui-menu-item`: text that type-ahead matches instead of the projected label.',
      control: 'text',
      table: { category: 'lfx-ui-menu-item' },
    },
    triggered: {
      description: 'On `lfx-ui-menu-item`: emits when the item is chosen by click, Enter or Space.',
      action: 'triggered',
      table: { category: 'lfx-ui-menu-item' },
    },
  } as Meta['argTypes'],
  render: (args) => ({
    props: { cfg: args },
    template: `
      <lfx-ui-button variant="secondary" trailingIcon="fa-light fa-chevron-down" [menu]="menu">Actions</lfx-ui-button>
      <ng-template #menu>
        <lfx-ui-menu [ariaLabel]="cfg.ariaLabel">
          <lfx-ui-menu-item icon="fa-light fa-pen-to-square">Edit</lfx-ui-menu-item>
          <lfx-ui-menu-item icon="fa-light fa-link">Copy Link</lfx-ui-menu-item>
          <lfx-ui-menu-item icon="fa-light fa-copy">Duplicate</lfx-ui-menu-item>
          <lfx-ui-menu-separator />
          <lfx-ui-menu-item variant="danger" icon="fa-light fa-trash-can">Delete Project</lfx-ui-menu-item>
        </lfx-ui-menu>
      </ng-template>`,
  }),
};
export default meta;
type Story = StoryObj<UiMenuComponent>;

/** Opens below the trigger, start-aligned. Try Enter, the arrow keys, Home, End, a typed letter and Escape. */
export const Default: Story = {};

/** Every item variant: icon, shortcut, trailing icon, disabled and danger, with a labelled group and separators. */
export const ItemVariants: Story = {
  render: (args) => ({
    props: { cfg: args },
    template: `
      <lfx-ui-button variant="secondary" trailingIcon="fa-light fa-chevron-down" [menu]="menu">Actions</lfx-ui-button>
      <ng-template #menu>
        <lfx-ui-menu ariaLabel="Project actions" class="!w-[240px]">
          <lfx-ui-menu-item icon="fa-light fa-pen-to-square" shortcut="⌘E">Edit</lfx-ui-menu-item>
          <lfx-ui-menu-item icon="fa-light fa-link" shortcut="⌘L">Copy Link</lfx-ui-menu-item>
          <lfx-ui-menu-item>Rename</lfx-ui-menu-item>
          <lfx-ui-menu-separator />
          <lfx-ui-menu-group label="Share">
            <lfx-ui-menu-item icon="fa-light fa-user-plus">Invite Members</lfx-ui-menu-item>
            <lfx-ui-menu-item icon="fa-light fa-lock" [disabled]="true" disabledReason="Only owners can transfer">Transfer Ownership</lfx-ui-menu-item>
            <lfx-ui-menu-item trailingIcon="fa-light fa-arrow-up-right-from-square">Documentation</lfx-ui-menu-item>
          </lfx-ui-menu-group>
          <lfx-ui-menu-separator />
          <lfx-ui-menu-item variant="danger" icon="fa-light fa-trash-can">Delete Project</lfx-ui-menu-item>
        </lfx-ui-menu>
      </ng-template>`,
  }),
};

/** A square ⋯ trigger, as the library suggests for row actions. Give it an `aria-label`. */
export const IconTrigger: Story = {
  render: (args) => ({
    props: { cfg: args },
    template: `
      <lfx-ui-button variant="secondary" size="medium" iconOnly icon="fa-light fa-ellipsis" ariaLabel="More actions" [menu]="menu" />
      <ng-template #menu>
        <lfx-ui-menu ariaLabel="More actions">
          <lfx-ui-menu-item icon="fa-light fa-pen-to-square">Edit</lfx-ui-menu-item>
          <lfx-ui-menu-item icon="fa-light fa-copy">Duplicate</lfx-ui-menu-item>
          <lfx-ui-menu-separator />
          <lfx-ui-menu-item variant="danger" icon="fa-light fa-trash-can">Delete</lfx-ui-menu-item>
        </lfx-ui-menu>
      </ng-template>`,
  }),
};

/** Near the bottom edge the menu flips above its trigger. */
export const FlipsAtTheEdge: Story = {
  render: (args) => ({
    props: { cfg: args },
    template: `
      <div class="flex h-[360px] items-end">
        <lfx-ui-button variant="secondary" trailingIcon="fa-light fa-chevron-up" [menu]="menu">Actions</lfx-ui-button>
      </div>
      <ng-template #menu>
        <lfx-ui-menu ariaLabel="Project actions">
          <lfx-ui-menu-item icon="fa-light fa-pen-to-square">Edit</lfx-ui-menu-item>
          <lfx-ui-menu-item icon="fa-light fa-copy">Duplicate</lfx-ui-menu-item>
          <lfx-ui-menu-item icon="fa-light fa-link">Copy Link</lfx-ui-menu-item>
          <lfx-ui-menu-item icon="fa-light fa-user-plus">Invite Members</lfx-ui-menu-item>
        </lfx-ui-menu>
      </ng-template>`,
  }),
};
