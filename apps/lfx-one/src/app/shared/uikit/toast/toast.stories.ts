// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Directive, inject, input } from '@angular/core';
import { UiToastConfig } from '@lfx-one/shared/interfaces';
import { argsToTemplate, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import { UiButtonComponent } from '../button/button.component';
import { UiToastComponent } from './toast.component';
import { UiToastService } from './toast.service';

/** Story helper: shows a toast through `UiToastService` when the host is clicked, or clears them all when no config is given. */
@Directive({ selector: '[lfxStoryShowsToast]', host: { '(click)': 'show()' } })
class StoryShowsToastDirective {
  public readonly lfxStoryShowsToast = input.required<UiToastConfig | null>();

  private readonly toast = inject(UiToastService);

  protected show(): void {
    const config = this.lfxStoryShowsToast();
    if (config) this.toast.show(config);
    else this.toast.dismissAll();
  }
}

const meta: Meta<UiToastComponent> = {
  title: 'Uikit/Toast',
  component: UiToastComponent,
  argTypes: { variant: { control: 'inline-radio', options: ['default', 'success', 'warning', 'error', 'dark'] } },
  decorators: [moduleMetadata({ imports: [StoryShowsToastDirective, UiButtonComponent] })],
  parameters: { layout: 'padded' },
  args: { variant: 'default', description: '', actions: [], duration: 0 },
  render: (args) => ({ props: args, template: `<lfx-ui-toast ${argsToTemplate(args)}>Committee created.</lfx-ui-toast>` }),
};
export default meta;
type Story = StoryObj<UiToastComponent>;

export const Default: Story = {};
export const Success: Story = { args: { variant: 'success' } };
export const Warning: Story = { args: { variant: 'warning' } };
/** An error is an alert and the only toast with a close button; it stays until closed. */
export const ErrorToast: Story = { args: { variant: 'error', actions: [{ label: 'Retry', run: () => undefined }] } };
/** A short confirmation: check, medium title and a quieter description. The service shows it bottom-centre for 3s. */
export const Dark: Story = { args: { variant: 'dark', description: 'Anyone with the link can join.' } };
/** Up to two actions. `primary` gives an action the accent fill on a default toast. */
export const WithActions: Story = {
  args: {
    actions: [
      { label: 'Undo', run: () => undefined },
      { label: 'View', run: () => undefined, primary: true },
    ],
  },
};

/** The five library examples as the bottom-right stack the service builds: 12px apart, newest on top, each as wide as its content. */
export const Stack: Story = {
  render: () => ({
    template: `
      <div class="flex flex-col items-end gap-[12px]" aria-live="polite">
        <lfx-ui-toast [duration]="0" [actions]="[{ label: 'Undo', run: noop }, { label: 'View', run: noop, primary: true }]">Committee created.</lfx-ui-toast>
        <lfx-ui-toast [duration]="0">Copied lfx.dev/k8s to clipboard.</lfx-ui-toast>
        <lfx-ui-toast [duration]="0" variant="success">Membership renewed through Dec 31, 2027.</lfx-ui-toast>
        <lfx-ui-toast [duration]="0" variant="warning">You're offline. Changes will sync when you reconnect.</lfx-ui-toast>
        <lfx-ui-toast [duration]="0" variant="error" [actions]="[{ label: 'Retry', run: noop }]">Couldn't send the invite. Try again.</lfx-ui-toast>
      </div>`,
    props: { noop: () => undefined },
    moduleMetadata: { imports: [UiToastComponent] },
  }),
};

/** Width follows the content up to 420px, then the message wraps; an error keeps its close button at any width. */
export const Width: Story = {
  render: () => ({
    template: `
      <div class="flex flex-col items-center gap-[12px]">
        <lfx-ui-toast [duration]="0" variant="dark">Saved</lfx-ui-toast>
        <lfx-ui-toast [duration]="0">Copied lfx.dev/k8s to clipboard.</lfx-ui-toast>
        <lfx-ui-toast [duration]="0" variant="error" [actions]="[{ label: 'Retry', run: noop }]">
          Couldn't send the invite to the Technical Steering Committee members. Check your connection and try again.
        </lfx-ui-toast>
      </div>`,
    props: { noop: () => undefined },
    moduleMetadata: { imports: [UiToastComponent] },
  }),
};

/** Toasts from `UiToastService`: bottom-right stack, auto-dismiss after 5s (8s with actions, never for errors), paused by hover and focus; dark toasts sit bottom-centre for 3s. */
export const FromService: Story = {
  render: () => ({
    props: {
      entries: [
        { label: 'message', config: { message: 'Copied lfx.dev/k8s to clipboard.' } },
        {
          label: 'actions',
          config: {
            message: 'Committee created.',
            actions: [
              { label: 'Undo', run: () => undefined },
              { label: 'View', run: () => undefined, primary: true },
            ],
          },
        },
        { label: 'success', config: { message: 'Membership renewed through Dec 31, 2027.', variant: 'success' } },
        { label: 'warning', config: { message: "You're offline. Changes will sync when you reconnect.", variant: 'warning' } },
        {
          label: 'error',
          config: { message: "Couldn't send the invite. Try again.", variant: 'error', actions: [{ label: 'Retry', run: () => undefined }] },
        },
        { label: 'dark', config: { message: 'Meeting Link Copied', variant: 'dark' } },
        {
          label: 'long',
          config: { message: 'Meeting details saved. Invitations to all 48 committee members go out within the next few minutes.', position: 'bottom-center' },
        },
      ],
    },
    template: `
      <div class="flex flex-wrap gap-[8px]">
        @for (entry of entries; track entry.label) {
          <lfx-ui-button variant="secondary" [lfxStoryShowsToast]="entry.config">{{ entry.label }}</lfx-ui-button>
        }
        <lfx-ui-button variant="tertiary" [lfxStoryShowsToast]="null">dismiss all</lfx-ui-button>
      </div>`,
  }),
};
