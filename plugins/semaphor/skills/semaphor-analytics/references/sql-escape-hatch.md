# The SQL escape hatch

`semaphor_query_sql_advanced` runs SQL through Semaphor's governed execution.
Use it only when governed analytics can't express the question cleanly:

- the user explicitly asks for SQL or raw rows;
- the project has no semantic domain for the data;
- the field isn't exposed in the semantic model;
- the question needs a construct or grain `semaphor_analyze` doesn't support.

How:

1. Discover first: `semaphor_list_connections`, then the database and schema
   levels the connection reports, then `semaphor_list_tables` (pass
   `nameCandidates` when you have likely names). Never invent connection or
   table identifiers.
2. Preview with a small `LIMIT` (5 or 10) unless the user asks for more.
3. Give `analyzeFallbackReason` (for example
   `field_not_exposed_in_semantic_model`) and a one-sentence
   `analyzeFallbackExplanation`.
4. Explain the result, and say that `semaphor_analyze` remains the governed
   path for ordinary BI questions.

SQL and physical discovery are not available to every session. If the tools
are missing, or a call returns `capability_required`, answer from the
semantic model instead and tell the user SQL access isn't available to them.
