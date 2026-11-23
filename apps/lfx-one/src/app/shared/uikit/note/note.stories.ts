// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { argsToTemplate, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import { UiButtonComponent } from '../button/button.component';
import { UiNoteComponent } from './note.component';

const meta: Meta<UiNoteComponent> = {
  title: 'Uikit/Note',
  component: UiNoteComponent,
  decorators: [moduleMetadata({ imports: [UiButtonComponent] })],
  args: { variant: 'info', fill: false, size: 'default', plain: false, label: '', icon: '', announce: false, disabled: false },
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
/** Small with a medium-weight `label` before the message, as for a verdict. */
export const SmallWithLabel: Story = { args: { size: 'small', variant: 'error', label: 'Needs action:' } };
export const Disabled: Story = { args: { disabled: true } };
/** 24px with 12px text, inside rows, cards and data blocks. */
export const Tiny: Story = { args: { size: 'tiny' } };
/** Coloured icon and text only, for a status line inside another component. */
export const PlainTiny: Story = {
  args: { variant: 'warning', plain: true, size: 'tiny' },
  render: (args) => ({ props: args, template: `<lfx-ui-note ${argsToTemplate(args)}>This meeting was poorly attended</lfx-ui-note>` }),
};
export const WithAction: Story = {
  args: { variant: 'warning', fill: true },
  render: (args) => ({
    props: args,
    template: `<lfx-ui-note ${argsToTemplate(args)}>Membership renews in 14 days.<lfx-ui-button note-action variant="secondary" class="shrink-0">Review</lfx-ui-button></lfx-ui-note>`,
  }),
};
