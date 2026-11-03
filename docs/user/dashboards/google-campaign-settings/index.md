---
title: Google campaign settings
description: Set an ad schedule, device bid adjustments, demographic exclusions and excluded locations for a Google Ads campaign on the Campaigns page's Implement tab.
audience: [executive-director]
product_area: Dashboards
tags: [campaigns, paid marketing, google ads, ad schedule, devices, bid adjustment, demographics, excluded locations, implement]
last_updated: 2026-11-04
intercom_collection: Dashboards
---

When you create a Google Ads campaign from the **Campaigns** page in the Foundation lens, the **Implement** tab lets you limit when the campaign runs, change how much it bids on each device, and keep it from serving to some age ranges, genders or places. Every setting is optional. If you leave them alone, the campaign serves all day, every day, at the same bid on every device, to every age and gender, everywhere it targets, which is Google's default.

## Where to find them

1. Open **Campaigns** in the Foundation lens and choose **Paid Marketing**.
2. Open the **Implement** tab for a brief that includes Google Ads.
3. Tick a campaign type, such as **Search Campaign**. The **Ad schedule** and **Devices** sections appear below the language settings when the type supports them, followed by **Demographic exclusions** and **Excluded locations**.

| Campaign type   | Ad schedule | Devices                     | Demographic exclusions | Excluded locations |
| --------------- | ----------- | --------------------------- | ---------------------- | ------------------ |
| Search          | Yes         | Yes, adjust with Manual CPC | Yes                    | Yes                |
| Display         | Yes         | Exclude only                | Yes                    | Yes                |
| Performance Max | Yes         | No                          | No                     | Yes                |
| Demand Gen      | No          | No                          | No                     | Yes                |

## Ad schedule

Add a window for each day and time range the campaign should run. Each window has a day, a **From** time, a **To** time and an optional **Bid adjustment (%)**.

- Times are in quarter hours, in the Google Ads account's time zone. **From** runs from 00:00 to 23:45 and **To** from 01:00 to 24:00. Choose **24:00** as the **To** time to run until midnight.
- **Add window** adds an all-day window on the first day of the week (from Monday) that has none yet, so seven clicks give you every day of the week. Once every day has a window, it fills the first free time left in the week, for example the morning of a day you set to start at 09:00. It never adds a window that overlaps one you already have: when there is no free time left, it is unavailable and says why. The reason names any day that already has 6 windows, and any day whose only free time ends before 01:00, since Google Ads cannot end a window that early.
- A bid adjustment runs from -90% to +900%. Enter -100% to stop the campaign serving in that window. Leave the box blank for no adjustment.
- You can add up to 42 windows, and at most 6 on any one day.
- Windows on the same day cannot overlap. Windows that only touch are fine, so 09:00–12:00 and 12:00–17:00 can both be listed.

## Devices

For **Mobile phones**, **Computers** and **Tablets**, choose one of:

- **Default bid**: no change.
- **Adjust bid**: enter a percentage from -90% to +900%. Only offered when the bidding strategy is **Manual CPC**.
- **Exclude**: the campaign does not serve on that device. Works with every bidding strategy.

Google Ads uses device bid adjustments only with **Manual CPC**. Under any other strategy, such as Maximize Conversions, Google ignores them, so LFX One won't create the campaign with one, even at 0%. Search campaigns use Manual CPC unless you pick another strategy. Display campaigns cannot use Manual CPC here, so on Display you can only keep the default bid or exclude a device. The **Devices** section says which strategy is in force when **Adjust bid** is not offered.

If you set an adjustment under Manual CPC and then switch to another strategy, the adjustment is kept for a switch back and a notice says so. **Create Campaign** stays unavailable until you set that device to **Default bid** or **Exclude**, or choose Manual CPC again.

## Demographic exclusions

Tick an age range (18 to 24, 25 to 34, 35 to 44, 45 to 54, 55 to 64, 65 or more) or a gender (Male, Female) to stop the campaign serving to it. **Unknown**, in both lists, is the people Google could not classify. With nothing ticked, the campaign serves to everyone.

## Excluded locations

The campaign does not serve in the places listed here.

- Pick countries from the **Countries** list. It offers the same countries as the targeted country list.
- To exclude a city, region, metro or postal code, type its numeric Google geo target id in **Geo target id** and choose **Exclude**.
- Each excluded place shows as a chip. Select its **×** to remove it.
- You can exclude up to 60 places. This limit is separate from the 60 places you can target.
- A place cannot be both targeted and excluded, even when the two are written differently, such as `US` and its id `2840`. If you have added no target country, postal code or radius, the campaign targets the event country, so you cannot exclude that country either.

## If something is wrong

If a window, adjustment, exclusion or excluded place would be refused by Google Ads, a message appears under the section and **Create Campaign** stays unavailable until you fix it. Messages give Google's bid modifier rather than a percentage: -20% is a bid modifier of 0.8, and +50% is 1.5.

If you switch to a campaign type that does not take one of these settings, the section disappears and a notice tells you that your windows, device settings or demographic exclusions will not be sent. They are kept, so switching back restores them. Excluded locations are sent for every campaign type.
