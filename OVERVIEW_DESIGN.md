# Overview design guide

## Intent

The Overview is a compact operating snapshot: it answers whether revenue is on pace, whether attention is rising, which post is working, and how the two Instagram accounts compare. It does not duplicate the Analytics record table.

## Reference cues adopted

- A quiet dark canvas with softly outlined panels.
- Cards use a small icon/label, then one dominant value; secondary changes are restrained green/red text.
- The first row carries the largest decisions: progress toward the $400 goal, reach/engagement trend, and cumulative sales.
- Supporting components form a regular grid with generous internal padding, not a dense wall of gauges.

## Layout

1. **Summary row:** revenue-goal progress, 30-day daily reach/engagement line chart, running sales total.
2. **Detail row:** post-level funnel and one highlighted top post.
3. **Comparison row:** Matthew and Luca shown side-by-side from the connected-account records.

## Data contract

| Component | Source | Definition |
| --- | --- | --- |
| Revenue goal | `gumroad_daily_summary` | Running total revenue / $400 goal. |
| Trend | `instagram_analytics` | Daily `reach` and `accounts_engaged`, summed across accounts. |
| Sales total | `gumroad_daily_summary` | Latest `running_total_cents`. |
| Funnel | `post_product_links`, `instagram_posts`, `get_funnel` | Linked posts only; reach → interactions → sales. Visits appear only when supplied by the RPC. |
| Top post | `instagram_posts` | Highest `total_interactions`, across connected accounts. |
| Account comparison | `instagram_accounts`, `instagram_analytics` | Latest available followers, reach, and views for each account. |

Missing records always produce an explicit empty state; zero is never substituted for unavailable data.
