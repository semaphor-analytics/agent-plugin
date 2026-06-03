# Design Tokens And Visual Baseline

Generated dashboards must look like real data products, not raw API output.
This file is the design contract: hierarchy and behavior rules that always
apply, default token scales the agent uses when the host app has none, and
layout primitives that compose into clean dashboards.

When the target app has its own design system (Tailwind theme, shadcn tokens,
MUI theme, CSS variables, a brand stylesheet), prefer those tokens over the
defaults in this file. Use the defaults only when the host has nothing to
inherit. The inviolable rules in section 1 apply either way.

For shape and hierarchy reference, also consult the samples directory at
`samples/exec-overview.html`, `samples/ops-table.html`, and
`samples/analytical-detail.html`. Samples are reference, not template: read
them for structural choices, render with host components.

## Section 1: Inviolable Rules

These apply to every generated Semaphor data app regardless of host design
system, brand, or user preference.

Visual hierarchy on every page:

- page title > section heading > KPI value > KPI label > body text > caption;
- one primary heading per page, not three competing H1s;
- whitespace is hierarchy too: group related views, separate unrelated ones.

Color discipline:

- one accent color per view; do not paint every chart in a different brand color;
- never use rainbow categorical palettes unless the data is genuinely categorical
  with more than three distinct groups;
- semantic color (success, warning, danger) reserved for deltas, status,
  validation; not for decorative use;
- color must work in both light and dark mode; do not rely on a single-theme palette.

Number and date formatting:

- thousands separators on integers and decimals (`1,234,567`);
- currency symbol on the leading side and consistent decimal precision per column;
- percent suffix with consistent precision (`12.4%`, not `12.42857%`);
- signed deltas with explicit sign and color (`+4.2%` green, `-1.1%` red);
- dates use the host locale; do not hardcode `MM/DD/YYYY`;
- nulls render as a muted `—` glyph, not as empty string or `null`.

Required view states:

- every `useSemaphorQuery` result has loading, error, and empty states;
- loading state preserves layout so the page does not reflow;
- empty state explains what would fill the view, not just "no data";
- error state is specific enough to debug without exposing secrets.

Chart restraint:

- no 3D effects, no shadows on data marks, no gradients on bars or lines;
- no decorative icons inside cards competing with the value;
- gridlines muted, axis labels readable, legends only when more than one series;
- never animate value changes in a way that hides the previous value before the
  user has read it.

Tables:

- numeric columns right-aligned; text columns left-aligned;
- numeric values use tabular figures so columns align across rows;
- column headers describe the measure, not the SQL field name;
- numeric totals shown for displayed numeric columns (see tables.md for the
  totals-row contract).

## Section 2: Default Token Scales (shadcn-aligned)

Use these when the host app does not define equivalents. They follow the
shadcn/ui token convention (HSL channels exposed as CSS variables, with
`.dark` overrides), so an app already using shadcn inherits everything. Users
who want their own brand override the HSL channels in this file.

Define tokens as raw HSL triplets so consumers can use `hsl(var(--token))`
and `hsl(var(--token) / <alpha>)` for transparency.

Base palette (light mode default):

```css
:root {
  --background:          0 0% 100%;          /* page bg */
  --foreground:          240 10% 3.9%;       /* primary text */

  --card:                0 0% 100%;          /* card bg */
  --card-foreground:     240 10% 3.9%;

  --popover:             0 0% 100%;
  --popover-foreground:  240 10% 3.9%;

  --primary:             221.2 83.2% 53.3%;  /* blue-600, brand accent */
  --primary-foreground:  210 40% 98%;

  --secondary:           240 4.8% 95.9%;     /* tint surface */
  --secondary-foreground: 240 5.9% 10%;

  --muted:               240 4.8% 95.9%;     /* muted surface */
  --muted-foreground:    240 3.8% 46.1%;     /* labels, captions */

  --accent:              240 4.8% 95.9%;     /* hover/selected tint */
  --accent-foreground:   240 5.9% 10%;

  --border:              240 5.9% 90%;
  --input:               240 5.9% 90%;
  --ring:                221.2 83.2% 53.3%;

  --success:             142 71% 45%;
  --success-foreground:  0 0% 100%;
  --warning:             38 92% 50%;
  --warning-foreground:  0 0% 100%;
  --destructive:         0 84% 60%;
  --destructive-foreground: 0 0% 100%;

  --chart-1:             221.2 83.2% 53.3%;  /* blue */
  --chart-2:             142 71% 45%;        /* green */
  --chart-3:             38 92% 50%;         /* amber */
  --chart-4:             271 81% 56%;        /* violet */
  --chart-5:             190 95% 39%;        /* cyan */

  --radius:              0.5rem;             /* 8px */
}
```

Dark mode overrides (apply via `.dark` class or `prefers-color-scheme`):

```css
.dark {
  --background:          240 10% 3.9%;
  --foreground:          0 0% 98%;
  --card:                240 10% 3.9%;
  --card-foreground:     0 0% 98%;
  --popover:             240 10% 3.9%;
  --popover-foreground:  0 0% 98%;
  --primary:             217.2 91.2% 59.8%;
  --primary-foreground:  240 5.9% 10%;
  --secondary:           240 3.7% 15.9%;
  --secondary-foreground: 0 0% 98%;
  --muted:               240 3.7% 15.9%;
  --muted-foreground:    240 5% 64.9%;
  --accent:              240 3.7% 15.9%;
  --accent-foreground:   0 0% 98%;
  --border:              240 3.7% 15.9%;
  --input:               240 3.7% 15.9%;
  --ring:                224 76% 48%;
}
```

Sequential palette (5-step, single hue, for heatmaps and intensity). Derived
from `--primary` so it inherits brand color:

```
seq-1: hsl(var(--primary) / 0.08)
seq-2: hsl(var(--primary) / 0.20)
seq-3: hsl(var(--primary) / 0.40)
seq-4: hsl(var(--primary) / 0.70)
seq-5: hsl(var(--primary))
```

Diverging palette (for variance around zero):

```
div-neg-2: hsl(var(--destructive))
div-neg-1: hsl(var(--destructive) / 0.35)
div-zero:  hsl(var(--muted))
div-pos-1: hsl(var(--success) / 0.35)
div-pos-2: hsl(var(--success))
```

Spacing scale (Tailwind-aligned, 4px base):

```
space-1:  4px     space-5: 24px
space-2:  8px     space-6: 32px
space-3: 12px     space-7: 48px
space-4: 16px     space-8: 64px
```

Type scale (shadcn-aligned, size / line-height / weight):

```
text-xs:   12px / 16px / 400   caption, table footnote, muted label
text-sm:   14px / 20px / 500   body, table cell, form label, KPI label
text-base: 16px / 24px / 400   body emphasized
text-lg:   18px / 28px / 600   card title, section heading
text-xl:   20px / 28px / 600   page section heading
text-2xl:  24px / 32px / 700   KPI value (default)
text-3xl:  30px / 36px / 700   KPI value (hero), page title
text-4xl:  36px / 40px / 800   landing hero only, rarely in dashboards
```

Font family: system stack by default. shadcn dashboards commonly use Geist or
Inter — use those only when the host app has already set them up.

```
font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
           "Helvetica Neue", Arial, sans-serif;
font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
```

Apply `font-variant-numeric: tabular-nums` (or `font-mono`) to numeric table
cells and KPI values so digits align across rows.

Radius scale (anchored to `--radius`, shadcn convention):

```
--radius-sm: calc(var(--radius) - 4px)    /* 4px — inputs, badges */
--radius:    var(--radius)                /* 8px — cards, popovers */
--radius-lg: calc(var(--radius) + 2px)    /* 10px — large dialogs */
```

Do not use `rounded-xl`, `rounded-2xl`, or larger on data UI. Cards and tables
should read as precise containers, not pills.

Density:

- compact: KPI rows, dense tables, dashboards meant to be scanned at a glance.
  Card padding `space-4` to `space-5`, row height ~32-36px.
- comfortable: forms, configuration panels, detail pages. Card padding
  `space-5` to `space-6`, row height ~40-44px.

Elevation (shadcn dashboards avoid shadows; rely on the 1px border):

```
elev-0: no border, no shadow                                  /* page bg */
elev-1: 1px solid hsl(var(--border))                          /* card */
elev-2: 0 4px 6px -1px rgb(0 0 0 / 0.10),
        0 2px 4px -2px rgb(0 0 0 / 0.10)                      /* popover, drawer */
```

No colored shadows, no glow effects, no inner shadows on data marks.

Dark mode parity: every token has a `.dark` counterpart. Do not produce a
light-only dashboard. When the app already has a theme toggle, respect it; do
not hardcode `prefers-color-scheme` in generated code.

## Section 3: Layout Primitives

Composition rules, not pixel specs. These describe what a healthy dashboard
looks like at the macro level.

KPI row:

- 3-6 cards across, equal width;
- value first, label below in muted text, delta below the label;
- delta uses semantic color and explicit sign;
- never put a chart inside a KPI card competing with the number;
- if you need more than 6 KPIs, break into two rows or add a secondary section.

Filter bar:

- top of the page, left-aligned;
- 3-5 inputs visible before collapsing into "More filters";
- shared filters bind once and pass handles to subscribing queries
  (see filters-and-inputs.md);
- clear-all action visible when any filter is non-default.

Two-column split:

- main view 2/3, supporting view 1/3;
- use when one view is the primary analysis and the other is context;
- do not split a single dense table into two narrow columns.

Detail drawer pattern:

- right-side drawer, not a modal, for row drill-in;
- preserves table context behind the drawer;
- closes on escape and on backdrop click;
- modals are for confirmations and destructive actions, not for inspecting data.

Table-heavy page:

- filters at top;
- totals row directly under filters or sticky at table top;
- table fills remaining height;
- no chart competing for vertical space on a table-heavy page; if a chart is
  essential, use the two-column split.

Analytical detail page:

- filters at top;
- matrix or pivot as the primary view;
- one supporting chart below or beside it, not three;
- subtotals and grand total clearly distinguished from data rows
  (see matrix.md).

Section spacing:

- `space-6` between major sections, `space-4` between cards within a section,
  `space-2` to `space-3` inside cards;
- never let cards touch each other with zero gap.

Empty space is a feature. A dashboard with breathing room reads as
authoritative; a dashboard packed edge to edge reads as a debugging tool.

## Adapting To Host Design Systems

The defaults in section 2 are shadcn-native. When the target app has tokens
of its own, map to them in this order:

1. shadcn theme tokens already on `:root` / `.dark` (`--background`,
   `--foreground`, `--card`, `--primary`, `--muted`, `--border`,
   `--chart-1..5`, `--radius`) — use as-is, no remapping needed;
2. Other CSS variables defined on `:root` or a theme provider;
3. Tailwind config (`theme.extend.colors`, `theme.extend.spacing`, etc.);
4. MUI / Chakra / Mantine theme objects;
5. Fall back to the defaults in section 2 only when none of the above exist.

When the host uses shadcn, do not redeclare `--background`, `--card`,
`--border`, etc. Read what's already there. Use shadcn primitives (`Card`,
`Button`, `Badge`, `Table`, `Tabs`, `Select`, `Separator`, `Skeleton`,
`ScrollArea`, `Sheet` for drawers) instead of authoring raw markup.

Do not introduce a parallel token system inside the data app when the host
already has one. The goal is for the generated views to look native to the
host, not like a Semaphor-branded island.
