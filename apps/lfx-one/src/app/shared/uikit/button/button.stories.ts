// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideRouter } from '@angular/router';
import { applicationConfig, argsToTemplate, type Meta, type StoryObj } from '@storybook/angular';

import { UiMenuItemComponent } from '../menu/menu-item.component';
import { UiMenuSeparatorComponent } from '../menu/menu-separator.component';
import { UiMenuComponent } from '../menu/menu.component';
import { UiButtonComponent } from './button.component';

const meta: Meta<UiButtonComponent> = {
  title: 'Uikit/Button',
  component: UiButtonComponent,
  // Compodoc cannot read the shared union aliases, so the selects are declared here.
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'secondary-accent', 'tertiary', 'tertiary-accent', 'danger', 'danger-tertiary', 'recording'],
    },
    size: { control: 'select', options: ['tiny', 'small', 'medium'] },
  },
  decorators: [applicationConfig({ providers: [provideRouter([{ path: '**', children: [] }])] })],
  args: {
    variant: 'primary',
    size: 'medium',
    icon: '',
    trailingIcon: '',
    iconOnly: false,
    disabled: false,
    loading: false,
    fullWidth: false,
    type: 'button',
    ariaLabel: '',
  },
  render: (args) => ({ props: args, template: `<lfx-ui-button ${argsToTemplate(args)}>Button</lfx-ui-button>` }),
};
export default meta;
type Story = StoryObj<UiButtonComponent>;

export const Primary: Story = {};
export const Secondary: Story = { args: { variant: 'secondary' } };
export const SecondaryAccent: Story = { args: { variant: 'secondary-accent' } };
export const Tertiary: Story = { args: { variant: 'tertiary' } };
export const TertiaryAccent: Story = { args: { variant: 'tertiary-accent' } };
export const Danger: Story = { args: { variant: 'danger' } };
export const DangerTertiary: Story = { args: { variant: 'danger-tertiary' } };
/** Not in the LFX UI Library: the epic's proposed green action, flagged for the design team. */
export const Recording: Story = { args: { variant: 'recording', icon: 'fa-light fa-circle-dot' } };
export const Tiny: Story = { args: { size: 'tiny', variant: 'secondary' } };
export const Small: Story = { args: { size: 'small', variant: 'secondary' } };
export const WithLeadingIcon: Story = { args: { icon: 'fa-light fa-plus' } };
export const WithTrailingIcon: Story = { args: { variant: 'secondary', size: 'small', trailingIcon: 'fa-light fa-chevron-right' } };
export const WithBothIcons: Story = { args: { icon: 'fa-light fa-video', trailingIcon: 'fa-light fa-chevron-right' } };
/** Icon-only buttons are always circles; give them an `ariaLabel` and a tooltip. */
export const IconOnly: Story = {
  args: { variant: 'secondary', iconOnly: true, icon: 'fa-light fa-plus', ariaLabel: 'Add' },
  render: (args) => ({ props: args, template: `<lfx-ui-button ${argsToTemplate(args)} />` }),
};
export const Disabled: Story = { args: { disabled: true } };
/** The spinner replaces the leading icon, the label stays, and clicks are ignored. */
export const Loading: Story = { args: { loading: true, icon: 'fa-light fa-floppy-disk' } };
export const FullWidth: Story = { args: { fullWidth: true } };
export const AsLink: Story = { args: { variant: 'secondary', link: '/meetings', trailingIcon: 'fa-light fa-arrow-right' } };

/** `lfxUiTooltip` on `lfx-ui-button` reaches the inner button, so screen readers read it when the button is focused. */
export const WithTooltip: Story = {
  render: () => ({
    template: `
      <div class="flex justify-center p-[64px]">
        <lfx-ui-button variant="secondary" [iconOnly]="true" icon="fa-light fa-copy" ariaLabel="Copy link" lfxUiTooltip="Copy the public link" [lfxUiTooltipShortcut]="['⌘', 'C']" />
      </div>`,
    moduleMetadata: { imports: [UiButtonComponent] },
  }),
};

/** `menu` makes the inner button the trigger of an `lfx-ui-menu`: `aria-haspopup` and `aria-expanded` are set and Escape returns focus to the button. */
export const WithMenu: Story = {
  render: () => ({
    template: `
      <div class="flex justify-center p-[64px]">
        <lfx-ui-button variant="secondary" trailingIcon="fa-light fa-chevron-down" [menu]="actions">Actions</lfx-ui-button>
        <ng-template #actions>
          <lfx-ui-menu ariaLabel="Project actions">
            <lfx-ui-menu-item icon="fa-light fa-pen-to-square">Edit</lfx-ui-menu-item>
            <lfx-ui-menu-item icon="fa-light fa-copy">Duplicate</lfx-ui-menu-item>
            <lfx-ui-menu-separator />
            <lfx-ui-menu-item variant="danger" icon="fa-light fa-trash-can">Delete Project</lfx-ui-menu-item>
          </lfx-ui-menu>
        </ng-template>
      </div>`,
    moduleMetadata: { imports: [UiButtonComponent, UiMenuComponent, UiMenuItemComponent, UiMenuSeparatorComponent] },
  }),
};

/** Every variant in its default, disabled and loading state, for visual comparison with the library. */
export const Matrix: Story = {
  render: () => ({
    template: `
      <div class="flex flex-col gap-[16px]">
        @for (size of ['tiny', 'small', 'medium']; track size) {
          <div class="flex flex-wrap items-center gap-[8px]">
            @for (variant of ['primary','secondary','secondary-accent','tertiary','tertiary-accent','danger','danger-tertiary','recording']; track variant) {
              <lfx-ui-button [variant]="variant" [size]="size" icon="fa-light fa-circle">{{ variant }}</lfx-ui-button>
            }
          </div>
          <div class="flex flex-wrap items-center gap-[8px]">
            @for (variant of ['primary','secondary','secondary-accent','tertiary','tertiary-accent','danger','danger-tertiary','recording']; track variant) {
              <lfx-ui-button [variant]="variant" [size]="size" [disabled]="true" icon="fa-light fa-circle">{{ variant }}</lfx-ui-button>
            }
            <lfx-ui-button variant="primary" [size]="size" [loading]="true">Saving</lfx-ui-button>
            <lfx-ui-button variant="secondary" [size]="size" [iconOnly]="true" icon="fa-light fa-plus" ariaLabel="Add" />
          </div>
        }
      </div>`,
    moduleMetadata: { imports: [UiButtonComponent] },
  }),
};
