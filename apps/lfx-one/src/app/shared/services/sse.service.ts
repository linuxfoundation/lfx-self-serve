// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Injectable } from '@angular/core';
import { SSEConnectOptions, SSEEvent } from '@lfx-one/shared/interfaces';
import { Observable } from 'rxjs';

import type { Subscriber } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SseService {
  public connect<T extends string>(url: string, options?: SSEConnectOptions): Observable<SSEEvent<T>> {
    return new Observable((subscriber) => {
      const abortController = new AbortController();

      this.readStream<T>(url, options, subscriber, abortController).catch((err) => {
        if (err?.name !== 'AbortError') {
          subscriber.error(err);
        }
      });

      return () => abortController.abort();
    });
  }

  private async readStream<T extends string>(
    url: string,
    options: SSEConnectOptions | undefined,
    subscriber: Subscriber<SSEEvent<T>>,
    abortController: AbortController
  ): Promise<void> {
    const fetchOptions: RequestInit = {
      method: options?.method ?? 'POST',
      signal: abortController.signal,
      headers: {
        ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
        ...options?.headers,
      },
    };

    if (options?.body) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Request failed');
      subscriber.error(new Error(`SSE stream failed (${response.status}): ${errorText}`));
      return;
    }

    if (!response.body) {
      subscriber.error(new Error('No response body received'));
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const result = this.parseSSEBuffer<T>(buffer);
        buffer = result.remaining;

        for (const event of result.parsed) {
          subscriber.next(event);
        }
      }

      // Flush any remaining multibyte characters from the decoder
      buffer += decoder.decode();

      // Handle remaining buffer
      if (buffer.trim()) {
        const finalResult = this.parseSSEBuffer<T>(buffer + '\n\n');
        for (const event of finalResult.parsed) {
          subscriber.next(event);
        }
      }

      subscriber.complete();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      throw err;
    } finally {
      reader.cancel().catch(() => undefined);
    }
  }

  private parseSSEBuffer<T extends string>(buffer: string): { parsed: SSEEvent<T>[]; remaining: string } {
    const parsed: SSEEvent<T>[] = [];
    const blocks = buffer.split('\n\n');
    const remaining = blocks.pop() || '';

    for (const block of blocks) {
      if (!block.trim()) continue;

      let eventType = 'status' as T;
      let data: unknown = '';
      const dataLines: string[] = [];

      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim() as T;
        } else if (line.startsWith('data: ')) {
          dataLines.push(line.slice(6));
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5));
        }
      }

      if (dataLines.length > 0) {
        const raw = dataLines.join('\n');
        try {
          data = JSON.parse(raw);
        } catch {
          data = raw;
        }
      }

      if (data !== '' || eventType === ('done' as T)) {
        parsed.push({ type: eventType, data });
      }
    }

    return { parsed, remaining };
  }
}
