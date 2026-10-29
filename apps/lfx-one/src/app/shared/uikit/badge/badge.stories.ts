// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { argsToTemplate, type Meta, type StoryObj } from '@storybook/angular';

import { UiBadgeComponent } from './badge.component';

// Exact px, not rem: the app root font is 14px.
const meta: Meta<UiBadgeComponent> = {
  title: 'Uikit/Badge',
  component: UiBadgeComponent,
  args: { tone: 'neutral', variant: 'subtle', size: 'md', dot: null },
  render: (args) => ({ props: args, template: `<lfx-ui-badge ${argsToTemplate(args)}>Beta</lfx-ui-badge>` }),
};
export default meta;
type Story = StoryObj<UiBadgeComponent>;

const TONES = ['accent', 'neutral', 'feature', 'warning', 'danger', 'success'];
const row = (variant: string, size = 'md') =>
  `<div class="flex flex-wrap items-center gap-[12px]">${TONES.map((t) => `<lfx-ui-badge tone="${t}" variant="${variant}" size="${size}">${t}</lfx-ui-badge>`).join('')}</div>`;
// Inline stroke icon: the app uses Font Awesome, which Storybook does not load.
const ICON = `<svg slot="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>`;

export const Default: Story = {};
export const Solid: Story = { render: () => ({ template: row('solid') }) };
export const SolidWarning: Story = { render: () => ({ template: `<lfx-ui-badge tone="warning" variant="solid">Warning</lfx-ui-badge>` }) };
export const Subtle: Story = { render: () => ({ template: row('subtle') }) };
export const Outline: Story = {
  render: () => ({
    template: `<div class="flex flex-wrap items-center gap-[12px]"><lfx-ui-badge variant="outline">Outline</lfx-ui-badge><lfx-ui-badge variant="outline" size="sm">v2.4.0</lfx-ui-badge></div>`,
  }),
};
export const Small: Story = { render: () => ({ template: row('subtle', 'sm') }) };
export const SmallSolid: Story = { render: () => ({ template: row('solid', 'sm') }) };
export const WithIcon: Story = {
  render: () => ({
    template: `<div class="flex flex-wrap items-center gap-[12px]"><lfx-ui-badge tone="success">${ICON}Secure</lfx-ui-badge><lfx-ui-badge tone="feature" variant="solid">${ICON}Beta</lfx-ui-badge><lfx-ui-badge variant="outline" size="sm">${ICON}main</lfx-ui-badge></div>`,
  }),
};
export const WithDot: Story = {
  render: () => ({
    template: `<div class="flex flex-wrap items-center gap-[12px]"><lfx-ui-badge variant="outline" dot="success">Active</lfx-ui-badge><lfx-ui-badge variant="outline" dot="warning">Pending</lfx-ui-badge><lfx-ui-badge variant="outline" dot="danger">Failed</lfx-ui-badge></div>`,
  }),
};
export const Count: Story = { render: () => ({ template: `<lfx-ui-badge size="sm">128</lfx-ui-badge>` }) };
