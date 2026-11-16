// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { argsToTemplate, type Meta, type StoryObj } from '@storybook/angular';

import { UiTextareaComponent } from './textarea.component';

const meta: Meta<UiTextareaComponent> = {
  title: 'Uikit/Textarea',
  component: UiTextareaComponent,
  args: { label: 'Description', placeholder: 'What is this committee responsible for?' },
  render: (args) => ({ props: args, template: `<div class="w-[320px]"><lfx-ui-textarea ${argsToTemplate(args)} /></div>` }),
};
export default meta;
type Story = StoryObj<UiTextareaComponent>;

export const Default: Story = {};
export const WithHint: Story = { args: { hint: '280 characters left', maxlength: 280 } };
export const WithError: Story = {
  args: {
    label: 'Release notes',
    error: 'Add at least one sentence about what changes for attendees.',
    value: 'Moves recurring meetings to the new scheduler',
  },
};
export const Disabled: Story = { args: { disabled: true, value: 'Runs the weekly sync' } };
export const NoVisibleLabel: Story = { args: { label: '', ariaLabel: 'Description' } };
