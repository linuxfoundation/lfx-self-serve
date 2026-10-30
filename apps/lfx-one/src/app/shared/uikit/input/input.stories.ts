// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { argsToTemplate, type Meta, type StoryObj } from '@storybook/angular';

import { UiInputComponent } from './input.component';

const meta: Meta<UiInputComponent> = {
  title: 'Uikit/Input',
  component: UiInputComponent,
  args: { label: 'Project name', placeholder: 'kubernetes', size: 'medium', type: 'text' },
  render: (args) => ({ props: args, template: `<div class="w-[320px]"><lfx-ui-input ${argsToTemplate(args)} /></div>` }),
};
export default meta;
type Story = StoryObj<UiInputComponent>;

export const Default: Story = {};
export const WithHint: Story = { args: { hint: 'Lowercase letters, numbers and dashes.' } };
export const WithError: Story = { args: { error: 'Use lowercase letters, numbers and dashes only.', value: 'Kube Netes' } };
export const Disabled: Story = { args: { disabled: true, value: 'kubernetes' } };
export const Rounded: Story = { args: { rounded: true } };
export const IconPrefix: Story = { args: { prefixIcon: 'fa-light fa-link', placeholder: 'example.org' } };
export const StyledAffixes: Story = { args: { prefixText: 'https://', suffixText: '.org', affixStyled: true, placeholder: 'linuxfoundation' } };
export const UnstyledAffixes: Story = { args: { prefixText: '$', suffixText: 'USD', placeholder: '0.00' } };
export const NoVisibleLabel: Story = { args: { label: '', ariaLabel: 'Project name' } };
export const AllSizes: Story = {
  render: () => ({
    template: `
      <div class="flex w-[320px] flex-col gap-4">
        <lfx-ui-input size="tiny" ariaLabel="Tiny" placeholder="Tiny, 24px" prefixIcon="fa-light fa-link" />
        <lfx-ui-input size="small" ariaLabel="Small" placeholder="Small, 32px" prefixIcon="fa-light fa-link" />
        <lfx-ui-input size="medium" ariaLabel="Medium" placeholder="Medium, 40px" prefixIcon="fa-light fa-link" />
      </div>`,
  }),
};
