// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { argsToTemplate, type Meta, type StoryObj } from '@storybook/angular';

import { UiTabsComponent } from './tabs.component';

const meta: Meta<UiTabsComponent> = {
  title: 'Uikit/Tabs',
  component: UiTabsComponent,
  args: {
    tabs: [
      { value: 'upcoming', label: 'Upcoming', count: 12 },
      { value: 'past', label: 'Past', count: 48 },
    ],
    value: 'upcoming',
    ariaLabel: 'Meetings',
  },
  render: (args) => ({ props: args, template: `<lfx-ui-tabs ${argsToTemplate(args)} />` }),
};
export default meta;
type Story = StoryObj<UiTabsComponent>;

export const WithCounts: Story = {};
export const WithoutCounts: Story = {
  args: {
    tabs: [
      { value: 'upcoming', label: 'Upcoming' },
      { value: 'past', label: 'Past' },
    ],
  },
};
export const SecondSelected: Story = { args: { value: 'past' } };
export const WithDisabledTab: Story = {
  args: {
    tabs: [
      { value: 'upcoming', label: 'Upcoming', count: 12 },
      { value: 'past', label: 'Past', count: 48 },
      { value: 'drafts', label: 'Drafts', disabled: true },
    ],
  },
};
