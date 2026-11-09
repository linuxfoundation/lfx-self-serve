---
title: Google campaign settings
description: Set an ad schedule, device bid adjustments, Demand Gen bidding and languages, sitelinks, demographic exclusions, excluded locations, Display placement exclusions, conversion actions, audience segments, Search partners, display paths, more ads, negative keywords, a Demand Gen video ad, several Demand Gen ads, named Demand Gen and Display ad groups, Demand Gen audiences and Performance Max search themes, ad extensions and device exclusions for a Google Ads campaign on the Campaigns page's Implement tab.
audience: [executive-director]
product_area: Dashboards
tags:
  [
    campaigns,
    paid marketing,
    google ads,
    ad schedule,
    devices,
    bid adjustment,
    demographics,
    excluded locations,
    placement exclusions,
    display path,
    responsive search ads,
    negative keywords,
    search partners,
    conversion actions,
    audience segments,
    demand gen,
    bidding,
    languages,
    sitelinks,
    ad extensions,
    youtube,
    video ads,
    ad groups,
    audiences,
    performance max,
    search themes,
    implement,
  ]
last_updated: 2026-11-09
intercom_collection: Dashboards
---

When you create a Google Ads campaign from the **Campaigns** page in the Foundation lens, the **Implement** tab lets you limit when the campaign runs, change how much it bids on each device, and keep it from serving to some age ranges, genders or places. It also lets you pick the conversion actions the campaign counts. On a Search campaign it also lets you add Google's search partners, set the ad's display path, add up to two more ads, and add negative keywords. Every setting is optional. If you leave them alone, the campaign serves all day, every day, at the same bid on every device, to every age and gender, everywhere it targets, which is Google's default, on Google Search only, with one ad and no negative keywords beyond any filled in from the brief.

## Where to find them

1. Open **Campaigns** in the Foundation lens and choose **Paid Marketing**.
2. Open the **Implement** tab for a brief that includes Google Ads.
3. Tick a campaign type, such as **Search Campaign**. The **Ad schedule** and **Devices** sections appear below the language settings when the type supports them, followed by **Demographic exclusions** and **Excluded locations**. On Search, **Networks**, **Display path**, **More ads** and **Negative keywords** appear below **Headlines** and **Descriptions**.

| Campaign type   | Ad schedule                                    | Devices                       | Demographic exclusions | Excluded locations |
| --------------- | ---------------------------------------------- | ----------------------------- | ---------------------- | ------------------ |
| Search          | Yes, adjust with Manual CPC or Maximize Clicks | Yes, adjust with Manual CPC   | Yes                    | Yes                |
| Display         | Yes, adjust with Maximize Clicks               | Exclude only                  | Yes                    | Yes                |
| Performance Max | Windows only                                   | Exclude only, with TV screens | No                     | Yes                |
| Demand Gen      | Windows only                                   | Exclude only, with TV screens | No                     | Yes                |

## Ad schedule

Add a window for each day and time range the campaign should run. Each window has a day, a **From** time, a **To** time and an optional **Bid adjustment (%)**.

- Times are in quarter hours, in the Google Ads account's time zone. **From** runs from 00:00 to 23:45 and **To** from 01:00 to 24:00. Choose **24:00** as the **To** time to run until midnight.
- **Add window** adds an all-day window on the first day of the week (from Monday) that has none yet, so seven clicks give you every day of the week. Once every day has a window, it fills the first free time left in the week, for example the morning of a day you set to start at 09:00. It never adds a window that overlaps one you already have: when there is no free time left, it is unavailable and says why. The reason names any day that already has 6 windows, and any day whose only free time ends before 01:00, since Google Ads cannot end a window that early.
- A bid adjustment runs from -90% to +900%. Leave the box blank for no adjustment. Google Ads does not accept -100% on a window, so to stop the campaign serving at a time, leave that time out of the schedule: once you add windows, the campaign serves only in them.
- You can add up to 42 windows, and at most 6 on any one day.
- Windows on the same day cannot overlap. Windows that only touch are fine, so 09:00–12:00 and 12:00–17:00 can both be listed.

Google Ads uses ad schedule bid adjustments only with **Manual CPC** or **Maximize Clicks**, where the campaign type offers them. Under Maximize Conversions, Target CPA, Maximize Conversion Value or Target ROAS, Google ignores them, so LFX One won't create the campaign with one, even at 0%. Your windows still decide when the campaign serves under every strategy; only the **Bid adjustment (%)** box goes away, and the **Ad schedule** section says which strategy is in force. Display campaigns can adjust windows with Maximize Clicks. Performance Max campaigns cannot use either strategy here, so they take windows without adjustments. Demand Gen campaigns take windows without adjustments under every strategy, Maximize Clicks included, and the **Ad schedule** section says so.

If you set an adjustment and then switch to a strategy that ignores it, the adjustment is kept for a switch back, shown read-only, and a notice says so. **Create Campaign** stays unavailable until you select **Clear adjustment** on that window, or choose Manual CPC or Maximize Clicks. If you switch to Demand Gen instead, the same happens, and only **Clear adjustment** lets you create the campaign there.

## Devices

For **Mobile phones**, **Computers** and **Tablets**, and **TV screens** on Demand Gen and Performance Max, choose one of:

- **Default bid**: no change.
- **Adjust bid**: enter a percentage from -90% to +900%. Only offered when the bidding strategy is **Manual CPC**.
- **Exclude**: the campaign does not serve on that device. Works with every bidding strategy.

LFX One sends device bid adjustments only with **Manual CPC**, and won't create the campaign with one under any other strategy, even at 0%. Under Maximize Conversions, Maximize Conversion Value or Target ROAS, Google Ads doesn't apply device bid adjustments, except excluding a device. Under Target CPA, Google Ads would apply one as an adjustment to that device's target CPA, and under Maximize Clicks it would apply one to the bid, but LFX One doesn't send them there. Search campaigns use Manual CPC unless you pick another strategy. Display campaigns cannot use Manual CPC here, so on Display you can only keep the default bid or exclude a device. The **Devices** section says which strategy is in force when **Adjust bid** is not offered.

Demand Gen and Performance Max campaigns take a device only as an exclusion, under every strategy, so on those two you can only keep the default bid or exclude a device. They are also the only campaign types that offer **TV screens**. If you exclude TV screens and then switch to Search or Display, the exclusion is kept for a switch back and a notice says it will not be sent.

On Performance Max, keep at least one device: a campaign that excludes all four could not serve anywhere, so a message appears under **Devices** and **Create Campaign** stays unavailable until you set one of them back to **Default bid**.

If you set an adjustment under Manual CPC and then switch to another strategy, the adjustment is kept for a switch back and a notice says so. **Create Campaign** stays unavailable until you set that device to **Default bid** or **Exclude**, or choose Manual CPC again. If you switch to Demand Gen or Performance Max instead, the same happens, and only **Default bid** or **Exclude** lets you create the campaign there.

## Demographic exclusions

Tick an age range (18 to 24, 25 to 34, 35 to 44, 45 to 54, 55 to 64, 65 or more) or a gender (Male, Female) to stop the campaign serving to it. **Unknown**, in both lists, is the people Google could not classify. With nothing ticked, the campaign serves to everyone.

## Excluded locations

The campaign does not serve in the places listed here.

- Pick countries from the **Countries** list. It offers the same countries as the targeted country list.
- To exclude a city, region, metro or postal code, type its numeric Google geo target id in **Geo target id** and choose **Exclude**.
- Each excluded place shows as a chip. Select its **×** to remove it.
- You can exclude up to 500 places. This limit is separate from the 500 places you can target.
- A place cannot be both targeted and excluded, even when the two are written differently, such as `US` and its id `2840`. If you have added no target country, postal code or radius, the campaign targets the event country, so you cannot exclude that country either.

## Placement exclusions (Display only)

On a Display campaign, a **Placement exclusions** box appears below **Excluded locations**. List the websites the campaign's ads must never appear on, one per line.

- Enter each website as a bare domain, such as `example.com` or `news.example.com`. Leave out `https://`, any path such as `/news`, and any port. LFX One does not strip them for you; it holds **Create Campaign** and says which entry to fix.
- Write an international domain in its `xn--` form.
- You can list up to 500 websites. Blank lines are ignored, and a website listed twice, even in different capitals, is excluded once.
- `example.com` and `www.example.com` are sent as written. Neither is turned into the other, so list both if you mean both.

The exclusions cover the whole campaign. If you switch to another campaign type, the box disappears and a notice says the websites you entered will not be sent. They are kept, so switching back to Display restores them.

## Demand Gen bidding and languages

A Demand Gen campaign can bid with **Maximize Clicks**, the default, or with **Maximize Conversions**, **Target CPA** or **Maximize Conversion Value**. Target CPA needs a **Target CPA** in the account currency, and Maximize Conversions takes one optionally. Target ROAS is not offered on Demand Gen, and neither is the **Target ROAS** box under Maximize Conversion Value: LFX One's campaign service does not send a target ROAS on Demand Gen. A target ROAS you entered on another campaign type is kept but not sent.

Under a conversion strategy, a Demand Gen campaign bids toward the [conversion actions](#conversion-actions) you pick, or toward the account's own conversion goals if you leave them blank.

You can also pick the languages a Demand Gen campaign serves in, as on the other campaign types. With none picked, it serves in every language.

## Sitelinks and other ad extensions

Ad extensions add links and details to your ads. Which ones a campaign takes depends on its type:

| Campaign type   | Sitelinks | Callouts and structured snippets | Call extensions, promotions and prices |
| --------------- | --------- | -------------------------------- | -------------------------------------- |
| Search          | Yes       | Yes                              | Yes                                    |
| Performance Max | Yes       | Yes                              | No                                     |
| Demand Gen      | Yes       | No                               | No                                     |
| Display         | No        | No                               | No                                     |

**Google Sitelinks** add extra links to the ad. For each sitelink, enter the **Link text** and the **Destination URL**, and optionally two description lines, then select **+ Add sitelink**.

- You can add up to 20 sitelinks.
- Link text can be up to 25 characters. Two sitelinks cannot have the same link text, even in different capitals.
- Fill in both description lines or neither. Each can be up to 35 characters.
- The destination must be a full `http://` or `https://` address with no embedded user name or password, up to 2,084 bytes.

When it creates the campaign, LFX One's campaign service adds the campaign's tracking parameters to each sitelink destination, as it does to the ad's own link, so you don't need to add them yourself.

On a Performance Max campaign, **Google Sitelinks**, **Google Callouts** and **Google Structured Snippets** appear, with the same limits as on Search, and apply to the whole campaign. Call extensions, promotions and prices you entered on a Search campaign are kept but not sent on Performance Max, and a notice says to switch back to Search to keep them.

On a Demand Gen campaign, **Google Sitelinks** is the only ad extension section that appears. If you entered callouts, structured snippets, call extensions, promotions or prices on a Search campaign and then switch to Demand Gen, they are kept but not sent, and a notice says so. On Display, sitelinks are kept but not sent too, and a notice says to switch to Search, Demand Gen or Performance Max to keep them.

## Conversion actions

On Search, Display and Demand Gen campaigns, the bidding settings include **Conversion Actions**: the conversions the campaign counts. Under a conversion bidding strategy, such as **Maximize Conversions**, the campaign also bids toward them. Leave it blank to use the Google Ads account's own conversion goals.

Performance Max campaigns do not offer **Conversion Actions** here, and use the account's own conversion goals.

- **Pick conversion actions** lists the account's enabled conversion actions, each with its category. **Primary** marks one that counts toward the account's conversions by default. Picking one adds its id to the **Conversion Actions** box.
- Only the LF marketing team sees the list. Every foundation shares one Google Ads account, so the list names every foundation's conversion actions. Everyone else types ids into the box.
- You can still type ids into the box, one per line, as an id such as 987654321 or a full `customers/<id>/conversionActions/<id>` name. Picking keeps the ids you typed.
- If the list cannot be shown, a note above the **Conversion Actions** box says why: your account cannot read it, it is not available here yet, or it could not be read for this project's Google Ads account. Type the ids instead.
- If the account has no enabled conversion actions, a note says so. Type ids, or leave the box blank to use the account's own goals.

## Audience segments (Search only)

Search campaigns can watch how existing Google Ads audiences perform, such as your customer lists and website visitor lists. The **Google Audience Segments** section appears only for the LF marketing team, because every foundation shares one Google Ads account.

The lists apply to the whole campaign, including any ad group added later, for example from **Optimize**. They only observe: Google reports on them without narrowing who sees the ads.

- **Pick a user list** lists the account's user lists. Type part of a name to narrow the list, then choose one to add it. Each entry shows the list's type, such as **Customer list** or **Website visitors**, and says when Google reports that it is not eligible for Search.
- A list you have added is not offered again. You can still type a list's full name, such as `customers/<id>/userLists/<id>`, into the box below the picker, for a list the picker does not show.
- If the list cannot be shown, a note in the section says why: it is not available here, or it could not be read for this project's Google Ads account. Type the list names instead.
- If the account has more user lists than the picker shows, a note says so. Type the name of any list that is not listed.
- A list id must be written as Google Ads shows it, a positive number with no leading zeros. If a saved brief holds a list written another way, a message in the section names it and **Create Campaign** stays unavailable until you remove it.
- You can add up to 20 lists. Each must belong to the campaign's own Google Ads account. A list from another account is refused when you create the campaign, and the Google Ads campaign is not created.

## Networks, display path, more ads and negative keywords (Search only)

**Networks**: a Search campaign always shows on Google Search. Tick **Include Google search partners** to also show it on Google's search partner sites. It is off by default.

**Display path** sets the text Google shows after your domain in the ad, as in example.com/kubecon/na.

- **Path 1** and **Path 2** take up to 15 characters each. Characters in Chinese, Japanese and Korean, and other full-width characters, count as two.
- A path cannot hold spaces or any of / ? # & =.
- **Path 2** needs **Path 1**.

**More ads** adds responsive search ads to the campaign's ad group. The **Headlines** and **Descriptions** sections are ad 1.

- Select **Add another ad** for ad 2 and ad 3. Google Ads takes at most 3 ads in one ad group.
- Each ad needs at least one headline and one description. It takes up to 15 headlines of 30 characters and up to 4 descriptions of 90 characters. In headlines and descriptions, on ad 1 too, Chinese, Japanese, Korean and other full-width characters count as two.
- An ad can have its own display path. If you leave it blank, the ad uses the **Display path** above.
- If a headline or description on ad 1 is too wide, a message appears under **Headlines** or **Descriptions**. Google Ads uses only the first 15 different headlines and 4 different descriptions of an ad, so lines after those are not checked and are not sent.
- **Remove ad** deletes an ad.

**Negative keywords** are searches the campaign never pays for. They are added when the campaign is created.

- The box starts with the negative keywords suggested by the brief, up to 60, leaving out any that Google Ads would not accept. They are sent with the campaign unless you edit them or empty the box.
- Enter one keyword per line, up to 60 keywords of up to 80 characters each. Use only letters, digits, spaces and & ' - .
- **Match type** (Exact, Phrase or Broad) applies to every keyword in the box. Exact is the default.
- You can add more negative keywords from **Optimize** once the campaign is live.

## Copy, dates and budget filled in from the brief

When you open the **Implement** tab for a brief, some fields start with values from the brief. You can change any of them.

- **Flight dates**: the **Start Date** is today. The **End Date** is the event's first day when the brief gives an event date after today, and otherwise 30 days from today. The Google daily budget starts at the brief's total budget divided by the days from today through the end date, both days counted. The budget never starts below 1 a day. If the total would give less than that:
  - When Google Ads is the brief's only platform, the **End Date** is brought forward to the last day the total covers at 1 a day, so the flight stays within the brief's total. A total too small to cover two days gets a two-day flight at 1 a day.
  - When the brief has other platforms too, the **End Date** is kept, because their campaigns share it, and the Google budget starts at 1 a day.

  When the flight spends more than the brief plans, a note under the Google budget says so. Lower the daily budget or shorten the flight to stay within the plan.

- **Demand Gen Creative** (image ad): headlines, descriptions and the business name. Headlines come from the brief's Demand Gen copy first, keeping only those of 30 characters or fewer, and then from its Search headlines. A longer headline is left out, not shortened.
- **Display Creative**: headlines, descriptions and the business name, chosen the same way, plus a **Long headline**: the first Demand Gen headline the headlines did not use, or else the first Search description the descriptions did not use. A call to action from the brief is kept only if it is one Google accepts (see below).
- **Performance Max Creative**: headlines, long headlines, descriptions and the business name.

A note on each of these creative sections says the copy came from the brief, while it still does. Copy from the brief makes the ad a started one, so add the required images below it to create the ad, or clear the copy to create the campaign without one. Copy you typed before you left the tab is kept when you come back.

### Call to action

On a Display ad, **Call to action** is a list of the button texts Google documents for responsive display ads: Apply Now, Book Now, Contact Us, Download, Learn More, Install, Visit Site, Shop Now, Sign Up, Get Quote, Subscribe and See More. Leave it on **None** and Google chooses the button.

On a Demand Gen image ad, **Call to action** offers only **None**, and Google chooses the button. Google documents no call-to-action values for this ad, and Google Ads refused "Register" there after the campaign was created. On a Demand Gen video ad, choose from the list described under [Demand Gen video ads](#demand-gen-video-ads).

If a saved ad holds a call to action outside its list, a message under **Call to action** says so and **Create Campaign** stays unavailable until you choose one from the list or **None**.

### After you create

Each Google Ads campaign in the results has an **Open in Google Ads** link. It opens the campaign in the Google Ads account you are signed in to; if that is a different account, switch to the campaign's account in Google Ads.

For Google Ads, **Image slot coverage** lists the image slots of the campaign types this tab sends images for: Demand Gen, Display and Performance Max. Search image slots are not listed, because the tab sends no Search images.

## Performance Max descriptions

Google Ads shows a short description on small placements, so a Performance Max campaign needs at least one description of **60 characters or fewer**. Chinese, Japanese, Korean and full-width characters count double.

The descriptions filled in from the brief are often longer than that. If none of yours is short enough, a message appears under **Descriptions** and **Create Campaign** stays unavailable. Shorten one description, or add a short one, to continue.

## Performance Max search themes

Search themes tell Google which searches a Performance Max campaign is for, such as "kubernetes conference". They are a hint, not targeting: Google may still show the ads on other searches. The **Google Search Themes** box appears below the **Performance Max Creative** section when Performance Max is the campaign type.

- Enter one search theme per line. Blank lines are ignored.
- You can add up to 50 search themes, each up to 80 characters.
- Two search themes cannot be the same, even in different capitals.
- Search themes belong to the campaign's asset group, which Google Ads builds from the Performance Max creative. If you enter search themes and leave the creative empty, a message says so and **Create Campaign** stays unavailable. Fill in the creative or remove the search themes.

If a search theme would be refused, a message appears under the box and **Create Campaign** stays unavailable until you fix it. If you switch to another campaign type, the box disappears and a notice says your search themes will not be sent. They are kept, so switching back to Performance Max restores them.

If LFX can't confirm that search themes can be sent, for example while that check is still running or after it fails, the box is hidden and a notice says how many search themes will not be sent. When the check failed, select **Retry** to check again. This notice does not hold **Create Campaign**: a campaign created before the check succeeds is created without the search themes.

## Demand Gen video ads

Each Demand Gen ad is an image ad or a YouTube video ad. Choose one under **Ad format** in the **Demand Gen Creative** section. **Image ad** is the default.

When you choose **Video ad (YouTube)**, the section shows the video ad's fields:

- **YouTube video IDs**: 1 to 5 videos, one per line. Enter the bare video ID, such as dQw4w9WgXcQ, not a link. An ID uses only letters, digits, - and \_.
- **Headlines**: 1 to 5, up to 40 characters each.
- **Long headlines**: 1 to 5, up to 90 characters each.
- **Descriptions**: 1 to 5, up to 90 characters each.
- **Business name**: required once you fill in any field, up to 25 characters.
- **Call to action**: optional. Choose Sign up, Learn more, Book now, Visit site or Watch now, or leave it on None.
- **Logo image (1:1)**: exactly one square logo of at least 128 x 128 pixels, as an `https://` link or from the brief's image library.

In headlines, long headlines, descriptions and the business name, Chinese, Japanese, Korean and other full-width characters count as two, and a line can't repeat another in the same list, even in different capitals.

If the image ad has copy, including copy filled in from the brief, and you then choose the video ad, or the other way round, that ad is kept but not sent, and a note under **Ad format** says so. Choose the other format again to send it instead. If you leave every video field empty, the campaign is created without an ad, as it is with an empty image ad.

## Demand Gen ad groups

A Demand Gen campaign can be split into named ad groups, such as Retargeting and Prospecting, each with its own ad. Tick **Split into named ad groups** in the **Demand Gen Creative** section. The first ad group appears, and **Add ad group** adds more, up to 5. **Remove ad group** removes one.

For each ad group:

- **Name**: required. Google Ads names the ad group after the event, then " - Display | " and this name, such as "KubeCon NA - Display | Retargeting". That full name can be up to 255 characters, or 244 for an ad group with a single video ad, because Google Ads names that video ad after the ad group plus " - Video ad". With several ads, each video ad is named after the ad group plus " - " and the ad's name instead (see below). Each ad group needs a different name, and names that differ only in capitals count as the same.
- **Image ad** or **Video ad (YouTube)**: choose one. The ad group shows that ad's fields, with the same rules as the campaign's single ad above. Paste image links; the brief's image library is not offered for ad groups.

Every ad group needs a complete ad. Until every ad group has a name and a complete ad, a message under the ad groups explains what to fix and **Create Campaign** stays unavailable. The same happens if you remove every ad group while the checkbox is ticked: add one, or untick the checkbox.

While the campaign is split, the single image ad or video ad you entered, and any further ads, are kept but not sent, and a note under the checkbox says so. Untick the checkbox to send the single ad instead. Your ad groups are then kept but not sent, and the note says that too.

## Several Demand Gen ads

A Demand Gen ad group can run up to 5 ads. Select **Add another ad** under the ad, in the **Demand Gen Creative** section or inside a named ad group. The ad above becomes ad 1 and gets an **Ad 1 name** box, and **Ad 2** appears below it. **Remove ad** removes one of the added ads; when none is left, the ad group goes back to its one ad.

For each ad:

- **Name**: required. Each ad in an ad group needs a different name, and names that differ only in capitals count as the same. Google Ads names a video ad after its ad group, then " - " and this name, such as "KubeCon NA - Display - Teaser". That name can be up to 255 characters. An image ad's name labels it here and is not sent to Google Ads.
- **Image ad** or **Video ad (YouTube)**: choose one. The ad shows that format's fields, with the same rules as the single ad above. For ad 2 and later, paste image links; the brief's image library is offered for ad 1 of the campaign's own ad group only.

Every ad needs a complete creative. Until every ad has a name and a complete creative, a message under the ads (or, in named ad groups, under the ad groups) explains what to fix and **Create Campaign** stays unavailable.

Several video ads in one ad group is the arrangement Google Ads has been checked to accept. Several image ads, or image and video ads mixed, in one ad group are sent the same way but have not been checked against Google Ads. If Google Ads refuses one of them, the campaign and its ad group may already exist when that ad fails.

## Audiences (Demand Gen)

A Demand Gen ad group can target one Google Ads Audience, such as an Audience built from your customer lists, website visitors and custom segments. The Audience itself is built in Google Ads; here you pick one the account already has. Only the LF marketing team sees the **Audience** picker, because every foundation shares one Google Ads account.

- **Pick an Audience** lists the account's Audiences by name. Type part of a name to narrow the list, then choose one. The picked Audience is shown by name with a remove button; remove it to pick another.
- The campaign's single ad group has one picker, under its ad in the **Demand Gen Creative** section. When the campaign is split into named ad groups, each ad group has its own picker.
- While the campaign is split, an Audience picked for the single ad group is kept but not sent, and a note under **Split into named ad groups** says so. Untick the checkbox to send it. An ad group's Audience is likewise kept but not sent while the checkbox is unticked.
- If the Audiences cannot be listed, a note says why: the picker is not available here, or the Audiences could not be read for this project's Google Ads account. If the account has no Audiences, or more than the picker shows, a note says that too. The picker lists the first 500 by name.
- If an Audience would be refused by Google Ads, for example one from another Google Ads account, a message at the end of the **Demand Gen Creative** section says why and **Create Campaign** stays unavailable until you remove it.
- If a saved campaign holds an Audience that cannot be sent, a notice under the targeting settings says why and lists the Audience when the **Demand Gen Creative** section is not shown. This includes a Demand Gen campaign selected together with a Search campaign. **Create Campaign** stays unavailable until it is sent or removed, so the Audience is never dropped. The notice says you are not on the LF marketing team, that Audiences are not available on this deployment, that your access is still being checked, that it can be checked once the brief is saved, or that it could not be checked, with **Retry**. Choose **Remove audience** (**Remove audiences** for several) to create without them.

Leave the picker alone and the campaign is created exactly as before, with no Audience.

## Display ad groups

A Display campaign can be split into named ad groups, such as Retargeting and Prospecting, each with its own responsive display ad. Tick **Split into named ad groups** in the **Display Creative** section. The first ad group appears, and **Add ad group** adds more, up to 5. **Remove ad group** removes one.

For each ad group:

- **Name**: required. Google Ads names the ad group after the event, then " - Display Network | " and this name, such as "KubeCon NA - Display Network | Retargeting". That full name can be up to 255 characters. Each ad group needs a different name, and names that differ only in capitals count as the same.
- **The ad**: the same fields and rules as the campaign's single Display ad. Paste image links; the brief's image library is not offered for ad groups.

Every ad group needs a complete ad. Until every ad group has a name and a complete ad, a message under the ad groups explains what to fix and **Create Campaign** stays unavailable. The same happens if you remove every ad group while the checkbox is ticked: add one, or untick the checkbox.

While the campaign is split, the single Display ad you entered is kept but not sent, and a note under the checkbox says so. Untick the checkbox to send the single ad instead. Your ad groups are then kept but not sent, and the note says that too. Placement exclusions cover every ad group. Ad groups do not take their own audiences here.

## If something is wrong

If a window, adjustment, exclusion, excluded place, placement exclusion, display path, ad, video ad, Demand Gen ad, ad group, negative keyword, Performance Max description or search theme would be refused by Google Ads, a message appears under the section and **Create Campaign** stays unavailable until you fix it. Messages give Google's bid modifier rather than a percentage: -20% is a bid modifier of 0.8, and +50% is 1.5.

If you switch to a campaign type that does not take one of these settings, the section disappears and a notice tells you that your windows, device settings or demographic exclusions will not be sent. They are kept, so switching back restores them. Search partners, display paths, more ads and negative keywords are kept the same way when you switch away from Search, and a notice says they will not be sent. Conversion actions you entered are kept the same way when you switch to Performance Max, and a notice in the bidding settings says they will not be sent. Excluded locations are sent for every campaign type. Placement exclusions are sent on Display only, and kept with a notice on the other campaign types. Sitelinks are sent on Search, Demand Gen and Performance Max, callouts and structured snippets on Search and Performance Max, and call extensions, promotions and prices on Search only; each is kept the same way on the other campaign types, with a notice.
