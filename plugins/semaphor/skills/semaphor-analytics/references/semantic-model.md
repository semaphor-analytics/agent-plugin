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

Every change goes through two tools. Semantic model changes need an
organization user with the Author role or higher; end users never change a
semantic model.

1. `semaphor_propose_change` previews the change and saves nothing. It
   returns a `proposalId`, one `summary` sentence per change, `risk` and
   `confirm`.
2. Show the sentences to the user and get an explicit go-ahead. Every
   semantic model change asks for one.
3. `semaphor_apply_change` with the `proposalId` saves it. Then re-run the
   question that needed the change.

A semantic model change takes the `domainId` and a `changes` list. Read the
current values with `semaphor_get_dataset_schema` first.

- **Improve what agents read:** `domain.update`, `dataset.update`,
  `field.update` (with `dataset` and `field`) and `metric.update` (with
  `metric`, and its `dataset` unless it spans datasets) change `label`,
  `description` and `context`. In `context`, `instructions` replaces the text
  (`null` clears it); `synonyms` and `examples` (example questions) take
  `{ "add": [...], "remove": [...] }`. Never resend a whole list: add or remove
  only the items the user named, so names an author typed stay. A field's or
  metric's `name` never changes; change its `label`.
- **Settings:** on a fact (`field.update`), `format`, `unit` and
  `comparisonPolarity`; on a metric (`metric.update`), `format` and
  `comparisonPolarity`; on a dimension, `isDisplayField`; `hidden: true`
  hides a field.
- **Definitions** (each line says what reads it; `risk: medium`): `expression`
  on a calculated field or a metric on one dataset, `defaultAggregate` on a
  fact, `granularity` on a date dimension, `primaryDateField` on a dataset,
  and `relationship.update` (by name or id: `isActive: false`,
  `defaultJoinType` `LEFT` or `INNER`).
- **New calculation:** `calculation.add` with `name`, `expression` and its
  `dataset`, or `inputs` for a metric across datasets; the domain places it.
- **Add a relationship:** `relationship.add` with
  `from: { "dataset", "fields" }` (the many side), `to: { "dataset", "fields" }`
  (the side whose fields identify one row), `cardinality` (`many_to_one` or
  `one_to_one`) and `defaultJoinType` (`LEFT` or `INNER`). Up to five in one
  proposal, which holds only relationships. A warning that the `to` fields
  don't identify one row doesn't block it: show it with the preview.

Keys, dataset sources and SQL, adding or removing datasets, unhiding a field,
fact filters and composed dimensions stay on the domain page: say so.

Proposals expire after 30 minutes. Retrying `semaphor_apply_change` with the
same `proposalId` is safe: it returns the recorded result with
`replayed: true` and never applies twice. On `proposal_stale`, someone changed
the domain after the preview; `changed` names each value and what it is now.
Tell the user, read it again and propose again. On
`apply_outcome_unknown`, check whether the change landed, as the error
describes, before proposing again.

Never apply a change the user didn't ask for, and never work around a missing
relationship by forcing joins in SQL.
