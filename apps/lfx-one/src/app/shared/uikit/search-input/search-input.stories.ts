// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { argsToTemplate, type Meta, type StoryObj } from '@storybook/angular';

import { UiSearchInputComponent } from './search-input.component';

const meta: Meta<UiSearchInputComponent> = {
  title: 'Uikit/Search input',
  component: UiSearchInputComponent,
  args: { value: '', placeholder: 'Search meetings', ariaLabel: 'Search meetings', disabled: false },
  render: (args) => ({ props: args, template: `<lfx-ui-search-input ${argsToTemplate(args)} />` }),
};
export default meta;
type Story = StoryObj<UiSearchInputComponent>;

export const Empty: Story = {};
export const WithValue: Story = { args: { value: 'kubernetes' } };
export const Disabled: Story = { args: { disabled: true } };
