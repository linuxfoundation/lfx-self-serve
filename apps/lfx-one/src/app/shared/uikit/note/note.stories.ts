// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { argsToTemplate, type Meta, type StoryObj } from '@storybook/angular';

import { UiNoteComponent } from './note.component';

const meta: Meta<UiNoteComponent> = {
  title: 'Uikit/Note',
  component: UiNoteComponent,
  args: { variant: 'info', fill: false, size: 'default', label: '', icon: '', alert: false },
  render: (args) => ({ props: args, template: `<lfx-ui-note ${argsToTemplate(args)}>Meetings are moving to the new scheduler next week.</lfx-ui-note>` }),
};
export default meta;
type Story = StoryObj<UiNoteComponent>;

export const Info: Story = {};
export const Secondary: Story = { args: { variant: 'secondary' } };
export const Success: Story = { args: { variant: 'success' } };
export const Warning: Story = { args: { variant: 'warning' } };
export const ErrorState: Story = { name: 'Error', args: { variant: 'error', alert: true } };
export const Violet: Story = { args: { variant: 'violet', label: 'Beta:' } };
export const Filled: Story = { args: { fill: true } };
export const Small: Story = { args: { size: 'small' } };
// Exact px, not rem; 14px root.
export const WithAction: Story = {
  args: { variant: 'warning', fill: true },
  render: (args) => ({
    props: args,
    template: `<lfx-ui-note ${argsToTemplate(args)}>Membership renews in 14 days.<button note-action type="button" class="inline-flex h-ui-small shrink-0 items-center rounded-ui-xs bg-ui-background-100 px-[10px] button-14 text-ui-neutral-900 edge">Review</button></lfx-ui-note>`,
  }),
};
