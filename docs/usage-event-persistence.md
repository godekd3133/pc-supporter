# Usage event persistence

Usage events contain only fixed event names, UTC calendar days, and integer counts. They do not store request payloads, account identifiers, IP addresses, or per-event rows.

The selected persistence mode controls the aggregate store:

- With `DATABASE_URL` configured, daily counts are stored in PostgreSQL in `usage_event_daily_counts`.
- Without `DATABASE_URL`, daily counts are stored in `data/usage-events.json` (or the configured `PC_SUPPORTER_DATA_DIR`).

The service never imports `usage-events.json` into PostgreSQL. When switching an existing installation to PostgreSQL, the old JSON file is left in place and PostgreSQL summaries start from the rows already in `usage_event_daily_counts`. The file is retained as the source for a separately approved, one-time migration if historical continuity is required; it must not be deleted or treated as imported until an operator has explicitly backed it up, loaded and reconciled the daily totals, and verified the PostgreSQL summary. No automatic or startup migration is provided.

Both stores retain the newest 97 UTC day buckets, matching the existing 90-day retention window plus its seven-bucket allowance. The admin summary keeps the existing `{ retentionDays, days, totals, daily }` response shape.
