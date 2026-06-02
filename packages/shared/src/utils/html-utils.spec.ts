// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { htmlClipboardToText, stripHtml } from './html-utils';

describe('stripHtml', () => {
  it('removes tags and decodes entities', () => {
    expect(stripHtml('<p>Hello &amp; <strong>World</strong></p>')).toBe('Hello & World');
  });

  it('returns empty string for null / undefined / empty', () => {
    expect(stripHtml(null)).toBe('');
    expect(stripHtml(undefined)).toBe('');
    expect(stripHtml('')).toBe('');
  });
});

describe('htmlClipboardToText', () => {
  it('returns empty string for null / undefined / empty', () => {
    expect(htmlClipboardToText(null)).toBe('');
    expect(htmlClipboardToText(undefined)).toBe('');
    expect(htmlClipboardToText('')).toBe('');
  });

  it('converts an anchor with distinct text to Markdown', () => {
    expect(htmlClipboardToText('<a href="https://docs.example.com/guide">contributor guide</a>')).toBe('[contributor guide](https://docs.example.com/guide)');
  });

  it('renders a bare URL when the anchor text equals the href', () => {
    expect(htmlClipboardToText('<a href="https://x.com">https://x.com</a>')).toBe('https://x.com');
  });

  it('uses just the text when the anchor has no href', () => {
    expect(htmlClipboardToText('<a>no href here</a>')).toBe('no href here');
  });

  it('uses just the text when the href is empty', () => {
    expect(htmlClipboardToText('<a href="">link text</a>')).toBe('link text');
  });

  it('preserves multiple anchors in one block', () => {
    const html = '<p>See <a href="https://a.com">A</a> and <a href="https://b.com">B</a>.</p>';
    expect(htmlClipboardToText(html)).toBe('See [A](https://a.com) and [B](https://b.com).');
  });

  it('strips nested formatting inside anchor text', () => {
    expect(htmlClipboardToText('<a href="https://x.com"><strong>bold</strong> link</a>')).toBe('[bold link](https://x.com)');
  });

  it('handles single-quoted href values', () => {
    expect(htmlClipboardToText("<a href='https://x.com'>x</a>")).toBe('[x](https://x.com)');
  });

  it('still finds the href when other attributes come first', () => {
    expect(htmlClipboardToText('<a class="link" data-foo="bar" href="https://x.com">x</a>')).toBe('[x](https://x.com)');
  });

  it('decodes entities in plain text', () => {
    expect(htmlClipboardToText('cats &amp; dogs')).toBe('cats & dogs');
  });

  it('decodes entities inside anchor text', () => {
    expect(htmlClipboardToText('<a href="https://x.com">cats &amp; dogs</a>')).toBe('[cats & dogs](https://x.com)');
  });

  it('turns block boundaries into newlines', () => {
    expect(htmlClipboardToText('<p>Hello</p><p>World</p>')).toBe('Hello\nWorld');
  });

  it('turns <br> into a newline', () => {
    expect(htmlClipboardToText('Line 1<br>Line 2<br/>Line 3')).toBe('Line 1\nLine 2\nLine 3');
  });

  it('preserves list-item line breaks', () => {
    const html = '<ul><li>First item with <a href="https://a.com">A</a></li><li>Second item</li></ul>';
    expect(htmlClipboardToText(html)).toBe('First item with [A](https://a.com)\nSecond item');
  });

  it('collapses runs of 3+ newlines to 2', () => {
    expect(htmlClipboardToText('<p>A</p><br><br><br><br><p>B</p>')).toBe('A\n\nB');
  });

  it('strips remaining tags but keeps surrounding text', () => {
    expect(htmlClipboardToText('<span style="color:red">red text</span>')).toBe('red text');
  });

  it('handles a Notion-style mixed paragraph with a link and inline formatting', () => {
    const html = '<p>Check out the <a href="https://example.com/post">new post</a> — <strong>big</strong> update!</p>';
    expect(htmlClipboardToText(html)).toBe('Check out the [new post](https://example.com/post) — big update!');
  });
});
