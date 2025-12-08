# From Clicks to Intents: Designing a User-Facing Viz App for LLMs

This document expands the core ideas we discussed about rethinking a UI-centric data visualization app so it can be safely and reliably driven by a large language model (LLM) or an MCP client. It’s written as a practical blueprint you can adapt directly.

---

## Why rethink the API?

Traditional UI apps expose low-level, imperative operations (clicks, DOM events, widget toggles). LLMs operate best on **high-level intents** with **clear contracts** and **predictable side-effects**. If you keep “click-ish” APIs, models will struggle to sequence brittle steps and recover from errors. The fix is a **capability-driven, declarative, idempotent** interface.

---

## Design principles (the “north stars”)

1. **Intent over clicks**
   Replace “toggle sidebar”, “click bar #3” with domain actions like `set_filter`, `change_encoding`, `summarize_selection`. This matches how users speak and how models reason.

2. **Small, composable surface**
   5–8 tools beat 30. Each tool should do one clear thing and compose with others (filter → change chart → summarize).

3. **Schema-first & strongly typed**
   Define JSON Schemas with enums, required fields, and `additionalProperties: false`. Reject unknown/ambiguous args to reduce hallucinations.

4. **Idempotency & determinism**
   Every write accepts an `operation_id` and `state_version`. Replays don’t double-apply; conflicts are explicit.

5. **Separation of reads vs writes**
   Validation, describe, preview endpoints are *read*; applying filters, changing encodings, exporting are *write*. LLMs recover faster when the boundary is crisp.

6. **Consistent state model**
   Either (a) pass all state every call (stateless) or (b) use short-lived sessions with `session_id` + `state_version`. Pick one and stick with it.

7. **Explainability built-in**
   Tools return both a **machine diff** and a **human explanation**. The chat uses the explanation; automations use the diff.

8. **Discoverability**
   Introspection endpoints expose fields, sample values, encodings, constraints. Let the model ask “what can I do?” instead of guessing.

9. **Secure by default**
   Validate args server-side, enforce column/row ACLs, and gate powerful ops with scopes. Assume prompt injection attempts will happen.

10. **Observability & evaluation**
    Log `(message → tool → args → result/diff → latency → success)` to iterate on prompts, schemas, and guardrails. Keep red-team transcripts.

---

## Capability model: the “LLM-ready” tool set

Think of these as verbs the model can call anywhere—via your in-app chat, a server-side agent, or an MCP client.

### Core write tools

* `set_filter(field, op, value)`
* `change_encoding(chart, x?, y?, color?, aggregation?)`
* `set_selection(brush?, ids?)`
* `sort_limit(by, order, limit)`
* `bookmark_view(name)`
* `export_view(format)`

### Read/describe tools

* `describe_fields()`
* `describe_capabilities()` (chart types, encodings, constraints)
* `validate_query(filter/encoding/selection)` (dry run)
* `summarize_selection(metrics[], compare_to?)`

Keep each tool **small and orthogonal**; avoid “do-everything” verbs.

---

## Contract details (with examples)

### 1) JSON Schemas (strict)

```json
// set_filter.schema.json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "session_id": { "type": "string" },
    "state_version": { "type": "integer", "minimum": 0 },
    "operation_id": { "type": "string" },
    "field": { "type": "string" },
    "op": { "type": "string", "enum": ["=", "!=", ">", "<", ">=", "<=", "in", "between"] },
    "value": {
      "oneOf": [
        { "type": "string" },
        { "type": "number" },
        { "type": "array", "items": {} },
        { "type": "object", "properties": { "min": {}, "max": {} }, "required": ["min", "max"] }
      ]
    },
    "dry_run": { "type": "boolean", "default": false }
  },
  "required": ["session_id", "state_version", "operation_id", "field", "op", "value"]
}
```

### 2) Response shape (machine-first, human-second)

```json
{
  "new_state_version": 42,
  "spec": { /* full viz spec, e.g., Vega-Lite or your internal schema */ },
  "diff": {
    "filters": [{ "added": { "field": "region", "op": "in", "value": ["EMEA","APAC"] } }],
    "encodings": [],
    "selection": null
  },
  "explanation": "Included EMEA and APAC regions.",
  "telemetry": { "rows_affected": 128445, "elapsed_ms": 210 }
}
```

### 3) Version conflicts & retries

```json
// 409 response
{
  "error": {
    "code": "version_conflict",
    "message": "Your state_version=41 is stale.",
    "server_version": 44,
    "hint": "Fetch /viz/state, merge, and retry.",
    "suggested_fixes": [
      { "action": "fetch_state" },
      { "action": "retry", "args": { "state_version": 44 } }
    ]
  }
}
```

LLMs can act on `suggested_fixes` without user intervention.

---

## Introspection (“let the model look around”)

Provide affordances for the model to plan:

* `GET /schema/fields` →

  ```
  [{ "id":"revenue", "type":"number", "cardinality":"high",
     "sample_values":[123.4, 99.9], "aggregations":["sum","mean","median"] }, ...]
  ```

* `GET /viz/capabilities` →

  ```
  { "charts":["bar","line","scatter","histogram","map"],
    "encodings":["x","y","color","size"],
    "constraints":{"map": {"requires":["geo"]}} }
  ```

* `POST /query/validate` → return `ok|warnings|errors` + normalized plan.

---

## State management patterns

### Option A: Session-based (recommended for interactive viz)

* `POST /session/open` → returns `session_id`, initial `state_version`, and base spec.
* All subsequent calls include `session_id` + `state_version`.
* Server owns state; clients only send diffs/intents.
* Good fit for MCP & chat UX.

### Option B: Fully stateless

* Every call includes **complete** state (filters, encodings, selections).
* Easier to cache/CDN; harder for long interactive sessions.

**Always include** `operation_id` for dedupe and safe retries.

---

## Error contracts that teach (make recovery automatic)

Design errors so the LLM can self-heal:

```json
{
  "error": {
    "code": "unknown_field",
    "message": "Field 'revenu' not found.",
    "hint": "Did you mean 'revenue'?",
    "suggested_fixes": [
      { "action":"retry", "args": { "field":"revenue" } },
      { "action":"inspect_fields" }
    ],
    "alternatives": ["revenue", "revenue_usd", "rev_per_user"]
  }
}
```

Other helpful codes: `invalid_operator`, `value_out_of_range`, `not_authorized`, `too_expensive`, `timeout`.

---

## Security, privacy, and policy

* **Input validation**: Never pass tool args straight into SQL/ES; use parameterized builders and allow-lists.
* **Row/column ACLs**: Enforce at the tool layer; redact fields in `describe_fields` the caller cannot access.
* **Scopes**: Dangerous ops (`export_all`, `writeback`, `join_external`) require explicit scopes. Refuse by default.
* **PII controls**: Add `masking_rules` and `purpose` fields; log justifications for audits.
* **Prompt injection resilience**: Tools should be narrow. Never accept “run arbitrary SQL.” Keep the system prompt short and tool-first.

---

## Performance & cost controls

* **Dry runs**: `dry_run:true` returns row counts and cost estimates without executing.
* **Pagination/cursors**: All tabular returns support `cursor` + `limit` with `total_rows`.
* **Time bounds & budgets**: `timeout_ms`, `max_cost_units`, and `partial:true` contracts.
* **Server-side caching**: Cache normalized specs and aggregate tiles. Expose `cache_hit:true/false` in telemetry.
* **Pre-compute summaries**: Maintain cubes for the fields used in `summarize_selection`.

---

## Observability & evaluation

* **Event log**: `(timestamp, session_id, user_msg, tool, args_hash, result_bytes, elapsed_ms, status)`.
* **Golden conversations**: Curate a set of tasks (10–50) with expected tool sequences and results; regression-test prompts and schemas.
* **Red-team harness**: Fuzz bad field names, mixed types, extreme limits, and injection-like content.
* **Drift alerts**: If a release increases `invalid_argument` rate or p95 latency, fail CI.

---

## Migration plan (pragmatic, low-risk)

1. **Inventory current actions** → map to 6–8 intents.
2. **Wrap internals** behind new tool handlers (no engine rewrite).
3. **Add introspection endpoints** (`/schema/fields`, `/viz/capabilities`, `/viz/state`).
4. **Introduce `state_version` + `operation_id`** plumbing.
5. **Return `diff` + `explanation`** in all write responses.
6. **Ship an in-app chat** using these tools via your model of choice.
7. **Add validation endpoints** and tighten schemas (ban unknown fields).
8. **(Optional)** Expose the same tools via an **MCP server** for portability.

---

## Minimal reference contracts (HTTP flavored)

### Open a session

```http
POST /session/open
Authorization: Bearer …
```

**200**

```json
{ "session_id":"s_abc", "state_version":0, "spec":{ /* base chart */ } }
```

### Change encoding

```http
POST /viz/change_encoding
Content-Type: application/json
Authorization: Bearer …

{
  "session_id":"s_abc",
  "state_version": 0,
  "operation_id":"op_001",
  "chart":"bar",
  "x":"region",
  "y":"revenue",
  "aggregation":"sum"
}
```

**200**

```json
{
  "new_state_version":1,
  "diff":{"encodings":[{"changed":{"chart":"bar","x":"region","y":"revenue","aggregation":"sum"}}]},
  "spec":{ /* new spec */ },
  "explanation":"Bar chart of revenue by region (sum)."
}
```

### Summarize current selection

```http
POST /viz/summarize_selection
{
  "session_id":"s_abc",
  "state_version": 1,
  "operation_id":"op_002",
  "metrics":["count","mean","median"],
  "compare_to":"rest"
}
```

---

## Example tool schemas (TypeScript types)

```ts
type OpId = string & { readonly brand: unique symbol };

interface BaseArgs {
  session_id: string;
  state_version: number;
  operation_id: OpId;
  dry_run?: boolean;
}

type FilterOp = "=" | "!=" | ">" | "<" | ">=" | "<=" | "in" | "between";

interface SetFilterArgs extends BaseArgs {
  field: string;
  op: FilterOp;
  value: string | number | any[] | { min: number; max: number };
}

type Chart = "bar" | "line" | "scatter" | "histogram" | "map";

interface ChangeEncodingArgs extends BaseArgs {
  chart: Chart;
  x?: string;
  y?: string;
  color?: string;
  aggregation?: "sum" | "mean" | "median" | "count";
}

interface ApiError {
  code:
    | "unknown_field"
    | "invalid_operator"
    | "value_out_of_range"
    | "not_authorized"
    | "too_expensive"
    | "version_conflict"
    | "timeout";
  message: string;
  hint?: string;
  suggested_fixes?: { action: string; args?: Record<string, unknown> }[];
}
```

---

## Prompt & response patterns (for reliability)

* **System prompt**:
  “You are a data-viz copilot. Prefer calling tools. Never invent fields. If a tool fails, use `suggested_fixes`. Keep explanations under 80 words.”

* **Few-shot examples**:

  * *User*: “Focus on EMEA and APAC.” → **Call** `set_filter(field="region", op="in", value=["EMEA","APAC"])`.
  * *User*: “Make it a bar chart by revenue.” → **Call** `change_encoding(chart="bar", x="region", y="revenue", aggregation="sum")`.
  * *User*: “What stands out in the selection?” → **Call** `summarize_selection(metrics=["count","mean","median"], compare_to="rest")`.

* **Structured outputs** (when no tool is needed):
  Ask for `{ title, bullets[], caveats[] }` to render stable insight cards.

---

## UX patterns for chat + viz

* **Dual feedback**: Apply UI change immediately and show a short narration (“Filtered to EMEA/APAC.”).
* **Inline affordances**: Each assistant message includes “Undo”, “Edit filter…”, and “Show SQL” (if applicable).
* **Command palette**: Mirror tool names/shortcuts so power users can invoke without chat.
* **Explain on hover**: Hovering a chip (filter/encoding) reveals the assistant’s explanation and the originating `operation_id`.

---

## MCP addendum (if you want portability)

Expose the same tools via an MCP server:

* **Tools**: identical JSON Schemas as above.
* **Resources** (optional): provide small previews (PNG bytes or HTML snippets) for hosts that render results inline.
* **Sessions**: map MCP client sessions to your `session_id`.
* **Security**: pass OAuth bearer tokens through MCP; validate scopes server-side.

This gives you “integrate once, use anywhere” across ChatGPT, IDEs, and other MCP-aware hosts.

---

## Testing & hardening checklist

* **Contracts**

  * [ ] JSON Schemas with `additionalProperties:false`
  * [ ] Golden conversations exercising each tool
  * [ ] Version conflict tests (duplicate/reordered operations)

* **Security**

  * [ ] Column/row ACL tests
  * [ ] Injection harness on `value` and free-text paths
  * [ ] Export scope enforcement

* **Performance**

  * [ ] p50/p95 latency SLOs & alerts
  * [ ] Dry-run estimates vs actuals within tolerance
  * [ ] Cache hit ratio tracked

* **Reliability**

  * [ ] Idempotency (replay `operation_id`)
  * [ ] Timeouts with graceful partials
  * [ ] Backpressure & rate limiting

---

## Putting it together: thin adapter architecture

```
[LLM/MCP Host]
      │
      ▼
[Intent Layer: JSON Schemas + Tool Router]
      │
      ├── validate/normalize args
      ├── authz (scopes, ACLs)
      ├── idempotency (operation_id)
      ├── state engine (state_version, diffs)
      ▼
[Domain Services: Query, Aggregation, Spec Builder]
      │
      ├── cache/tiles/cubes
      └── data connectors (DB/Warehouse/Vector)
      ▼
[Result: spec + diff + explanation]
```

This “intent layer” is the only new code you need to make your existing internals LLM-ready without a rewrite.

---

## Glossary (quick reference)

* **Intent**: High-level action that matches user language (e.g., “filter to EMEA”).
* **Tool**: A callable API function implementing an intent with a strict schema.
* **Idempotency**: Safe to retry; the state doesn’t double-change.
* **State version**: Monotonic counter guarding concurrent edits.
* **Diff**: Machine-readable delta between previous and new viz state.
* **Explanation**: Short human-readable description of the change/outcome.
* **MCP**: Model Context Protocol—a way to expose tools/resources to multiple LLM hosts.

---

### Final note

You don’t need to rebuild your app—**wrap it**. Start by mapping your current UI actions to 6–8 intent tools with strict schemas, add `state_version` + `operation_id`, return `diff + explanation`, and layer in introspection. From there, your app becomes usable by a chat copilot, agents, and (optionally) any MCP client with minimal ongoing glue. If you share your stack (language, charting lib, data sources), I can turn this into concrete schemas and a starter adapter for your codebase.
