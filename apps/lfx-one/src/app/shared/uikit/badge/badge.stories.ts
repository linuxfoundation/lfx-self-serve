// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { argsToTemplate, type Meta, type StoryObj } from '@storybook/angular';

import { UiBadgeComponent } from './badge.component';

const meta: Meta<UiBadgeComponent> = {
  title: 'Uikit/Badge',
  component: UiBadgeComponent,
  args: { value: 3, tone: 'neutral' },
  render: (args) => ({ props: args, template: `<lfx-ui-badge ${argsToTemplate(args)} />` }),
};
export default meta;
type Story = StoryObj<UiBadgeComponent>;

export const Neutral: Story = {};
export const Accent: Story = { args: { tone: 'accent' } };
export const WideCount: Story = { args: { value: 128 } };
