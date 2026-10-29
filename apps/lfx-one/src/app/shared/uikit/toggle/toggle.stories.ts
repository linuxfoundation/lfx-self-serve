// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { argsToTemplate, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import { UiToggleComponent } from './toggle.component';

const meta: Meta<UiToggleComponent> = {
  title: 'Uikit/Toggle',
  component: UiToggleComponent,
  decorators: [moduleMetadata({ imports: [ReactiveFormsModule] })],
  args: { label: 'Email notifications', ariaLabel: '', name: '', size: 'default', tone: 'accent', disabled: false, checked: false },
  argTypes: {
    size: { control: 'inline-radio', options: ['default', 'medium', 'large'] },
    tone: { control: 'inline-radio', options: ['accent', 'warning', 'danger'] },
  },
  render: (args) => ({ props: args, template: `<lfx-ui-toggle ${argsToTemplate(args)} />` }),
};
export default meta;
type Story = StoryObj<UiToggleComponent>;

export const Default: Story = {};
export const On: Story = { args: { checked: true } };
export const Medium: Story = { args: { size: 'medium', checked: true } };
export const Large: Story = { args: { size: 'large', checked: true } };
export const Warning: Story = { args: { tone: 'warning', checked: true, label: 'Maintenance mode' } };
export const Danger: Story = { args: { tone: 'danger', checked: true, label: 'Block all traffic' } };
export const Disabled: Story = { args: { disabled: true } };
export const DisabledOn: Story = { args: { disabled: true, checked: true } };
export const WithoutLabel: Story = { args: { label: '', ariaLabel: 'Email notifications' } };

export const ReactiveForm: Story = {
  render: () => ({
    props: { control: new FormControl(true) },
    template: `
      <div class="flex flex-col gap-[12px]">
        <lfx-ui-toggle label="Email notifications" [formControl]="control" />
        <span class="copy-13 text-ui-neutral-600">Control value: {{ control.value }}</span>
      </div>`,
  }),
};
