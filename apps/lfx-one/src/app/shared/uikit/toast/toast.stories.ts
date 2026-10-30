// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Directive, inject, input } from '@angular/core';
import { UiToastConfig } from '@lfx-one/shared/interfaces';
import { argsToTemplate, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

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
  argTypes: { variant: { control: 'inline-radio', options: ['default', 'success', 'warning', 'error'] } },
  decorators: [moduleMetadata({ imports: [StoryShowsToastDirective] })],
  parameters: { layout: 'padded' },
  args: { variant: 'default', actions: [], duration: 0, dismissible: true },
  render: (args) => ({ props: args, template: `<lfx-ui-toast ${argsToTemplate(args)}>Committee created.</lfx-ui-toast>` }),
};
export default meta;
type Story = StoryObj<UiToastComponent>;

export const Default: Story = {};
export const Success: Story = { args: { variant: 'success' } };
export const Warning: Story = { args: { variant: 'warning' } };
/** An error is an alert and never dismisses itself; the dismiss button stays so it can be cleared. */
export const ErrorToast: Story = { args: { variant: 'error', actions: [{ label: 'Retry', run: () => undefined }] } };
/** Up to two actions. `primary` gives an action the accent fill on a default toast. */
export const WithActions: Story = {
  args: {
    actions: [
      { label: 'Undo', run: () => undefined },
      { label: 'View', run: () => undefined, primary: true },
    ],
  },
};
export const WithoutDismiss: Story = { args: { dismissible: false } };

/** The five library examples as the stack the service builds: 12px apart, newest on top. */
export const Stack: Story = {
  render: () => ({
    template: `
      <div class="flex flex-col gap-[12px]" aria-live="polite">
        <lfx-ui-toast [duration]="0" [actions]="[{ label: 'Undo', run: noop }, { label: 'View', run: noop, primary: true }]" [dismissible]="false">Committee created.</lfx-ui-toast>
        <lfx-ui-toast [duration]="0">Copied lfx.dev/k8s to clipboard.</lfx-ui-toast>
        <lfx-ui-toast [duration]="0" variant="success" [dismissible]="false">Membership renewed through Dec 31, 2027.</lfx-ui-toast>
        <lfx-ui-toast [duration]="0" variant="warning" [dismissible]="false">You're offline. Changes will sync when you reconnect.</lfx-ui-toast>
        <lfx-ui-toast [duration]="0" variant="error" [actions]="[{ label: 'Retry', run: noop }]" [dismissible]="false">Couldn't send the invite. Try again.</lfx-ui-toast>
      </div>`,
    props: { noop: () => undefined },
    moduleMetadata: { imports: [UiToastComponent] },
  }),
};

/** Toasts from `UiToastService`: bottom-right stack, auto-dismiss after 5s (8s with actions, never for errors), paused by hover and focus. */
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
      ],
    },
    template: `
      <div class="flex flex-wrap gap-[8px]">
        @for (entry of entries; track entry.label) {
          <button type="button" class="edge h-ui-small cursor-pointer rounded-[10px] bg-ui-background-100 px-[10px] button-14 text-ui-neutral-900 hover:bg-ui-neutral-alpha-100 focus-visible:shadow-focus focus-visible:outline-none" [lfxStoryShowsToast]="entry.config">{{ entry.label }}</button>
        }
        <button type="button" class="h-ui-small cursor-pointer rounded-[10px] px-[10px] button-14 text-ui-neutral-900 hover:bg-ui-neutral-alpha-100 focus-visible:shadow-focus focus-visible:outline-none" [lfxStoryShowsToast]="null">dismiss all</button>
      </div>`,
  }),
};
