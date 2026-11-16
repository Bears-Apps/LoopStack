# How to use LoopStack

This guide walks through each screen in the left menu. If you haven't installed LoopStack yet, start with the [README](README.md).

> LoopStack describes what already happened in your data. It never tells you what to dose and never changes your pump or Loop on its own. Talk to your care team before you change a setting.

## 1. Connect your data

LoopStack opens on a synthetic patient so you can look around first. When you're ready:

1. Open **Settings** (the gear at the bottom of the left menu).
2. Under **Your data**, enter your **Nightscout address** (for example `https://yoursite.example.com`) and an **access token**.
   - Make the token in Nightscout under **Admin tools → Subjects**: add a subject with the `readable` role and copy its token. Never use your `API_SECRET`.
3. Choose **Connect**. LoopStack reads the last 30 days. The first read can take up to a minute.

To go back to the sample patient, choose **Show the sample patient** in the same place, or **Disconnect**.

## 2. My dashboard

Your home screen: tiles you can move, resize, add and remove.

- **Edit layout** (top right) opens the tile library. Drag tiles to move them, drag an edge to resize, and add or remove tiles.
- **Saved layouts** keeps more than one arrangement, for example one for everyday and one for before a visit.
- Click a tile's **Details** to open it full screen.

Tiles worth knowing:

| Tile | What it shows |
|---|---|
| Glucose now | Your latest reading, its trend, Loop's status, active insulin and carbs |
| Daily trend heads-ups | Weekday stretches that often run low or high, for example "Fridays 3–6pm" |
| Day tracker | Glucose, insulin, carbs and exercise hour by hour for a chosen weekday |
| What Loop did | Insulin delivered against scheduled, 14 days by 24 hours, as patterns in plain words |
| Favorite foods | Your repeat meals as cards. See below |
| Care team | Your thread with your care team, and your notes for the next visit |

### Favorite foods

Each card is a meal you eat again and again, named in Loop (favorites or food types). Unnamed carb entries are left out.

- **The bar** shows how often each outcome happened afterward: green stayed 70–180, yellow went above 180, red went below 70.
- **The low chip** shows how low glucose went after that food, and how many times it got that low: **yellow** under 70 but not under 60, **light red** under 60 but not under 55, **red** under 55.
- **Click a card** to open its details under it: your median glucose curve after that food, and the absorption time you entered against how long glucose took to come back near where it started.
- **Track** sends the food to Suggestions to watch its readings build.
- **Show more** lists the rest of your foods. The full screen shows every one, with every time you had it.

## 3. Care-team review

A one-page packet for your visit, in the order clinicians already read: enough data, then lows, then time in range, then the glucose curve.

- **Tabs:** Visit TLDR, What Loop did, Settings timeline, **Trends** (how the period moved, day by day) and **Notes** (what you noted since your last visit).
- **Report style:** if your clinician is used to another report's layout, pick it from the dropdown. The numbers are the same; only the order and names change.
- **Print or save PDF** and **Email** (top right) export the whole packet. Email opens your own mail app with the PDF attached. You read it and send it.
- **Mark this visit done** in the Notes tab after an appointment, so the next packet only shows new notes.

## 4. Changes

A timeline of your therapy settings changes, with what happened before and after each one. It shows what happened, not proof of why.

## 5. Suggestions

When LoopStack's measured readings point at a setting (basal by hour, insulin sensitivity, carb ratio) or a food's absorption time, it lists it here with its evidence.

- **Track** (white, with a green +) watches a reading build confidence over the days.
- **Building confidence** lists readings still gathering data. **Ready** lists tracked readings that reached the top confidence grade within a 20% step.
- **Add to next build** (green) stages a Ready item for your Loop build. This needs your Loop connected (see 7).
- Safety limits (glucose safety limit, max basal, max bolus) are never suggested.
- A badge on Suggestions in the left menu counts new suggestions and tracked readings that reached confidence.

## 6. Ask & build (optional)

Ask questions about your own data in plain language, for example "what changed in my overnight numbers this month?". This needs your own Anthropic API key:

1. Make a key at [console.anthropic.com](https://console.anthropic.com) under **API keys**. Usage is billed to your Anthropic account.
2. In LoopStack, open **Settings → AI connector**, paste the key and choose **Save the key**. It's kept in your Mac's keychain.

Answers describe your data. They are never dosing advice, and the AI never writes a setting.

## 7. Feature library and your Loop build (optional)

If you build Loop yourself with LoopWorkspace on GitHub, LoopStack can read your build:

1. In GitHub, go to **Settings → Developer settings → Fine-grained tokens** and make a token for **only your LoopWorkspace repository**, with **Contents** and **Actions** set to read and write.
2. In LoopStack, open **Settings → Your Loop** and enter your repository (`your-name/LoopWorkspace`), the branch, and the token.

You'll then see how many days your build has left on TestFlight, the community customizations in it, and switches to turn them on or off. Every change shows you its exact code diff first and needs your confirmation. Nothing changes in your fork until you approve it, and Loop is only updated when you run a new build yourself.

## Your privacy

- Everything stays on your Mac. LoopStack has no server and no account.
- Tokens and keys are kept in the macOS keychain.
- The only things that leave your Mac are what you choose: reading your Nightscout, reading your GitHub fork, questions you send with your own API key, and emails you send yourself.

## Trouble?

- **"LoopStack can't be opened"**: see step 2 in the [README](README.md#get-started).
- **Nothing loads after connecting Nightscout**: check the address opens in your browser, and that the token has the `readable` role.
- **Still stuck?** [Open an issue](../../issues). Leave out your Nightscout address, tokens and health data.
