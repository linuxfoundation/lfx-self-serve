// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { argsToTemplate, type Meta, type StoryObj } from '@storybook/angular';

import { UiLoadingDotsComponent } from './loading-dots.component';

const meta: Meta<UiLoadingDotsComponent> = {
  title: 'Uikit/LoadingDots',
  component: UiLoadingDotsComponent,
  args: { size: 'md', label: '' },
  render: (args) => ({ props: args, template: `<lfx-ui-loading-dots ${argsToTemplate(args)} />` }),
};
export default meta;
type Story = StoryObj<UiLoadingDotsComponent>;

export const Default: Story = {};
export const Small: Story = { args: { size: 'sm' } };
export const Large: Story = { args: { size: 'lg' } };
/** Inline: the surrounding element owns `aria-live`; the dots stay hidden and unlabelled. */
export const InStatusLine: Story = {
  render: () => ({
    template: `<span class="inline-flex items-center gap-2 text-copy-14 text-ui-neutral-600" aria-live="polite">Generating attendance report <lfx-ui-loading-dots size="sm" /></span>`,
  }),
};
/** Standalone: `label` makes the dots a status region. */
export const Standalone: Story = { args: { label: 'Generating attendance report' } };
