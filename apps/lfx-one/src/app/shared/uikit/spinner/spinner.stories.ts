// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { argsToTemplate, type Meta, moduleMetadata, type StoryObj } from '@storybook/angular';

import { UiButtonComponent } from '../button/button.component';
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
    template: `<span class="inline-flex items-center gap-2 text-copy-14 text-ui-neutral-600"><lfx-ui-spinner [size]="16" label="Loading" /> Fetching members</span>`,
  }),
};
export const InsideButton: Story = {
  decorators: [moduleMetadata({ imports: [UiButtonComponent] })],
  render: () => ({
    template: `<lfx-ui-button size="large" variant="secondary" [loading]="true">Deploying</lfx-ui-button>`,
  }),
};
