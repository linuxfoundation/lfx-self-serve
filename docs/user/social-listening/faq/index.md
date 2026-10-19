---
title: Social Listening FAQ
description: Frequently asked questions about Social Listening access, data sources, freshness, and limits in LFX Self Serve.
display_order: 4
audience: [contributor, maintainer, board-member, executive-director]
product_area: Social Listening
tags: [social listening, faq, octolens, access, limits]
last_updated: 2026-10-14
intercom_collection: Social Listening
---

## Who can see Social Listening?

Social Listening is available to users with the **executive-director** persona and to **LF Staff**. Members of a foundation's own groups (not its projects' groups) can also see it for that foundation when their group's **Members Can View Social Listening** setting is on. The setting is off by default, and anyone who can manage the group can turn it on in the group's **Settings** tab. Group members see the whole foundation and can filter by project. It appears in the **Foundation** lens only.

## Why don't I see Social Listening in the navigation?

Check two things:

1. You are viewing a **Foundation** lens — switch lenses using the lens switcher.
2. Look under **Metrics** in the left navigation sidebar — Social Listening sits alongside Health Metrics.

If you still don't see it, your account doesn't have the executive-director persona or LF Staff access for that foundation, or none of your groups on that foundation has turned on **Members Can View Social Listening**. Board members with access see Social Listening under **Metrics** on its own, without Health Metrics. Members of other groups with access don't get the Foundation lens; they open Social Listening by direct link (`/foundation/social-listening?project=<foundation-slug>`).

## Where does the data come from?

All mention data is provided by **Octolens** and consists exclusively of publicly available content sourced from third-party platforms across the web. The Linux Foundation does not independently collect, enrich, or modify this data.

## How fresh is the data?

The **Data as of** timestamp above the mentions feed shows when the underlying data was last refreshed. Mentions published after that time appear on the next refresh.

The five analytics panels read governed models refreshed hourly. **Analytics as of** shows when those values were computed. Immediately after a UTC month or year rollover, the newest period may not appear until the next hourly refresh, with up to five additional minutes for cached panel results to expire. Mentions by Tag continues to follow the feed's content filters.

## Which platforms are monitored?

Twitter / X, Bluesky, Reddit, YouTube, Facebook, Hacker News, DEV, Podcasts, GitHub, LinkedIn, and Other (publicly available sources that don't fit the other categories).

## Why do the numbers on the Campaign Impact tab differ from the Social Listening page?

The **Campaign Impact** page includes a social listening summary tab — KPI cards, a sentiment breakdown, and top mentions — but it queries its data separately from the standalone Social Listening page. The two views are computed differently and are not guaranteed to match; use the standalone page (`/foundation/social-listening`) for detailed exploration and the Campaign Impact tab for an at-a-glance summary alongside your other marketing metrics.

## Do my saved views and bookmarks carry over from PCC?

Yes. Self Serve reads the same saved data as PCC Social Listening, so your saved views, bookmarks, and read state are already here — nothing to migrate.

## What are the limits?

- **Saved views** — up to 50 per foundation, with names up to 50 characters
- **Bookmarks** — up to 500 bookmarked mentions per foundation
- **Filter selections** — up to 50 selected values per list filter (Authors, Keywords, Tags)
- **Feed size** — the feed renders up to 500 mentions at a time; narrow the filters or shorten the period to see more

## Can I see program-level social listening data in Campaign Impact?

Not yet. When a specific program is selected, the Campaign Impact social listening tab shows a notice — "Showing all programs — social listening data is not yet available at the program level" — and continues to display foundation-wide data.

## Related

- [Social Listening](../) — topic overview and key concepts
- [Mentions Feed](../mentions-feed/) — search, filters, and card actions
- [Analytics](../analytics/) — charts and PNG export
