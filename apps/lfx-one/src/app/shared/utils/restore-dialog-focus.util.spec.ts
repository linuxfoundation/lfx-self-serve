// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { Subject } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';

import { restoreFocusOnDialogClose } from './restore-dialog-focus.util';

describe('restoreFocusOnDialogClose (#3260)', () => {
  const fakeRef = (): { ref: DynamicDialogRef; destroy: () => void } => {
    const onDestroy = new Subject<void>();
    return { ref: { onDestroy } as unknown as DynamicDialogRef, destroy: () => onDestroy.next() };
  };

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('returns focus to the trigger once the dialog is destroyed', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    const { ref, destroy } = fakeRef();

    restoreFocusOnDialogClose(ref, trigger);
    expect(document.activeElement).not.toBe(trigger);

    destroy();
    expect(document.activeElement).toBe(trigger);
  });

  it('leaves focus alone when the trigger has left the page', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    const { ref, destroy } = fakeRef();

    restoreFocusOnDialogClose(ref, trigger);
    trigger.remove();
    destroy();

    expect(document.activeElement).toBe(document.body);
  });

  it('does nothing without a ref or an element trigger', () => {
    expect(() => restoreFocusOnDialogClose(null, document.createElement('button'))).not.toThrow();
    expect(() => restoreFocusOnDialogClose(fakeRef().ref, null)).not.toThrow();
  });
});
