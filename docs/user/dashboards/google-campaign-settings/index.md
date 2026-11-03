---
title: Google campaign settings
description: Set an ad schedule and device bid adjustments for a Google Ads campaign on the Campaigns page's Implement tab.
audience: [executive-director]
product_area: Dashboards
tags: [campaigns, paid marketing, google ads, ad schedule, devices, bid adjustment, implement]
last_updated: 2026-11-03
intercom_collection: Dashboards
---

When you create a Google Ads campaign from the **Campaigns** page in the Foundation lens, the **Implement** tab lets you limit when the campaign runs and change how much it bids on each device. Both settings are optional. If you leave them alone, the campaign serves all day, every day, at the same bid on every device, which is Google's default.

## Where to find them

1. Open **Campaigns** in the Foundation lens and choose **Paid Marketing**.
2. Open the **Implement** tab for a brief that includes Google Ads.
3. Tick a campaign type, such as **Search Campaign**. The **Ad schedule** and **Devices** sections appear below the language settings when the type supports them.

| Campaign type   | Ad schedule | Devices |
| --------------- | ----------- | ------- |
| Search          | Yes         | Yes     |
| Display         | Yes         | Yes     |
| Performance Max | Yes         | No      |
| Demand Gen      | No          | No      |

## Ad schedule

Add a window for each day and time range the campaign should run. Each window has a day, a **From** time, a **To** time and an optional **Bid adjustment (%)**.

- Times are in quarter hours, in the Google Ads account's time zone. Choose **24:00** as the **To** time to run until midnight.
- **Add window** adds an all-day window on the first day of the week (from Monday) that has none yet, so seven clicks give you every day of the week.
- A bid adjustment runs from -90% to +900%. Enter -100% to stop the campaign serving in that window. Leave the box blank for no adjustment.
- You can add up to 42 windows, and at most 6 on any one day.
- Windows on the same day cannot overlap. Windows that only touch are fine, so 09:00–12:00 and 12:00–17:00 can both be listed.

## Devices

For **Mobile phones**, **Computers** and **Tablets**, choose one of:

- **Default bid**: no change.
- **Adjust bid**: enter a percentage from -90% to +900%.
- **Exclude**: the campaign does not serve on that device.

Smart Bidding strategies, such as Maximize conversions, ignore device bid adjustments but still honour an exclusion.

## If something is wrong

If a window or adjustment would be refused by Google Ads, a message appears under the section and **Create Campaign** stays unavailable until you fix it. Messages give Google's bid modifier rather than a percentage: -20% is a bid modifier of 0.8, and +50% is 1.5.

If you switch to a campaign type that does not take one of these settings, the section disappears and a notice tells you that your windows or device settings will not be sent. They are kept, so switching back restores them.
