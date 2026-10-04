# Semantic model inspection and changes

## Inspecting

- `semaphor_list_semantic_domains`: the domains in the project.
- `semaphor_list_datasets`: the datasets in a domain, with their measures,
  dimensions and date fields.
- `semaphor_get_dataset_schema`: one dataset's fields: data types, roles,
  default aggregates, and which fields are calculated.
  - `role` is `measure`, `dimension`, `date` or `id`. Use the same values in
    Matrix requests.
  - `fieldKind: "calculated"` means the semantic model defines the field
    with an expression.
  - `aggregate` is the aggregate a query applies. A calculated measure with
    no `aggregate` aggregates inside its own expression: use it as it is and
    don't pass an aggregate override.
- `semaphor_get_domain_relationships`: how datasets join (cardinality and
  keys).

Use these to explain what the model can answer, and to spot gaps: a missing
relationship, a field without a role, a measure with the wrong default
aggregate.

## Changing

Every change goes through two tools, which appear only for sessions with
write access and an author role or higher:

1. `semaphor_propose_change` previews the change and saves nothing. It
   returns a `proposalId`, a `preview` of exactly what will happen,
   `validation` and `risk`.
2. Show the preview to the user and get an explicit go-ahead.
3. `semaphor_apply_change` with the `proposalId` applies exactly that
   preview. Then re-run the question that needed the change.

Kinds:

- **Add a relationship:** `target: { "kind": "semantic_model", "domainId": "…" }`
  with one operation `{ "op": "add_relationship", "relationship": { "sourceDataset", "sourceFields", "targetDataset", "targetFields", "cardinality", "defaultJoinType" } }`.
  Needs an interactive login: token sessions get
  `change_not_allowed_for_credential`.
- **Create a dashboard:** `target: { "kind": "dashboard" }` with one
  operation `{ "op": "create", "request": { "prompt": "…", "domainId": "…", "datasetNames": ["…"] } }`.
  The preview lists the dashboard and its cards; apply creates that plan as
  a private dashboard.

Proposals expire after 30 minutes. Retrying `semaphor_apply_change` with the
same `proposalId` is safe: it returns the recorded result with
`replayed: true` and never applies twice. On `proposal_stale` (the model
changed after the preview), propose again. On `apply_outcome_unknown`, check
whether the change landed, as the error describes, before proposing again.

Never apply a change the user didn't ask for, and never work around a missing
relationship by forcing joins in SQL.
