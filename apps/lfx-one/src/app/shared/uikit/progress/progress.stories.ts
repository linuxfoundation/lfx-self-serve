// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { argsToTemplate, type Meta, type StoryObj } from '@storybook/angular';

import { UiProgressComponent } from './progress.component';

// Exact px, not rem; 14px root.
const meta: Meta<UiProgressComponent> = {
  title: 'Uikit/Progress',
  component: UiProgressComponent,
  args: { value: 32, max: 50, label: 'Seats used', showLabel: true, valueText: '32 of 50', tone: 'accent' },
  render: (args) => ({ props: args, template: `<div class="max-w-[460px]"><lfx-ui-progress ${argsToTemplate(args)} /></div>` }),
};
export default meta;
type Story = StoryObj<UiProgressComponent>;

export const Default: Story = {};
export const Success: Story = { args: { value: 100, label: 'Import complete', valueText: '1,284 members', tone: 'success' } };
export const Warning: Story = { args: { value: 86, label: 'Storage', valueText: '', tone: 'warning' } };
export const ErrorState: Story = { name: 'Error', args: { value: 97, label: 'Build minutes', valueText: '', tone: 'error' } };
export const Secondary: Story = { args: { value: 30, label: 'Secondary', valueText: '', tone: 'secondary' } };
export const RealMaximum: Story = { args: { value: 32, max: 50, valueText: '' } };
export const WithoutLabelRow: Story = { args: { showLabel: false } };
