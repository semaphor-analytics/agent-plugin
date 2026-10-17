# Dashboard audits and reconciliation

Use these when the user asks what a dashboard shows, whether its numbers are
right, or why two numbers disagree.

1. **Find the dashboard.** `semaphor_list_dashboards` (search by title, filter
   by tag). If you already have the dashboard id, skip this.
2. **Read its analysis context.** `semaphor_get_dashboard_analysis_context`
   returns the cards, their filters (including relative date filters such as
   "This month"), authored measures, dimensions and date fields, source
   references, and bounded query inputs. Treat it as the primary grounding:
   don't rediscover the same dashboard through broad discovery.
3. **Run the card as it is.** `semaphor_analyze` with only
   `fromCard: { "dashboardId": "...", "cardId": "..." }` returns the card's
   own rows, with everything it runs on its dashboard (filters, drill steps,
   default inputs and date range, parameters, comparisons).
   `executionResult.constraints` names the filters and date windows it
   applied and any it skipped. A Matrix card, a text card or a card in a
   Document section returns `card_not_supported`.
4. **Re-run the card's question governed.** Rebuild the question with
   `semaphor_analyze` (or `semaphor_matrix` for a Matrix card) using the
   card's fields and filters, and compare its values with the card's own.
   Compare the two results' `executionResult.constraints` first.
5. **Explain any difference** by naming what differs: the time window, a
   filter, an aggregate, a join path, or a security policy that limits the
   viewer's rows.

`semaphor_get_dashboard_details` returns the dashboard's metadata and, with
`fields: ["summary", "template"]`, its full configuration.

Reconciliation is read-only. Report findings; don't change the dashboard
unless the user asks.
