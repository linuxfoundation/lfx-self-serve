// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { argsToTemplate, type Meta, type StoryObj } from '@storybook/angular';

import { UiGaugeComponent } from './gauge.component';

const meta: Meta<UiGaugeComponent> = {
  title: 'Uikit/Gauge',
  component: UiGaugeComponent,
  args: {
    value: 92,
    label: 'Health score',
    size: 'default',
    tone: 'level',
    level: null,
    weight: 'default',
    showValue: true,
    indeterminate: false,
    empty: false,
  },
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
/** An 8-unit ring with square ends at a size the scale lacks, coloured by the caller's own rule, beside its number. Exact px; 14px root. */
export const ThinInARow: Story = {
  render: () => ({
    template: `
      <div class="flex items-center gap-[24px]">
        <span class="inline-flex items-center gap-[10px] copy-14 text-ui-neutral-900"><lfx-ui-gauge [value]="78" [size]="52" weight="thin" level="high" [showValue]="false" label="Registrations against goal" /> 780</span>
        <span class="inline-flex items-center gap-[10px] copy-14 text-ui-neutral-900"><lfx-ui-gauge [value]="45" [size]="52" weight="thin" level="mid" [showValue]="false" label="Registrations against goal" /> 450</span>
        <span class="inline-flex items-center gap-[10px] copy-14 text-ui-neutral-900"><lfx-ui-gauge [size]="52" weight="thin" empty label="Registrations, no goal set" /> 210</span>
      </div>`,
  }),
};
