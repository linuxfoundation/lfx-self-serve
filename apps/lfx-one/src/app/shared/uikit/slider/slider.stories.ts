// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { argsToTemplate, type Meta, type StoryObj } from '@storybook/angular';

import { UiSliderComponent } from './slider.component';

const meta: Meta<UiSliderComponent> = {
  title: 'Uikit/Slider',
  component: UiSliderComponent,
  args: { label: 'Alert threshold', min: 0, max: 100, step: 1, value: 60, valueText: '', disabled: false },
  render: (args) => ({ props: args, template: `<div class="w-[420px]"><lfx-ui-slider ${argsToTemplate(args)} /></div>` }),
};
export default meta;
type Story = StoryObj<UiSliderComponent>;

export const Default: Story = {};
// valueText must follow value, so this story binds both to one local.
export const WithUnit: Story = {
  render: () => ({
    props: { v: 60 },
    template: `<div class="w-[420px]"><lfx-ui-slider label="Alert threshold" [(value)]="v" [valueText]="v + '%'" /></div>`,
  }),
};
export const Stepped: Story = { args: { label: 'Sample size', min: 0, max: 1000, step: 100, value: 300 } };
export const Disabled: Story = { args: { label: 'Disabled', value: 25, disabled: true } };
