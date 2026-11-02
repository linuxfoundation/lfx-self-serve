// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { argsToTemplate, type Meta, type StoryObj } from '@storybook/angular';

import { UiTabsComponent } from './tabs.component';

const meta: Meta<UiTabsComponent> = {
  title: 'Uikit/Tabs',
  component: UiTabsComponent,
  args: {
    tabs: [
      { value: 'upcoming', label: 'Upcoming', count: 102 },
      { value: 'past', label: 'Past', count: 97 },
    ],
    value: 'upcoming',
    ariaLabel: 'Meetings',
    idPrefix: '',
    size: 'default',
    variant: 'default',
  },
  render: (args) => ({ props: args, template: `<lfx-ui-tabs ${argsToTemplate(args)} />` }),
};
export default meta;
type Story = StoryObj<UiTabsComponent>;

/** 14px tabs, 24px apart, on a 1px rule; the selected tab has a 2px accent bar. */
export const WithCounts: Story = {};
export const WithoutCounts: Story = {
  args: {
    ariaLabel: 'Project',
    tabs: [
      { value: 'overview', label: 'Overview' },
      { value: 'meetings', label: 'Meetings' },
      { value: 'committees', label: 'Committees' },
      { value: 'lists', label: 'Mailing Lists' },
    ],
    value: 'overview',
  },
};
/** The size used on Meetings: 13px text and 11px bottom padding. */
export const Small: Story = { args: { size: 'small' } };
/** A 14px icon before the label. */
export const WithIcons: Story = {
  args: {
    ariaLabel: 'Repositories',
    tabs: [
      { value: 'github', label: 'GitHub', icon: 'fa-brands fa-github' },
      { value: 'gitlab', label: 'GitLab', icon: 'fa-brands fa-gitlab' },
      { value: 'bitbucket', label: 'Bitbucket', icon: 'fa-brands fa-bitbucket' },
    ],
    value: 'github',
  },
};
/** 32px pills without a rule; the selected pill uses the accent tones. The small size does not apply. */
export const Secondary: Story = {
  args: {
    variant: 'secondary',
    ariaLabel: 'Range',
    tabs: [
      { value: 'overview', label: 'Overview' },
      { value: 'activity', label: 'Activity' },
      { value: 'settings', label: 'Settings' },
    ],
    value: 'overview',
  },
};
/** `countLabel` turns the accessible name into "Upcoming, 102 meetings". */
export const WithSpokenCount: Story = {
  args: {
    tabs: [
      { value: 'upcoming', label: 'Upcoming', count: 102, countLabel: '102 meetings' },
      { value: 'past', label: 'Past', count: 97, countLabel: '97 meetings' },
    ],
  },
};
export const WithPanelIds: Story = { args: { idPrefix: 'meetings' } };
export const SecondSelected: Story = { args: { value: 'past' } };
/** A disabled tab keeps its place, greyed. Hover it or arrow onto it to see why. */
export const WithDisabledTab: Story = {
  args: {
    ariaLabel: 'Project',
    tabs: [
      { value: 'overview', label: 'Overview' },
      { value: 'meetings', label: 'Meetings' },
      { value: 'insights', label: 'Insights', disabled: true, disabledReason: 'Insights is not enabled for this project' },
    ],
    value: 'overview',
  },
};
