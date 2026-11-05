// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { argsToTemplate, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import { UiMenuItemComponent } from '../menu/menu-item.component';
import { UiMenuSeparatorComponent } from '../menu/menu-separator.component';
import { UiMenuComponent } from '../menu/menu.component';
import { UiSplitButtonComponent } from './split-button.component';

// The menu template is declared in the story template, so `menu` is left out of the args and bound by hand.
const menuTemplate = `
  <ng-template #deployMenu>
    <lfx-ui-menu ariaLabel="Deploy options" class="!w-[220px]">
      <lfx-ui-menu-item>Deploy</lfx-ui-menu-item>
      <lfx-ui-menu-item icon="fa-light fa-clock">Schedule Deploy</lfx-ui-menu-item>
      <lfx-ui-menu-item icon="fa-light fa-code-branch">Deploy Branch…</lfx-ui-menu-item>
    </lfx-ui-menu>
  </ng-template>`;

const meta: Meta<UiSplitButtonComponent> = {
  title: 'Uikit/SplitButton',
  component: UiSplitButtonComponent,
  decorators: [moduleMetadata({ imports: [UiMenuComponent, UiMenuItemComponent, UiMenuSeparatorComponent] })],
  parameters: { layout: 'padded' },
  // Compodoc cannot read the shared union aliases, so the selects are declared here; `menu` is a template, not a control.
  argTypes: {
    variant: { control: 'select', options: ['primary', 'secondary', 'recording'] },
    size: { control: 'select', options: ['tiny', 'small', 'default', 'large'] },
    menu: { table: { disable: true } },
  },
  args: { label: 'Deploy', variant: 'primary', size: 'default', icon: '', menuLabel: '', disabled: false },
  render: (args) => ({
    props: args,
    template: `<lfx-ui-split-button ${argsToTemplate(args, { exclude: ['menu'] })} [menu]="deployMenu" />${menuTemplate}`,
  }),
};
export default meta;
type Story = StoryObj<UiSplitButtonComponent>;

/** The accent split button. Try Enter or Space on the chevron, the arrow keys, Home, End, a typed letter and Escape. */
export const Primary: Story = {};

/** The neutral split button; the two borders overlap by 1px instead of a divider. */
export const Secondary: Story = { args: { variant: 'secondary', label: 'Export CSV' } };

export const Large: Story = { args: { variant: 'secondary', size: 'large', label: 'Export CSV' } };

export const Small: Story = { args: { variant: 'secondary', size: 'small', label: 'Export' } };

export const Tiny: Story = { args: { variant: 'secondary', size: 'tiny', label: 'Export' } };

export const WithIcon: Story = { args: { icon: 'fa-light fa-rocket' } };

export const Disabled: Story = { args: { disabled: true } };

/** All four sizes of both variants, side by side. */
export const Sizes: Story = {
  render: () => ({
    template: `
      <div class="flex flex-col items-start gap-[16px]">
        <lfx-ui-split-button size="large" label="Deploy" [menu]="deployMenu" />
        <lfx-ui-split-button label="Deploy" [menu]="deployMenu" />
        <lfx-ui-split-button label="Deploy" size="small" [menu]="deployMenu" />
        <lfx-ui-split-button label="Deploy" size="tiny" [menu]="deployMenu" />
        <lfx-ui-split-button size="large" label="Export CSV" variant="secondary" [menu]="deployMenu" />
        <lfx-ui-split-button label="Export CSV" variant="secondary" [menu]="deployMenu" />
        <lfx-ui-split-button label="Export CSV" variant="secondary" size="small" [menu]="deployMenu" />
        <lfx-ui-split-button label="Export CSV" variant="secondary" size="tiny" [menu]="deployMenu" />
      </div>${menuTemplate}`,
  }),
};

/** At the right edge of its container the menu falls back to the end edge, so it stays inside the window. */
export const AtTheRightEdge: Story = {
  render: () => ({
    template: `<div class="flex justify-end"><lfx-ui-split-button label="Deploy" [menu]="deployMenu" /></div>${menuTemplate}`,
  }),
};

/** With a `secondaryLabel` the two halves read as two equal actions, such as opening one dialog on either of its tabs. */
export const LabelledPair: Story = {
  render: () => ({
    template: `
      <div class="flex flex-col items-start gap-[16px]">
        <lfx-ui-split-button label="Registration trend" icon="fa-light fa-chart-line" variant="secondary" size="small" secondaryLabel="Snapshot" secondaryIcon="fa-light fa-table-list" />
        <lfx-ui-split-button label="Trend" icon="fa-light fa-chart-line" variant="secondary" size="small" secondaryLabel="Snapshot" secondaryIcon="fa-light fa-table-list" />
        <lfx-ui-split-button label="Registration trend" icon="fa-light fa-chart-line" variant="secondary" secondaryLabel="Snapshot" secondaryIcon="fa-light fa-table-list" />
      </div>`,
  }),
};

/** Without a menu the right half is a second action: an icon button named by its tooltip. */
export const WithAction: Story = {
  render: () => ({
    template: `
      <div class="flex flex-col items-start gap-[16px]">
        <lfx-ui-split-button size="large" label="Recording" variant="recording" icon="fa-light fa-play" secondaryIcon="fa-light fa-link" secondaryTooltip="Copy recording link" />
        <lfx-ui-split-button label="Recording" variant="recording" icon="fa-light fa-play" secondaryIcon="fa-light fa-link" secondaryTooltip="Copy recording link" />
        <lfx-ui-split-button label="Recording" variant="secondary" icon="fa-light fa-circle-play" secondaryIcon="fa-light fa-link" secondaryTooltip="Copy recording link" />
        <lfx-ui-split-button label="Deploy" secondaryIcon="fa-light fa-clock" secondaryTooltip="Schedule deploy" />
      </div>`,
  }),
};
