// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { type Meta, moduleMetadata, type StoryObj } from '@storybook/angular';

import { UiButtonComponent } from '../button/button.component';
import { UiMenuItemComponent } from '../menu/menu-item.component';
import { UiMenuSeparatorComponent } from '../menu/menu-separator.component';
import { UiMenuComponent } from '../menu/menu.component';
import { UiContextMenuDirective } from './context-menu.directive';

// The hosts below are plain elements styled like a library card; they only need to be focusable for keyboard users.
const meta: Meta<UiContextMenuDirective> = {
  title: 'Uikit/ContextMenu',
  component: UiContextMenuDirective,
  decorators: [moduleMetadata({ imports: [UiButtonComponent, UiContextMenuDirective, UiMenuComponent, UiMenuItemComponent, UiMenuSeparatorComponent] })],
  parameters: { layout: 'padded' },
  // Aliased CDK context menu trigger inputs and outputs; Compodoc cannot see host-directive aliases.
  argTypes: {
    lfxUiContextMenu: { description: 'The menu: a template reference to an `<ng-template>` that holds a `lfx-ui-menu`.', control: false },
    lfxUiContextMenuDisabled: { description: 'Turns the context menu off and leaves the browser menu alone.', control: 'boolean' },
    lfxUiContextMenuOpened: { description: 'Emits when the menu opens.', action: 'lfxUiContextMenuOpened' },
    lfxUiContextMenuClosed: { description: 'Emits when the menu closes.', action: 'lfxUiContextMenuClosed' },
  } as Meta['argTypes'],
  render: (args) => ({
    props: { cfg: args },
    template: `
      <!-- Exact px, not rem; 14px root. -->
      <div class="edge flex h-[96px] w-[320px] items-center rounded-ui-md bg-ui-background-100 px-[16px] label-14 text-ui-neutral-900 focus-visible:shadow-focus focus-visible:outline-none"
        tabindex="0" [lfxUiContextMenu]="menu" [lfxUiContextMenuDisabled]="!!cfg.lfxUiContextMenuDisabled">
        Kubernetes
        <span class="ml-auto label-13 text-ui-neutral-600">Right-click, long-press, or focus and press Shift+F10</span>
      </div>
      <ng-template #menu>
        <lfx-ui-menu ariaLabel="Project actions">
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
type Story = StoryObj<UiContextMenuDirective>;

/** Opens at the pointer on right-click or a touch long press, or below the focused card with Shift+F10 or the context menu key. Try the arrow keys and Escape. */
export const Default: Story = {};

/** The same menu behind a ⋯ button. The right-click is a shortcut to what the button already offers, never the only way. */
export const MirrorsTheMoreMenu: Story = {
  render: () => ({
    template: `
      <div class="edge flex h-ui-row w-[320px] items-center gap-[8px] rounded-ui-md bg-ui-background-100 pl-[16px] pr-[4px] label-14 text-ui-neutral-900 focus-visible:shadow-focus focus-visible:outline-none"
        tabindex="0" [lfxUiContextMenu]="menu">
        Kubernetes
        <lfx-ui-button class="ml-auto" variant="tertiary" size="small" iconOnly icon="fa-light fa-ellipsis" ariaLabel="More actions" [menu]="menu" />
      </div>
      <ng-template #menu>
        <lfx-ui-menu ariaLabel="Project actions">
          <lfx-ui-menu-item icon="fa-light fa-pen-to-square">Edit</lfx-ui-menu-item>
          <lfx-ui-menu-item icon="fa-light fa-copy">Duplicate</lfx-ui-menu-item>
          <lfx-ui-menu-separator />
          <lfx-ui-menu-item variant="danger" icon="fa-light fa-trash-can">Delete</lfx-ui-menu-item>
        </lfx-ui-menu>
      </ng-template>`,
  }),
};

/** With the context menu disabled the browser's own menu shows. */
export const Disabled: Story = { args: { lfxUiContextMenuDisabled: true } as Partial<UiContextMenuDirective> };

/** The menu flips above the pointer near the bottom edge of the window. */
export const FlipsAtTheEdge: Story = {
  render: () => ({
    template: `
      <div class="flex h-[360px] items-end">
        <div class="edge flex h-[96px] w-[320px] items-center rounded-ui-md bg-ui-background-100 px-[16px] label-14 text-ui-neutral-900 focus-visible:shadow-focus focus-visible:outline-none"
          tabindex="0" [lfxUiContextMenu]="menu">
          Right-click near the bottom
        </div>
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
