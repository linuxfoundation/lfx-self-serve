// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { argsToTemplate, type Meta, type StoryObj } from '@storybook/angular';

import { UiKeyboardInputComponent } from './keyboard-input.component';

// Exact px, not rem: the app root font is 14px.
const meta: Meta<UiKeyboardInputComponent> = {
  title: 'Uikit/Keyboard input',
  component: UiKeyboardInputComponent,
  args: { keys: ['⌘', 'K'], size: 'md' },
  render: (args) => ({ props: args, template: `<lfx-ui-keyboard-input ${argsToTemplate(args)} />` }),
};
export default meta;
type Story = StoryObj<UiKeyboardInputComponent>;

export const Default: Story = {};
export const SingleKey: Story = { args: { keys: ['⌘'] } };
export const Chord: Story = { args: { keys: ['⇧', '⌘', 'P'] } };
export const ChordAsOneKey: Story = { args: { keys: ['⌘K'] } };
export const WordKeys: Story = {
  render: () => ({
    template: `<div class="flex items-center gap-[16px]"><lfx-ui-keyboard-input [keys]="['Enter']" /><lfx-ui-keyboard-input [keys]="['Esc']" /></div>`,
  }),
};
export const Small: Story = { args: { keys: ['⌘', 'K'], size: 'sm' } };
export const SmallSingleKey: Story = { args: { keys: ['?'], size: 'sm' } };
export const InsideSentence: Story = {
  render: () => ({
    template: `<div class="flex items-center gap-[8px] text-copy-14 text-ui-neutral-600"><span>Press</span><lfx-ui-keyboard-input [keys]="['⌘', 'K']" /><span>or</span><lfx-ui-keyboard-input [keys]="['/']" /><span>to search</span></div>`,
  }),
};
