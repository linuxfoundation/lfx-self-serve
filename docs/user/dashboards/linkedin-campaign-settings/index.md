---
title: LinkedIn budget, targeting and ad variants
description: Set a LinkedIn budget and an optional daily cap beside a lifetime budget, search for the locations a LinkedIn campaign targets, see and narrow what a LinkedIn targeting profile targets, edit each ad variant's intro text, headline, name and description, add or remove variants, and give each variant its own image on the Campaigns page's Implement tab.
audience: [executive-director]
product_area: Dashboards
tags:
  [
    campaigns,
    paid marketing,
    linkedin ads,
    sponsored content,
    budget,
    daily cap,
    target cost,
    automatic bidding,
    manual bidding,
    website visits,
    lifetime budget,
    targeting,
    locations,
    member groups,
    skills,
    ad variants,
    intro text,
    headline,
    ad name,
    description,
    images,
    implement,
  ]
last_updated: 2026-11-26
intercom_collection: Dashboards
---

When you create a LinkedIn campaign from the **Campaigns** page in the Foundation lens, each ad variant in the LinkedIn section becomes its own ad in the campaign. The **Implement** tab fills the variants in from the brief, and you can edit each one's intro text and headline, add or remove variants, and give each variant its own image. You can also see what the chosen targeting profile targets and take entries out of it.

## Where to find them

1. Open **Campaigns** in the Foundation lens and choose **Paid Marketing**.
2. Open the **Implement** tab for a brief that includes LinkedIn Ads.
3. In the **LinkedIn Sponsored Content** section, scroll to **Ad variants**. The heading shows how many variants there are, out of the most you can have.

## Ad account

The **Ad Account** line in the LinkedIn section tells you where the campaign is created. It is set by the project's LinkedIn connection: the campaign goes into that connection's ad account, or into LF's shared LinkedIn account if the project has no LinkedIn connection of its own. You can't choose a different account here yet.

## Budget

The **LinkedIn Budget (USD)** box sets how much the campaign may spend. Leave **Lifetime budget** off and it is a daily budget (at least $10). Turn it on and it is the total for the whole campaign (at least $100).

With **Lifetime budget** on, you can also set an optional **Daily cap (USD)**: the most LinkedIn spends on any one day. For example, a $1,000 lifetime budget with a $20 daily cap. The cap must be at least $10 and no more than the lifetime budget. Leave it empty for no cap.

If the cap is under $10 or over the lifetime budget, a message appears under it and **Create** stays disabled with "LinkedIn Ads: fix the daily cap." Turning **Lifetime budget** off removes the cap.

A campaign with a daily cap runs without its own end date in LinkedIn Campaign Manager. The event's campaign group stops it on the campaign's end date instead. If the event already has a campaign group that ends later than this campaign, or never ends, the create is refused.

After the campaign is created, you can change its lifetime budget on the **Optimize** tab and the daily cap stays as it is. Keep **Budget pacing** on **Lifetime** there: switching a capped campaign to **Daily** is refused. A new lifetime budget below the daily cap is also refused; lower the cap first. To change the daily cap itself, use LinkedIn Campaign Manager.

## Target cost

With automatic bidding, you can set an optional **Target cost (USD)** under the LinkedIn bidding choice. It is sent with automatic bidding as the campaign's unit cost, in USD; how LinkedIn applies it is still being confirmed. For example, 17.88. Leave it empty for no target.

The target must be more than 0, no more than 1,000,000 and use at most two decimal places. Otherwise a message appears under it and **Create** stays disabled until you fix or clear it.

The box is only there with automatic bidding, and only where your deployment supports a target cost. Switch to manual bidding and the target is not sent. If you typed a target and the campaign settings are still loading, **Create** waits until they load, so the campaign is never created without the target you entered. If they can't be loaded, clear the target cost to continue.

## Website visits with a manual bid

Where your deployment supports it, you can choose **Website visits** as the **Campaign objective** and **Manual max CPC bid** together. The campaign is created as a website visits campaign with your bid as its maximum cost per click, for example $45; LinkedIn may charge less per click. While website visits is chosen, the manual bidding option says "Creates a website-visits campaign with a manual cost-per-click bid."

Leave the objective on **Set by bidding (default)** and a manual bid still creates a website conversions campaign, as before. Where your deployment doesn't support it, website visits with a manual bid keeps **Create** disabled with "The traffic objective takes automatic bidding only"; choose automatic bidding or the website conversions objective to continue.

## Delivery options

Where your deployment supports them, **Delivery options** has two checkboxes under the LinkedIn bidding choice. Both are off by default, and a campaign created with both off is set up the same way as before.

- **Audience Expansion** lets LinkedIn also reach members similar to your targeting.
- **LinkedIn Audience Network** also shows the ads on partner apps and sites outside LinkedIn. You can't use it with text ads or with the lead generation objective, so the checkbox is greyed out and not sent while either is chosen.

A campaign that reuses an existing LinkedIn campaign keeps that campaign's own settings. If you turned an option on and the campaign settings are still loading, **Create** waits until they load. If they can't be loaded, turn the options off to continue.

## Locations

The LinkedIn section starts with the locations the brief recommends. To change them:

- To add a location, type at least 2 characters of a country, region or city in the search box under the location list, then pick a result. A location you already added is listed but can't be picked again.
- To remove a location, select the **x** on its chip.

A campaign needs at least one location. While the list is empty, **Create** stays disabled with "LinkedIn Ads: add at least one location."

The campaign name includes a region taken from the first location. Only the United States, India, Japan, Singapore, South Korea, Australia, Taiwan, Hong Kong, Germany and the United Kingdom have their own region in the name. Any other first location is named "Global".

## Edit a variant

Each variant has an **Intro text** box (the body of the post) and a **Headline** box (shown below the link card). They start with the brief's copy. A count under each box shows how many characters the text uses:

| Field      | Most characters |
| ---------- | --------------- |
| Intro text | 600             |
| Headline   | 200             |

Spaces at the start and end are not counted. An em dash (—) or en dash (–) is sent as a comma and a space, and counted that way, so the count can differ from what you typed. A dash at the very start or end is dropped.

Both fields are required. If a field is empty, holds only spaces or a single dash, or is over its limit, a message appears under it and **Create** stays disabled with "LinkedIn Ads: fix the ad variant text." Shorten or fill in the text to continue. Longer text is not cut for you.

## Name and describe each ad

Where your deployment supports it, each variant also has two optional fields:

- **Ad name**: how the ad is listed in LinkedIn Campaign Manager and in reporting, up to 255 characters. Left empty, the ad is named after the event and its variant number, for example "KubeCon EU 2026 | variant-2". Each ad in a campaign needs its own name. If two variants have the same name, a message appears under the second one and **Create** stays disabled with "LinkedIn Ads: fix the ad name or description."
- **Description**: the line shown under the headline in the ad, up to 300 characters, counted the way intro text and headlines are. Left empty, the ad has no description.

## Add or remove variants

- Select **Add variant** to add an empty variant at the end, then write its intro text and headline. You can have up to 15 variants, LinkedIn's limit on active ads in a campaign. **Add variant** is disabled at 15.
- Select **Remove variant** on a variant to delete it. A campaign needs at least one variant, so **Remove variant** is disabled when only one is left.

If the brief holds more than 15 variants, **Create** stays disabled until you remove enough of them.

## Give each variant its own image

When LinkedIn ad images are available on your deployment, each variant has an **Image** picker. The image you choose is used only for that variant's ad. A variant without an image is created without one.

- Choose a PNG or JPEG of up to 5 MB, at least 640x360 (horizontal), 360x360 (square) or 360x640 (vertical). A file of another type or over 5 MB is refused before it uploads.
- The brief must be saved first. The pickers are disabled while the brief has not been saved or is saving.
- One image uploads at a time. While a variant's image is uploading, or its upload has failed, the other variants' pickers are disabled with a note naming that variant. **Create** waits until the upload finishes.
- **Cancel upload** stops an upload in progress, and **Remove uploaded image** takes the image off that variant. Removing a variant also cancels its upload.

Your edits and images are kept when you switch to another tab and back, as long as you stay on the same event.

### Image notices

**Create** stays disabled while a variant shows one of these notices under its picker. Each notice has a **Remove image** button, and the failed check also has **Retry**:

- The upload did not complete. Remove it, or choose the image again.
- The image was uploaded for a different brief. Remove it, then upload it again.
- LinkedIn ad images are not available on this deployment. Remove the image to create the campaign without it.
- LinkedIn ad image support could not be confirmed. Retry the check, or remove the image.
- LinkedIn ad image support can't be checked until the brief is saved. Save the brief, or remove the image.
- Checking LinkedIn ad image support…, shown while the check runs.

## Targeting profile

The **Targeting Profile** buttons in the LinkedIn section choose who sees the ads: **Cloud Native / CNCF** or **AI / MCP**. The brief picks one to start with. Under the buttons, the section lists what the chosen profile targets:

- **Member groups**: LinkedIn groups, shown by their LinkedIn ID (for example `urn:li:group:12345`).
- **Skills**: LinkedIn skills, shown by their LinkedIn ID (for example `urn:li:skill:12345`).

In the chosen locations, LinkedIn shows the ads to members who are in any of these groups, have any of these skills, or work in one of a fixed set of job functions. The campaign service adds the same job functions to every LinkedIn campaign, and they can't be changed here. Each heading shows how many entries this campaign keeps, then the profile's total, for example **Member groups (1 of 2)**.

### Remove entries

When targeting changes are available on your deployment, each group and skill has a remove button (×). Removing one takes it out of this campaign only. The profile itself does not change.

- **Reset to profile** puts back everything you removed. It appears once you have removed something.
- Choosing the other profile starts again from that profile's full list, so anything you removed is put back. If the brief chose a custom profile, neither button is selected, but the lists show Cloud Native / CNCF's groups and skills, which is what LinkedIn uses. Choosing Cloud Native / CNCF then keeps your removals.
- If you remove every group and skill, a note says the campaign reaches everyone in those job functions in the chosen locations. You can still create the campaign.
- You can't add groups or skills. Only entries already in the profile can be kept or removed.

Your removals are kept when you switch to another tab and back on the same event. Generating a brief for another event starts from the full profile.

If targeting changes aren't available, the lists are shown without remove buttons. **Create** stays disabled while removals you made earlier can't be sent: "LinkedIn Ads: targeting changes are not available right now. Reset the targeting profile." If the profile's details didn't load, the section says so, and **Create** stays disabled while you hold removals until you reload the page or select **Reset to profile**.
