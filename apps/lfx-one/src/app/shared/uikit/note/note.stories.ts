// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { argsToTemplate, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import { UiButtonComponent } from '../button/button.component';
import { UiNoteComponent } from './note.component';

const meta: Meta<UiNoteComponent> = {
  title: 'Uikit/Note',
  component: UiNoteComponent,
  decorators: [moduleMetadata({ imports: [UiButtonComponent] })],
  args: { variant: 'info', fill: false, size: 'default', label: '', icon: '', announce: false },
  render: (args) => ({ props: args, template: `<lfx-ui-note ${argsToTemplate(args)}>Meetings are moving to the new scheduler next week.</lfx-ui-note>` }),
};
export default meta;
type Story = StoryObj<UiNoteComponent>;

export const Info: Story = {};
export const Secondary: Story = { args: { variant: 'secondary' } };
export const Success: Story = { args: { variant: 'success' } };
export const Warning: Story = { args: { variant: 'warning' } };
export const ErrorState: Story = { name: 'Error', args: { variant: 'error', announce: true } };
export const Violet: Story = { args: { variant: 'violet', label: 'Beta:' } };
export const Filled: Story = { args: { fill: true } };
export const Small: Story = { args: { size: 'small' } };
export const WithAction: Story = {
  args: { variant: 'warning', fill: true },
  render: (args) => ({
    props: args,
    template: `<lfx-ui-note ${argsToTemplate(args)}>Membership renews in 14 days.<lfx-ui-button note-action variant="secondary" size="small" class="shrink-0">Review</lfx-ui-button></lfx-ui-note>`,
  }),
};
