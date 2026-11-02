---
title: Newsletters
description: Write, send, and schedule newsletters to a Newsletter group, see how they performed, and read the newsletters you receive in LFX Self Serve.
audience: [all]
product_area: Mailing Lists
tags: [newsletters, newsletter, newsletter group, email, communication, schedule, analytics, personalization]
last_updated: 2026-11-02
intercom_collection: Mailing Lists
---

Newsletters let a foundation or project send an email update to the people in a group, then see who opened it and which links they clicked. A newsletter is not a mailing list: it goes to the members of one group whose type is **Newsletter**, and it is written and sent from the **Newsletters** page, not from **Mailing Lists**.

## Who can use Newsletters

| What                                                                       | Who                                                                      |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Read the newsletters you receive (**Me** lens)                             | Every signed-in user                                                     |
| Write, send, and schedule newsletters (**Foundation** or **Project** lens) | Executive directors, and people who can manage the foundation or project |

If you don't see **Newsletters** in the sidebar of the **Foundation** or **Project** lens, you don't have permission to send newsletters for it. Contact the foundation or project's executive director.

## Before you start: create a Newsletter group

A newsletter is sent to the members of a group whose type is **Newsletter**. Only groups of that type can be picked as a newsletter's audience; other groups, such as a Technical Steering Committee or a Working Group, are not listed.

To create one:

1. Switch to your **Foundation** or **Project** lens.
2. Select **Groups**, then **Create Group**.
3. On the first step, choose **Newsletter** as the group type.
4. Finish the remaining steps, and add the people who should receive the newsletter as members.

See [Create a group](../../committees/create-committee/) for every step. You can also start from the newsletter itself: if the foundation or project has no Newsletter group yet, the **Audience** step offers **Create newsletter group**, which opens group creation in a new tab with the Newsletter type already chosen. When you're done, come back and select **Refresh groups**.

## Write and send a newsletter

1. Switch to your **Foundation** or **Project** lens and select **Newsletters** in the sidebar.
2. Select **Create Newsletter**.
3. Work through the three steps: **Audience**, **Content**, and **Send**. Use **Next** and **Previous** to move between them, and **Preview** to see the newsletter as recipients will.

Your draft saves automatically as you work. You can also select **Save as Draft** and come back to it later from the **Drafts** tab.

### Audience

Under **Group**, pick the Newsletter group to send to. The recipient count opens a **Recipients** list so you can check who will receive it.

If someone is missing, enter their email under **Someone missing? Add them to this group** and select **Add**. They are added to the group, so they also receive future newsletters sent to it.

If no Newsletter group exists, the step says "There are no groups in _name_ yet" or "None of the groups in _name_ are newsletter groups". Create a Newsletter group as described above, or ask a manager of the foundation or project to create one, then select **Refresh groups**.

### Content

- **Subject**: the headline recipients see in their inbox.
- **Body**: the newsletter itself. You can paste directly from Google Docs or Word. Markdown isn't supported.

To have AI draft the newsletter, select **Generate this with AI**, paste your raw notes into **Your raw content**, and select **Generate**. Generating replaces anything already in the subject and body, so you're asked to confirm first if they aren't empty. Review and edit the result before you send it.

### Send

The **Send** step summarizes the audience size, who the newsletter is from, where replies go, and the subject.

- Select **Send test** to send a test copy to your own email address only.
- Choose **Send immediately** and select **Send now**, or choose **Schedule for later**, pick a time, and select **Schedule**. A scheduled time must be at least 35 minutes from now and no more than 72 hours ahead.

A scheduled newsletter can't be edited. To change it, open it from the **Scheduled** tab and select **Cancel schedule**; it goes back to being a draft.

## Personalization

Newsletters can't be personalized for each recipient. There are no merge fields or placeholders such as `{{first_name}}`: every recipient gets the same subject and body. Write a greeting that addresses the whole community instead, for example "Hello, community".

## Manage your newsletters

The **Newsletters** page has four tabs:

- **Drafts**: newsletters you haven't sent yet. Select one to keep editing, or **Delete** it.
- **Scheduled**: newsletters waiting to go out, with the time they will be sent. **Cancel schedule** turns one back into a draft.
- **Sent**: newsletters that have gone out, with the number of recipients and the open rate.
- **Opt-out**: people who unsubscribed from your newsletters, and when.

### See how a newsletter performed

Select a newsletter on the **Sent** tab to open its analytics:

- **Recipients** (delivered and failed), **Unique opens**, **Total opens**, and **Open rate**. When there is click data, also **Unique clicks**, **Total clicks**, **Click rate**, and **Click-to-open rate**.
- **Opens over time**, **Clicks over time**, and **Top clicked links**.
- **Recipient engagement**: each recipient's delivery status, opens, and clicks. Filter by **Opened**, **Clicked**, **Not opened**, or **Failed**.

Select the failed count to open **Failed deliveries**, which lists the addresses that didn't receive the newsletter. **Copy all** copies them so you can check them.

## Read the newsletters you receive

In the **Me** lens, select **Newsletters** in the sidebar. You see one card per foundation whose newsletters you have received. Select **View newsletters** to see that foundation's newsletters, search them, and filter by project. Select a newsletter to read it.

If you have no newsletters yet, the page says "No newsletters yet". Newsletters are sent to the members of a Newsletter group, so join the group to receive them.

From a newsletter or a foundation card you can select **Invite a colleague** or **Invite** to send an invitation to a colleague's company email. The email must be at a member organization of the foundation.

If you open a link to a newsletter you can't read, you see a message such as **Restricted Newsletter** or **This newsletter is a member benefit** instead of the newsletter.

## Related

- [Mailing Lists FAQ](../faq/): includes common questions about newsletters
- [Create a group](../../committees/create-committee/): create the Newsletter group a newsletter is sent to
- [Mailing Lists](../): Groups.io mailing lists, which are separate from newsletters
