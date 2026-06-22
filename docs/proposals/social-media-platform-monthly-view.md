# Data Requirement: SOCIAL_MEDIA_PLATFORM_MONTHLY Snowflake View

## Context

The LFX Marketing Impact dashboard has a **Social Accounts** tab that shows aggregate social media metrics (total followers, impressions, engagement rate, posts) with a per-platform breakdown table. The data comes from three existing Platinum views:

| View                              | Purpose                                                                | Temporal?                                                   |
| --------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| `SOCIAL_MEDIA_OVERVIEW`           | Aggregate KPIs (total followers, growth %)                             | No — latest snapshot                                        |
| `SOCIAL_MEDIA_PLATFORM_BREAKDOWN` | Per-platform snapshot (followers, impressions, engagements, posts_30d) | No — latest snapshot                                        |
| `SOCIAL_MEDIA_FOLLOWER_TREND`     | Monthly follower totals                                                | Yes — `SNAPSHOT_MONTH`, but aggregated across all platforms |

We need to add a **Monthly Growth Table** that shows per-platform, per-month metrics (matching the AAIF Growth Tracker spreadsheet format). None of the existing views provide per-platform monthly breakdowns.

## Requested View

**Name:** `ANALYTICS.PLATINUM_LFX_ONE.SOCIAL_MEDIA_PLATFORM_MONTHLY`

**Purpose:** Monthly time-series of social media metrics broken down by platform and foundation. Powers the "Monthly Growth" section of the Social Accounts tab, showing month-over-month trends per platform.

## Required Columns

| Column            | Type      | Description                                                                                                                                                                           |
| ----------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SNAPSHOT_MONTH`  | `DATE`    | First day of the month (e.g., `2026-01-01`, `2026-02-01`). Same convention as `SOCIAL_MEDIA_FOLLOWER_TREND`.                                                                          |
| `PLATFORM_NAME`   | `VARCHAR` | Platform identifier. Must match values in `SOCIAL_MEDIA_PLATFORM_BREAKDOWN.PLATFORM_NAME` (e.g., `LinkedIn`, `Twitter/X`, `YouTube`, `Facebook`, `Instagram`, `Bluesky`, `Mastodon`). |
| `FOUNDATION_SLUG` | `VARCHAR` | Foundation slug for filtering. Same convention as existing social media views.                                                                                                        |
| `FOLLOWERS`       | `NUMBER`  | Total followers/subscribers at end of month.                                                                                                                                          |
| `NEW_FOLLOWERS`   | `NUMBER`  | Net new followers gained during the month. Can be computed as `FOLLOWERS - LAG(FOLLOWERS)` over the platform+foundation partition if raw deltas aren't available.                     |
| `IMPRESSIONS`     | `NUMBER`  | Total impressions during the month.                                                                                                                                                   |
| `ENGAGEMENTS`     | `NUMBER`  | Total engagements during the month (likes, comments, shares, clicks). Raw count — the UI computes engagement rate as `ENGAGEMENTS / IMPRESSIONS * 100`.                               |
| `POSTS`           | `NUMBER`  | Total posts/videos published during the month.                                                                                                                                        |

## Filtering & Aggregation Contract

The UI queries this view the same way it queries existing social media views:

```sql
-- For a specific foundation:
SELECT *
FROM ANALYTICS.PLATINUM_LFX_ONE.SOCIAL_MEDIA_PLATFORM_MONTHLY
WHERE FOUNDATION_SLUG = 'linux-foundation'
  AND SNAPSHOT_MONTH >= '2026-01-01'
  AND SNAPSHOT_MONTH < '2027-01-01'
ORDER BY PLATFORM_NAME, SNAPSHOT_MONTH ASC;

-- For TLF (umbrella — all foundations aggregated):
SELECT
  SNAPSHOT_MONTH,
  PLATFORM_NAME,
  SUM(FOLLOWERS) AS FOLLOWERS,
  SUM(NEW_FOLLOWERS) AS NEW_FOLLOWERS,
  SUM(IMPRESSIONS) AS IMPRESSIONS,
  SUM(ENGAGEMENTS) AS ENGAGEMENTS,
  SUM(POSTS) AS POSTS
FROM ANALYTICS.PLATINUM_LFX_ONE.SOCIAL_MEDIA_PLATFORM_MONTHLY
GROUP BY SNAPSHOT_MONTH, PLATFORM_NAME
ORDER BY PLATFORM_NAME, SNAPSHOT_MONTH ASC;
```

The UI handles the `tlf` umbrella aggregation in app code (same pattern as existing social media queries — no foundation filter for TLF, `SUM()` + `GROUP BY` across all foundations).

## Data Expectations

- **Backfill:** At minimum from January 2026 forward. Older data (2025) is nice-to-have for year-over-year comparison but not required for launch.
- **Refresh cadence:** Monthly (end of each month or first few days of the following month). The data doesn't need to be real-time — a 1-3 day lag is acceptable.
- **Null handling:** Months with no data for a platform should either be absent (no row) or have `0` values. The UI handles both cases. Do NOT insert rows with `NULL` numeric values — use `0` if the platform existed but had no activity.
- **Platform consistency:** `PLATFORM_NAME` values must exactly match what's in `SOCIAL_MEDIA_PLATFORM_BREAKDOWN`. If a platform appears in the breakdown view, it should appear in the monthly view (and vice versa). This is critical for the UI to join/correlate data.
- **NEW_FOLLOWERS accuracy:** If raw follower-delta data isn't available from the source APIs, computing as `FOLLOWERS(month N) - FOLLOWERS(month N-1)` using a window function is acceptable. The first month of data can have `NEW_FOLLOWERS = 0` or `NULL` (UI shows "N/A" for the first month).

## Platforms to Include

All platforms currently in `SOCIAL_MEDIA_PLATFORM_BREAKDOWN`, which today includes:

- LinkedIn
- Twitter/X
- YouTube
- Facebook
- Instagram

Plus any additional platforms tracked for foundations (Bluesky, Mastodon are used by TLF — see `SOCIAL_MEDIA_PLATFORM_BREAKDOWN` for the authoritative list).

## How the UI Will Consume This

The Express backend will run a single query against this view and return the results grouped by platform:

```text
GET /api/analytics/social-media/monthly?foundationSlug=tlf&year=2026
```

Response shape the UI expects:

```json
{
  "year": 2026,
  "platforms": [
    {
      "platform": "LinkedIn",
      "months": [
        {
          "month": "2026-01",
          "followers": 1077,
          "newFollowers": 0,
          "impressions": 16886,
          "engagementRate": 5.2,
          "posts": 42,
          "momChangeFollowers": null
        },
        {
          "month": "2026-02",
          "followers": 2093,
          "newFollowers": 1008,
          "impressions": 24308,
          "engagementRate": 5.3,
          "posts": 58,
          "momChangeFollowers": 94.34
        }
      ]
    },
    {
      "platform": "YouTube",
      "months": [
        {
          "month": "2026-01",
          "followers": 7584,
          "newFollowers": 163,
          "impressions": 0,
          "engagementRate": 0,
          "posts": 12,
          "momChangeFollowers": null
        }
      ]
    }
  ]
}
```

The backend computes `engagementRate` (from `ENGAGEMENTS / IMPRESSIONS * 100`) and `momChangeFollowers` (from consecutive months' `FOLLOWERS` values) — these do NOT need to be in the Snowflake view.

## Relationship to Existing Views

This view complements (does not replace) the existing three views:

- `SOCIAL_MEDIA_OVERVIEW` — still used for aggregate KPI cards (snapshot)
- `SOCIAL_MEDIA_PLATFORM_BREAKDOWN` — still used for the platform summary table (snapshot)
- `SOCIAL_MEDIA_FOLLOWER_TREND` — still used for the aggregate follower sparkline (monthly, all platforms combined)
- **`SOCIAL_MEDIA_PLATFORM_MONTHLY` (new)** — used for the monthly growth table (monthly, per platform)

## Acceptance Criteria

1. View exists at `ANALYTICS.PLATINUM_LFX_ONE.SOCIAL_MEDIA_PLATFORM_MONTHLY`
2. Contains all columns listed above with correct types
3. Has data for at least January–May 2026 for TLF foundation
4. `PLATFORM_NAME` values match `SOCIAL_MEDIA_PLATFORM_BREAKDOWN` exactly
5. `FOUNDATION_SLUG` values match existing social media views exactly
6. Query returns results in under 3 seconds for a single foundation + full year
7. Numeric values are `0` (not `NULL`) for months where a platform had no activity

## Timeline

This view is a prerequisite for the "Social Accounts — Monthly Growth Table" UI work. The UI and backend code can be built in parallel (with mock data), but end-to-end testing requires the view to be live.
