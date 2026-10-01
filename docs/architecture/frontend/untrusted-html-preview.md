# Untrusted HTML Preview

How generated email HTML is previewed faithfully, and why that required the app's only unsanitized
`bypassSecurityTrustHtml`.

This documents `EmailBodyPreviewComponent`
(`apps/lfx-one/src/app/shared/components/email-body-preview/`), used at five sites in
`campaigns.component.html`. It is the one place in the app where Angular's HTML sanitizer is
deliberately bypassed without a prior `sanitize()` call, so the reasoning is recorded here rather
than only in the component.

## The problem the sanitizer caused

The campaign service generates marketing email bodies and styles them entirely with **inline**
`style` attributes — because most mail clients discard `<style>` blocks and external stylesheets,
inline is the only styling that survives delivery. The styler lives in the campaign service at
`internal/service/email_body_style.go` and applies the Linux Foundation palette and type scale to
every generated `rich_text` section.

Angular's default sanitizer, which `[innerHTML]` runs at `SecurityContext.HTML`, **strips `style`
attributes and `<style>` blocks**. So the previews showed the email's _structure_ with none of its
styling: correct markup, wrong colours, wrong type scale, wrong spacing. An operator approving a
send was approving a layout they had never actually seen, and the HubSpot draft was the only
faithful proof of what recipients would get.

The two requirements are mutually exclusive. The sanitizer cannot keep inline styles, so a faithful
preview cannot go through the sanitizer.

## Why an iframe, and why the bypass is required

The control moved from Angular's sanitizer to the **browser's iframe sandbox** — a stronger
boundary, not a weaker one.

The bypass is not an oversight and not avoidable. Angular registers `iframe|srcdoc` under
`SecurityContext.HTML`, so binding a plain string to `[srcdoc]` would be sanitized exactly as
`[innerHTML]` was, re-creating the problem. `bypassSecurityTrustHtml` is what makes `[srcdoc]` carry
the styles, and the sandbox is what replaces the sanitizer as the control.

### The sandbox is the whole control

```html
sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer"
```

Because the `sandbox` attribute omits both `allow-scripts` and `allow-same-origin`, the framed
document:

- **cannot execute script** — an `on*` handler, a `<script>` block or a `javascript:` href is inert
  whatever the HTML contains;
- **gets a unique opaque origin** — it cannot read this app's DOM, cookies, `localStorage` or
  session, and the app cannot read into it;
- **cannot submit a form**, autoplay media, or lock the pointer.

`allow-popups allow-popups-to-escape-sandbox` **is** granted, so a link opens the real site in a new
tab instead of silently doing nothing — checking that generated links point where they should is
most of the reason to open this preview. With scripts disabled a popup can only come from a
deliberate user click, and `-to-escape-sandbox` is what stops the opened page being a script-less
broken rendering of the destination site.

`referrerpolicy="no-referrer"` keeps this app's URL — which carries the project and brief ids — out
of the `Referer` header of any request the frame makes.

### Two tokens that must never be added

- **`allow-scripts`** would turn the frame into an arbitrary-script-execution sink for
  model-authored content derived from scraped third-party event pages.
- **`allow-same-origin`** alongside it is worse: together the two let the framed document remove its
  own `sandbox` attribute.

`email-body-preview.component.spec.ts` asserts the exact sandbox string and asserts the absence of
both tokens, so this cannot regress silently in CI. It may not run for you locally: vitest needs
Node >= 22.19 here, because `jsdom@30` pulls an `undici` that calls
`worker_threads.markAsUncloneable`, and a Node 20 machine cannot run the suite at all. That is a
machine constraint, not repo policy — `yarn test` is an ordinary local command on a supported Node.

## The second of two controls — except where it is the only one

For **generated** copy, server-side sanitization happens first and is unchanged. The campaign
service's `styleEmailBodyHTML` drops every attribute the model wrote, every tag outside its
allowlist, and the content of `<script>` and `<style>`. For those bindings the sandbox is defence in
depth rather than the only barrier.

For the **A/B variant-B body** it is the only barrier. That string comes from an operator textarea
(`onAbTestBodyHtmlBInput` in `campaigns.component.ts`) and is framed without ever being sent to
campaign-service, so no server-side pass has run on it. Of the five bindings of
`lfx-email-body-preview` in `campaigns.component.html`, two are that signal. Anyone weakening the
sandbox on the assumption that the server already sanitized the string is wrong for those two.

The content is **not** purely first-party: the model is fed scraped third-party event-page HTML, so
it must be treated as untrusted even though the service generated the final string.

## Accepted limitations

- **The frame height is fixed** (`heightPx`, default 420) and content taller than it scrolls.
  Auto-sizing an iframe to its content requires either reading `contentDocument`
  (needs `allow-same-origin`) or a script inside the frame posting its height (needs
  `allow-scripts`) — both are exactly the grants that make the sandbox meaningless. A fixed height
  with an honest scrollbar is the price of the sandbox.
- **Merge tags render as their literal `{{...}}` source.** Only HubSpot resolves those, so the
  HubSpot draft remains the proof for _personalisation_ specifically — it is no longer needed to
  prove _layout_.

## When to reuse this pattern

Reach for a sandboxed frame only when **both** hold:

1. the content's own inline styling or layout is the thing being shown, so sanitizing it defeats the
   purpose; and
2. the content needs no scripting and no access to the host page.

If the content is plain prose and only needs links made clickable, use the `linkify` pipe instead
(`apps/lfx-one/src/app/shared/pipes/linkify.pipe.ts`) — it sanitizes first and then bypasses, which
is the safer pattern and the right default. This component is the exception, not the example.
