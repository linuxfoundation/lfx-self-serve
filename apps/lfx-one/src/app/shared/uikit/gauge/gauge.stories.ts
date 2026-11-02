// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { argsToTemplate, type Meta, type StoryObj } from '@storybook/angular';

import { UiGaugeComponent } from './gauge.component';

const meta: Meta<UiGaugeComponent> = {
  title: 'Uikit/Gauge',
  component: UiGaugeComponent,
  args: { value: 92, label: 'Health score', size: 'default', tone: 'level', showValue: true, indeterminate: false },
  render: (args) => ({ props: args, template: `<lfx-ui-gauge ${argsToTemplate(args)} />` }),
};
export default meta;
type Story = StoryObj<UiGaugeComponent>;

export const High: Story = {};
export const Mid: Story = { args: { value: 58 } };
export const Low: Story = { args: { value: 21 } };
export const Accent: Story = { args: { value: 64, tone: 'accent' } };
export const Large: Story = { args: { size: 'large' } };
export const Small: Story = { args: { size: 'small', value: 75 } };
export const Tiny: Story = { args: { size: 'tiny', value: 40 } };
export const WithoutNumber: Story = { args: { showValue: false } };
export const Indeterminate: Story = { args: { size: 'small', indeterminate: true, label: 'Calculating' } };
// Exact px, not rem; 14px root.
export const WithVisibleLabel: Story = {
  render: () => ({
    template: `<span class="inline-flex items-center gap-[8px] copy-14 text-ui-neutral-900"><lfx-ui-gauge [value]="58" label="Health score" size="small" /> Health score</span>`,
  }),
};
