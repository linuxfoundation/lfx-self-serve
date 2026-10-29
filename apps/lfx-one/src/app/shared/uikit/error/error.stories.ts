// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { argsToTemplate, type Meta, type StoryObj } from '@storybook/angular';

import { UiErrorComponent } from './error.component';

const meta: Meta<UiErrorComponent> = {
  title: 'Uikit/Error',
  component: UiErrorComponent,
  args: { size: 'default', label: 'Error:', announce: true },
  render: (args) => ({
    props: args,
    template: `<lfx-ui-error ${argsToTemplate(args)}>This email address is already in use.</lfx-ui-error>`,
  }),
};
export default meta;
type Story = StoryObj<UiErrorComponent>;

export const Default: Story = {};
export const Small: Story = { args: { size: 'small', label: 'Email error:' } };
export const Large: Story = { args: { size: 'large', label: '' } };
export const WithoutLabel: Story = { args: { label: '' } };
export const WithoutAnnouncement: Story = { args: { announce: false } };
export const WithLink: Story = {
  args: { size: 'large', label: '' },
  render: (args) => ({
    props: args,
    template: `<lfx-ui-error ${argsToTemplate(args)}>We couldn't verify your membership. <a href="#">Contact us</a></lfx-ui-error>`,
  }),
};
export const AllSizes: Story = {
  render: () => ({
    template: `
      <div class="flex flex-col gap-4">
        <lfx-ui-error label="Error:">This email address is already in use.</lfx-ui-error>
        <lfx-ui-error size="small" label="Email error:">Use your organization email.</lfx-ui-error>
        <lfx-ui-error size="large">We couldn't verify your membership. <a href="#">Contact us</a></lfx-ui-error>
      </div>`,
  }),
};
