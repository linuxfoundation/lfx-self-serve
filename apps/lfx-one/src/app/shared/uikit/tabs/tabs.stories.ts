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
/** 13px text and 11px bottom padding, for a dense bar. */
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
/** A 7px dot in a colour role before the label, such as each group type's colour. */
export const WithDots: Story = {
  args: {
    ariaLabel: 'Group type',
    tabs: [
      { value: 'all', label: 'All', count: 42 },
      { value: 'boards', label: 'Boards', count: 2, dotTone: 'feature' },
      { value: 'oversight', label: 'Oversight', count: 6, dotTone: 'success' },
      { value: 'working-groups', label: 'Working Groups', count: 17, dotTone: 'warning' },
      { value: 'sigs', label: 'SIGs', count: 11, dotTone: 'accent' },
      { value: 'ambassadors', label: 'Ambassadors', count: 2, dotTone: 'danger' },
      { value: 'other', label: 'Other', count: 4, dotTone: 'neutral' },
    ],
    value: 'all',
  },
};
/** Too wide for the row, the tabs become a select that keeps the dots and counts. Widen the row to bring the tabs back. */
export const CollapseToSelect: Story = {
  args: { ...WithDots.args, collapseToSelect: true },
  render: (args) => ({
    props: args,
    template: `<div class="w-[360px] resize-x overflow-auto"><lfx-ui-tabs ${argsToTemplate(args)} /></div>`,
  }),
};
