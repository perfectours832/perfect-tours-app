Title: Improve the mobile client itinerary and add a safe structured trip editor

The existing parser treated every free-text line as an activity, so a time, attraction name and note could become separate cards. Saving unrelated trip details also rewrote itineraries through a lossy pipe-delimited format. This change keeps legacy data intact, introduces a shared itinerary model, and connects a structured day/activity editor to the existing Supabase save flow.

The client now has a compact navy, cream and gold mobile layout with Hebrew RTL and English support. Day navigation leads to expandable cards whose summaries contain only time, activity name and a purchased-ticket badge. Details show real itinerary images, descriptions, duration, address, navigation and document links. Suggested time, required entry time and booking status are separate fields.

The editor supports adding, editing, deleting and reordering days and activities, moving activities between days, and preserving empty days and unknown metadata. Existing text remains unchanged until the agent explicitly previews and applies an import; the original remains available for download and restoration before save. Historical page URLs redirect to the maintained application, and the password page is unchanged.

Validation:

- `npm test`: 31/31 passed (14 model tests and 17 browser tests). See `docs/VALIDATION.md`.
- Shared-model regressions for legacy fragmentation, metadata, multiline descriptions, empty days and import validation.
- Chromium browser tests with all external traffic mocked or blocked, using explicit TEST ONLY fixtures.
- Phone viewports at 393×851 and 360×800, Hebrew RTL, English, compact summaries, links, login/logout, save/reload, creation, failure recovery and historical URLs.
- Synthetic screenshots generated in `artifacts/` for local review.

Release limits:

- No Supabase schema or production data changes; actual column constraints, RPC definitions and RLS were unavailable and require staging verification.
- Draft itineraries are hidden by the client UI; server-side draft protection still requires verification.
- Private document access depends on the storage provider's permissions.
- Change requests, activity reports, ratings, daily reports, notifications, tenant billing and native packaging remain future work.
- No deployment. Follow `docs/RELEASE-CHECKLIST.md` before release.
