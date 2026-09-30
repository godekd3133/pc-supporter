# Usage event persistence

Usage events contain only fixed event names, UTC calendar days, and integer counts. They do not store request payloads, account identifiers, IP addresses, or per-event rows.

Daily counts are stored only in PostgreSQL in `usage_event_daily_counts`; `DATABASE_URL` is required for the server to start. A legacy `data/usage-events.json` file from a file-mode installation is never imported automatically — PostgreSQL summaries start from the rows already in `usage_event_daily_counts`. Retaining the old file is only meaningful as the source for a separately approved, one-time migration if historical continuity is required.

The store retains the newest 97 UTC day buckets, matching the existing 90-day retention window plus its seven-bucket allowance. The admin summary keeps the existing `{ retentionDays, days, totals, daily }` response shape.
