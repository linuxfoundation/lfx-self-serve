// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { UiOption } from '@lfx-one/shared/interfaces';
import { argsToTemplate, type Meta, type StoryObj } from '@storybook/angular';

import { UiSelectComponent } from './select.component';

const foundations: UiOption[] = [
  { value: 'cncf', label: 'Cloud Native Computing Foundation' },
  { value: 'openssf', label: 'OpenSSF' },
  { value: 'lfai', label: 'LF AI & Data', disabled: true },
  { value: 'lfe', label: 'LF Energy' },
  { value: 'lfn', label: 'LF Networking' },
];

const meta: Meta<UiSelectComponent> = {
  title: 'Uikit/Select',
  component: UiSelectComponent,
  args: { label: 'Foundation', placeholder: 'Pick a foundation', options: foundations, size: 'medium' },
  render: (args) => ({ props: args, template: `<div class="w-[320px]"><lfx-ui-select ${argsToTemplate(args)} /></div>` }),
};
export default meta;
type Story = StoryObj<UiSelectComponent>;

export const Default: Story = {};
export const Chosen: Story = { args: { value: 'openssf' } };
export const WithHint: Story = { args: { hint: 'The foundation that hosts the project.' } };
export const WithError: Story = { args: { error: 'Choose a foundation to continue.' } };
export const Disabled: Story = { args: { disabled: true, value: 'cncf' } };
export const PrefixIcon: Story = {
  args: {
    label: 'Region',
    placeholder: 'Pick a region',
    prefixIcon: 'fa-light fa-globe',
    options: [
      { value: 'lisbon', label: 'Europe (Lisbon)' },
      { value: 'us-east', label: 'US East' },
      { value: 'tokyo', label: 'Asia (Tokyo)' },
    ],
  },
};
export const OptionIcons: Story = {
  args: {
    label: 'Visibility',
    value: 'public',
    options: [
      { value: 'public', label: 'Public', icon: 'fa-light fa-globe' },
      { value: 'members', label: 'Members only', icon: 'fa-light fa-users' },
      { value: 'private', label: 'Private', icon: 'fa-light fa-lock' },
    ],
  },
};
export const NoVisibleLabel: Story = { args: { label: '', ariaLabel: 'Foundation' } };
export const AllSizes: Story = {
  render: (args) => ({
    props: args,
    template: `
      <div class="flex w-[320px] flex-col gap-4">
        <lfx-ui-select size="tiny" ariaLabel="Tiny" placeholder="Tiny, 24px" prefixIcon="fa-light fa-globe" [options]="options" />
        <lfx-ui-select size="small" ariaLabel="Small" placeholder="Small, 32px" prefixIcon="fa-light fa-globe" [options]="options" />
        <lfx-ui-select size="medium" ariaLabel="Medium" placeholder="Medium, 40px" prefixIcon="fa-light fa-globe" [options]="options" />
      </div>`,
  }),
};
