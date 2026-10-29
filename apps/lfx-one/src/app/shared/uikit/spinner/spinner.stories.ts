// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { argsToTemplate, type Meta, type StoryObj } from '@storybook/angular';

import { UiSpinnerComponent } from './spinner.component';

const meta: Meta<UiSpinnerComponent> = {
  title: 'Uikit/Spinner',
  component: UiSpinnerComponent,
  args: { size: 20, tone: 'neutral', label: 'Loading' },
  render: (args) => ({ props: args, template: `<lfx-ui-spinner ${argsToTemplate(args)} />` }),
};
export default meta;
type Story = StoryObj<UiSpinnerComponent>;

export const Default: Story = {};
export const Size12: Story = { args: { size: 12 } };
export const Size16: Story = { args: { size: 16 } };
export const Size32: Story = { args: { size: 32 } };
export const WithStatusLine: Story = {
  render: () => ({
    template: `<span class="inline-flex items-center gap-2 text-copy-14 text-ui-neutral-900"><lfx-ui-spinner [size]="16" label="Loading" /> Fetching members</span>`,
  }),
};
export const InsideButton: Story = {
  render: () => ({
    template: `<button type="button" disabled aria-busy="true" class="inline-flex h-ui-medium items-center gap-2 rounded-ui-xs bg-ui-neutral-100 px-3 text-button-14 text-ui-neutral-500"><lfx-ui-spinner [size]="16" tone="current" label="Loading" /><span>Deploying</span></button>`,
  }),
};
