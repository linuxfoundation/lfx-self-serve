// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { argsToTemplate, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import { UiSwitchOptionComponent } from './switch-option.component';
import { UiSwitchComponent } from './switch.component';

const meta: Meta<UiSwitchComponent> = {
  title: 'Uikit/Switch',
  component: UiSwitchComponent,
  subcomponents: { UiSwitchOptionComponent },
  argTypes: { size: { control: 'inline-radio', options: ['tiny', 'small', 'medium'] } },
  decorators: [moduleMetadata({ imports: [UiSwitchOptionComponent, ReactiveFormsModule] })],
  args: { ariaLabel: 'View', size: 'medium', name: '', disabled: false, value: 'source' },
  render: (args) => ({
    props: args,
    template: `
      <lfx-ui-switch ${argsToTemplate(args)}>
        <lfx-ui-switch-option value="source" label="Source" />
        <lfx-ui-switch-option value="output" label="Output" />
      </lfx-ui-switch>`,
  }),
};
export default meta;
type Story = StoryObj<UiSwitchComponent>;

export const Medium: Story = {};
export const Small: Story = {
  args: { ariaLabel: 'Range', size: 'small', value: '7d' },
  render: (args) => ({
    props: args,
    template: `
      <lfx-ui-switch ${argsToTemplate(args)}>
        <lfx-ui-switch-option value="24h" label="24h" />
        <lfx-ui-switch-option value="7d" label="7d" />
        <lfx-ui-switch-option value="30d" label="30d" />
        <lfx-ui-switch-option value="90d" label="90d" [disabled]="true" />
      </lfx-ui-switch>`,
  }),
};
export const Tiny: Story = {
  args: { ariaLabel: 'Billing', size: 'tiny', value: 'monthly' },
  render: (args) => ({
    props: args,
    template: `
      <lfx-ui-switch ${argsToTemplate(args)}>
        <lfx-ui-switch-option value="monthly" label="Monthly" />
        <lfx-ui-switch-option value="yearly" label="Yearly" />
      </lfx-ui-switch>`,
  }),
};
/** Icon-only options keep their label as screen-reader text and show it as a tooltip. */
export const IconOnly: Story = {
  args: { ariaLabel: 'Layout', value: 'list' },
  render: (args) => ({
    props: args,
    template: `
      <lfx-ui-switch ${argsToTemplate(args)}>
        <lfx-ui-switch-option value="list" label="List" icon="fa-light fa-list" [iconOnly]="true" />
        <lfx-ui-switch-option value="grid" label="Grid" icon="fa-light fa-grid-2" [iconOnly]="true" />
      </lfx-ui-switch>`,
  }),
};
export const WithIconAndLabel: Story = {
  render: (args) => ({
    props: args,
    template: `
      <lfx-ui-switch ${argsToTemplate(args)}>
        <lfx-ui-switch-option value="source" label="Source" icon="fa-light fa-code" />
        <lfx-ui-switch-option value="output" label="Output" icon="fa-light fa-eye" />
      </lfx-ui-switch>`,
  }),
};
export const NothingChosen: Story = { args: { value: null } };
export const DisabledGroup: Story = { args: { disabled: true } };

export const ReactiveForm: Story = {
  render: () => ({
    props: { control: new FormControl('output') },
    template: `
      <div class="flex flex-col gap-[12px]">
        <lfx-ui-switch ariaLabel="View" [formControl]="control">
          <lfx-ui-switch-option value="source" label="Source" />
          <lfx-ui-switch-option value="output" label="Output" />
        </lfx-ui-switch>
        <span class="copy-13 text-ui-neutral-600">Control value: {{ control.value }}</span>
      </div>`,
  }),
};
