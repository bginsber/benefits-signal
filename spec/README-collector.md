# Benefits Signal — Phase 0 collector

`scripts/collect.mjs` is the spec § 6.1 collector: zero dependencies, Node 18+.

```
node scripts/collect.mjs            # 30-day window
node scripts/collect.mjs --days 7   # narrower window
```

What it does each run: reads the source list from `spec/sources.yaml` (`scripts/lib/sources.mjs`) and collects every active source that has a collector (`scripts/lib/collectors.mjs`): the four RSS interpretation sources (Groom, Trucker Huss, Wagner, Word on Benefits); Mercer Law & Policy through the search backend its own listing page calls; Segal Compliance News through the listing's JSON endpoint; the Federal Register API for EBSA, IRS, ETA, WHD, HHS, and CMS (with structured comment-deadline and effective-date fields); CourtListener v4 opinion search for Ninth Circuit ERISA, benefit-plan, Taft-Hartley, and parity cases (docket number, filing date, and opinion PDF kept as structured fields; `COURTLISTENER_TOKEN` is sent when set); and the California DIR/DAS "What's New" and CAC meeting pages. It stores one JSON document per item under `data/collected/` keyed by URL hash, so re-runs never duplicate; writes `data/run-log.json` with a row for every active source (collected with a count, failed with the error, or skipped with the reason) and a `consecutive_failures` count carried from the previous run, so a source that fails three runs in a row raises a "source silent" warning; and emits `public/collated.xml`, a merged RSS 2.0 feed sorted newest-first, capped at 100 items. The store keeps every document; the collated feed applies `spec/feed-filter.yaml`: Federal Register rules and proposed rules always, notices only from EBSA or when they mention a benefits keyword, agency housekeeping (information-collection and OMB-review notices, patent licences, Privacy Act matches) never, and no firm news, events, or Canada-only posts from the commentary sources. Each item's body is rendered as inline-styled HTML in the newsletter's palette (source kicker, serif headline, date and deadline line, cleaned summary, a single link), which Outlook Classic displays as-is.

Sources with no collector are skipped with a reason in the run log, never silently dropped: EBIA Weekly (email-only — needs the dedicated mailbox), IRS and CMS newsrooms (HTML listings, not yet parsed), dol.gov / hhs.gov newsrooms (bot-protected; the Federal Register API covers their regulatory documents), and regulations.gov (used at verification time, not as a daily collector). Transient fetch failures are retried twice with backoff; a bot challenge such as Wagner's is recorded as a failure, not worked around.

## Reading it in Outlook Classic

Outlook Classic subscribes to RSS by URL (right-click **RSS Feeds** in the folder pane → **Add a New RSS Feed…**), but the URL must be reachable from the machine — a local file path is not reliable. Two options:

**Option A — no infrastructure (works today).** Import `benefits-signal.opml` (File → Open & Export → Import/Export → Import RSS Feeds from an OPML file). Outlook subscribes directly to each source feed, including per-agency Federal Register feeds (the FR API's `.rss` variant is verified working). You get one Outlook folder per source rather than one collated feed, and no collation script needs to run anywhere.

**Option B — one collated feed via GitHub Pages (live).** The repo is public at `github.com/bginsber/benefits-signal`; `.github/workflows/collate.yml` runs the collector daily at ~5:17am Pacific (12:17 UTC, plus on demand via workflow_dispatch and on any push touching the collector or the workflow) and deploys `collated.xml` to GitHub Pages. The collector reads `FEED_URL` from the environment so the channel link self-configures to the Pages URL. It was brought up with:

```
git init -b main && git add -A && git commit -m "Benefits Signal prototype + Phase 0 collector"
gh repo create benefits-signal --public --source . --push
gh api repos/bginsber/benefits-signal/pages -X POST -f build_type=workflow
gh workflow run collate.yml
```

(The Pages API call can also be done in the repo's Settings → Pages → Source: GitHub Actions. A private repo needs GitHub Pro for Pages; on a free plan the repo must be public — the feed contains only public regulatory material, and the feed URL has to be public for Outlook to reach it anyway.)

A single dead source does not block publishing: the collector emits a GitHub warning annotation per failed source (Wagner Law Group sits behind a Cloudflare managed challenge that 403s some clients by IP reputation: it blocked the first two Actions runs and a local machine on 2026-09-01, then passed on the third run, so expect it to come and go) and only fails the job when it collected nothing at all. Note the Actions runner starts fresh each run, so `data/` is per-run scratch there; the durable document store arrives with the pipeline's Postgres in Phase 1.

### Subscribing in Outlook Classic — walkthrough

The live feed is:

```
https://bginsber.github.io/benefits-signal/collated.xml
```

This needs **Outlook Classic** (the desktop app with the classic ribbon). The "new Outlook" toggle and Outlook on the web have no RSS reader; if the folder pane has no **RSS Feeds** folder, switch the toggle in the top-right corner off.

1. In the folder pane, right-click **RSS Feeds** and choose **Add a New RSS Feed…**.
2. Paste the feed URL above and click **Add**.
3. Outlook asks whether to add this feed. Click **Advanced…** before confirming to set the options below, or click **Yes** to accept the defaults.
4. In the Advanced dialog:
   - **Feed name:** `Benefits Signal — Collated Sources` (prefilled from the channel title).
   - **Delivery location:** leave under **RSS Feeds**, or click **Change Folder…** to route it into a shared or reviewed folder.
   - **Downloads:** leave *Automatically download enclosures* unchecked (the feed has none) and leave *Download the full article as an .html attachment* unchecked; each item's `<description>` already carries the summary and the link opens the source document.
   - **Update limit:** leave *Update this feed with the publisher's recommendation* checked. The feed advertises a 12-hour `<ttl>`, and it only changes once a day after the 5:17am Pacific run, so that cadence is enough.
5. Click **OK**, then **Yes**. Press **F9** (Send/Receive All) to pull the first batch instead of waiting for the next scheduled sync. The first sync loads all 100 items in the feed; later syncs add only new ones.

Each item arrives as a mail-like message in the feed folder with the source name in the title, the publish date, a summary, and a **View article** link to the original. Federal Register items with a comment deadline carry it in the summary. Outlook rules, categories, flags, and forwarding work on the feed folder as they do for mail.

If Outlook shows "Cannot download the RSS content" or "Outlook cannot process the RSS content … may not point to a valid RSS source," work through these in order:

1. **Remove and re-add the feed.** Outlook does not re-fetch a feed it has decided is broken. The URL returned 404 for about an hour on 2026-09-02 before GitHub Pages was enabled, and a subscription attempted then stays marked bad. Right-click the feed folder → **Delete Folder**, then repeat the steps above.
2. **Paste the `https://` URL exactly.** `http://…` answers with a redirect, which Outlook's RSS engine sometimes refuses. Do not use raw.githubusercontent.com, which serves `text/plain`.
3. **Try the `.rss` URL.** The same feed is also published as `https://bginsber.github.io/benefits-signal/collated.rss`, which Pages serves as `application/rss+xml`; some clients sniff the content type and prefer it.
4. **Confirm it is Outlook Classic.** The new Outlook toggle (top right) removes RSS entirely.

The feed itself validates: `xmllint` well-formed, W3C Feed Validator zero errors and zero warnings, with an `atom:link rel="self"`, `docs`, and `generator` in the channel.

A sample output from a live 2026-09-01 run is committed at `spec/sample-collated.xml` for inspection; `data/` and `_site/` are runtime output and are gitignored.


## Weekly pipeline on Ben's Mac (no API key)

The model stages (triage, cluster, verify, assess) run through the Claude Code CLI in headless mode on the Claude subscription, so there is no metered API spend. `scripts/weekly.sh` runs the whole chain and `scripts/install-schedule.sh` installs it as a launchd agent for Tuesdays at 18:00 local time, ahead of the Wednesday issue.

```
scripts/install-schedule.sh              # install or reinstall the launchd agent
launchctl kickstart -k gui/$(id -u)/com.benefits-signal.weekly   # run it now
scripts/weekly.sh --no-push              # run by hand without pushing
scripts/install-schedule.sh --uninstall
```

Each run: collects the 30-day window; triages new documents in batches of eight (one Claude Code call per batch, about 15k tokens of context each); clusters, verifies, and assesses the in-scope documents into candidates; writes the candidate digest, the review template (`data/reviews/<issue>.json`), and the trustee-agenda handout; and commits `public/review.xml` plus the digest HTML so the daily Pages deploy carries them to the review feed in Outlook. Logs land in `data/logs/`. Publishing an issue stays a human step: fill in the review file, then `node scripts/publish.mjs --issue <date>` and push `public/issue.json`.

The Mac must be awake at the scheduled time; launchd runs a missed job at the next wake. Any stage can also use a metered key instead by dropping `--claude-code` and exporting `ANTHROPIC_API_KEY`.
