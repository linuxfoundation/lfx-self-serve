// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { argsToTemplate, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import { UiCheckboxComponent } from './checkbox.component';

const meta: Meta<UiCheckboxComponent> = {
  title: 'Uikit/Checkbox',
  component: UiCheckboxComponent,
  decorators: [moduleMetadata({ imports: [ReactiveFormsModule] })],
  args: { label: 'Notify subscribers', ariaLabel: '', name: '', disabled: false, checked: false, indeterminate: false },
  render: (args) => ({ props: args, template: `<lfx-ui-checkbox ${argsToTemplate(args)} />` }),
};
export default meta;
type Story = StoryObj<UiCheckboxComponent>;

export const Default: Story = {};
export const Checked: Story = { args: { checked: true } };
export const Indeterminate: Story = { args: { indeterminate: true, label: 'Select all' } };
export const Disabled: Story = { args: { disabled: true } };
export const DisabledChecked: Story = { args: { disabled: true, checked: true } };
export const WithoutLabel: Story = { args: { label: '', ariaLabel: 'Select row' } };

export const ReactiveForm: Story = {
  render: () => ({
    props: { control: new FormControl(true) },
    template: `
      <div class="flex flex-col gap-[12px]">
        <lfx-ui-checkbox label="Notify subscribers" [formControl]="control" />
        <span class="copy-13 text-ui-neutral-600">Control value: {{ control.value }}</span>
      </div>`,
  }),
};
