---
title: Mentions Feed
description: How to search, filter, and manage individual brand mentions in the Social Listening feed in LFX Self Serve.
audience: [executive-director]
product_area: Social Listening
tags: [social listening, mentions, feed, filters, search, bookmarks, read state]
last_updated: 2026-08-31
intercom_collection: Social Listening
---

This article applies to users with the **executive-director** persona and to **LF Staff**. The **Feed** tab is the default view of the Social Listening page — a running list of individual mentions that match your current scope and filters.

## Search mentions

1. Open **Social Listening** from the **Metrics** section of the left navigation in the **Foundation** lens.
2. Type at least 3 characters into the **Search mentions...** box.
3. The feed updates automatically, about half a second after you stop typing.

Clear the search box to return to the unfiltered feed.

## Set the scope

Three selectors at the top of the page control which mentions the feed contains:

- **Project** — every project in the foundation (**All Projects**, the default) or a single project. If your foundation has exactly one project, its name appears as a fixed label instead of a selector.
- **Platform** — every platform (**All Platforms**, the default) or a single platform.
- **Period** — **Year to Date**, **Last 3 months**, **Last 6 months**, or any individual recent month.

## Filter the feed

Select the filters button (the sliders icon) to open the **FILTERS** panel. A badge on the button shows how many filters are currently active. Nine filters are available:

- **Sentiment** — All, Positive, Neutral, or Negative
- **Relevance** — All, High, or Low
- **Language** — the language the mention was written in
- **Has Title** — All, Yes, or No
- **Bookmarked** — All, or only mentions you have bookmarked
- **Read Status** — All, or Unread only
- **Authors** — one or more specific authors
- **Keywords** — one or more specific keywords
- **Tags** — one or more specific tags

For **Authors**, **Keywords**, and **Tags** you can select up to 50 values per filter. Select **Clear all** at the top of the panel to reset every filter at once.

## Read a mention card

Each card in the feed shows one mention:

- A colored rail and icon on the left edge indicate the sentiment (green for Positive, amber for Neutral, red for Negative).
- The header line reads "Mention of **{project}** in **{platform}**", followed by the author's name — linked to their profile when available — and how long ago the mention was posted. Reddit mentions also link to the subreddit.
- The mention's title and body appear below; long bodies are truncated with a **Read full post** link.
- A **High Relevance** or **Low Relevance** chip and any tag chips appear at the bottom.
- When Octolens has enriched the mention, an expandable analysis appears beneath the chips.

## Act on a mention

Select anywhere on a card to open the original post in a new tab — this also marks the mention as read. Each card also has four action icons:

- **Forward by email** — opens your mail client with the mention contents pre-filled
- **Copy Link** — copies the URL of the original post
- **Mark as Read / Mark as Unread** — toggles the mention's read state
- **Bookmark** — saves the mention so you can find it later with the **Bookmarked** filter (up to 500 bookmarks per foundation)

Above the list, **Mark all as read** and **Mark all as unread** apply to every mention in the current scope. The **Data as of** timestamp next to them shows when the underlying data was last refreshed.

## Load more mentions

The feed loads mentions in batches. Select **Load more mentions** at the bottom to reveal the next batch, and the counter above the list ("20 of 312", for example) shows your position.

The feed renders at most 500 mentions at once. When you reach that limit a notice appears — "Showing the first 500 mentions" — and you can narrow the filters or shorten the period to see different mentions.

## Empty and error states

- **No mentions found** — nothing matches the current scope and filters. Try widening the period or clearing the search.
- **You're all caught up** — you are viewing unread mentions and none remain.
- **Couldn't load these mentions** — a batch failed to load; use the retry option to fetch it again.

## Related

- [Saved Views](../saved-views/) — save a filter combination and reuse or share it
- [Analytics](../analytics/) — charts and trends across your mentions
- [Social Listening FAQ](../faq/) — data sources, freshness, and limits
