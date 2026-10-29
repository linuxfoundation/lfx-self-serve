// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { argsToTemplate, type Meta, type StoryObj } from '@storybook/angular';

import { UiCalendarComponent } from './calendar.component';

const meta: Meta<UiCalendarComponent> = {
  title: 'Uikit/Calendar',
  component: UiCalendarComponent,
  args: { weekStartsOn: 0, ariaLabel: '' },
  render: (args) => ({
    props: args,
    template: `<div class="rounded-ui-sm bg-ui-background-100 p-[12px] shadow-menu"><lfx-ui-calendar ${argsToTemplate(args)} /></div>`,
  }),
};
export default meta;
type Story = StoryObj<UiCalendarComponent>;

export const Default: Story = {};
export const WithSelectedDate: Story = { args: { value: new Date(2026, 9, 12) } };
export const MondayFirst: Story = { args: { weekStartsOn: 1 } };
// Function inputs are bound by hand: Storybook's controls do not carry function args through argsToTemplate.
export const WeekendsDisabled: Story = {
  render: () => ({
    props: { weekends: (date: Date): boolean => date.getDay() === 0 || date.getDay() === 6 },
    template: `<div class="rounded-ui-sm bg-ui-background-100 p-[12px] shadow-menu"><lfx-ui-calendar [isDateDisabled]="weekends" /></div>`,
  }),
};
export const PastDisabled: Story = {
  render: () => ({
    props: {
      past: (date: Date): boolean => {
        const today = new Date();
        return date < new Date(today.getFullYear(), today.getMonth(), today.getDate());
      },
    },
    template: `<div class="rounded-ui-sm bg-ui-background-100 p-[12px] shadow-menu"><lfx-ui-calendar [isDateDisabled]="past" /></div>`,
  }),
};
