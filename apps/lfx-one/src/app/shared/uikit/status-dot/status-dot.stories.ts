// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { argsToTemplate, type Meta, type StoryObj } from '@storybook/angular';

import { UiStatusDotComponent } from './status-dot.component';

const meta: Meta<UiStatusDotComponent> = {
  title: 'Uikit/StatusDot',
  component: UiStatusDotComponent,
  args: { status: 'ready', label: '', dotOnly: false },
  render: (args) => ({ props: args, template: `<lfx-ui-status-dot ${argsToTemplate(args)} />` }),
};
export default meta;
type Story = StoryObj<UiStatusDotComponent>;

export const Queued: Story = { args: { status: 'queued' } };
export const Building: Story = { args: { status: 'building' } };
export const Ready: Story = {};
export const Error: Story = { args: { status: 'error' } };
export const Canceled: Story = { args: { status: 'canceled' } };
export const Deleted: Story = { args: { status: 'deleted' } };
export const CustomLabel: Story = { args: { status: 'building', label: 'Running' } };
export const DotOnly: Story = { args: { status: 'ready', dotOnly: true } };
export const AllStates: Story = {
  render: () => ({
    template: `
      <div class="flex flex-col gap-4">
        <div class="flex gap-6">
          <lfx-ui-status-dot status="queued" />
          <lfx-ui-status-dot status="building" />
          <lfx-ui-status-dot status="ready" />
          <lfx-ui-status-dot status="error" />
          <lfx-ui-status-dot status="canceled" />
          <lfx-ui-status-dot status="deleted" />
        </div>
        <div class="flex gap-3.5">
          <lfx-ui-status-dot status="queued" [dotOnly]="true" />
          <lfx-ui-status-dot status="building" [dotOnly]="true" />
          <lfx-ui-status-dot status="ready" [dotOnly]="true" />
          <lfx-ui-status-dot status="error" [dotOnly]="true" />
          <lfx-ui-status-dot status="canceled" [dotOnly]="true" />
          <lfx-ui-status-dot status="deleted" [dotOnly]="true" />
        </div>
      </div>`,
  }),
};
