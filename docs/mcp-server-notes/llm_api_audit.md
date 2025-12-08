# LLM-Readiness API Audit Framework

## Overview

This document provides a systematic approach to auditing and transforming an existing data visualization API to be LLM-aware. The goal is to move from click-based, imperative operations to intent-based, declarative interactions that LLMs can reliably use.

**Estimated timeline**: 3-5 days for full audit + prioritization  
**Expected outcome**: Roadmap of API changes categorized by effort and impact

---

## Phase 1: Inventory & Classification (1-2 days)

### Goal
Understand what you have before deciding what to change.

### Step 1: List All Current Endpoints/Methods

Create a spreadsheet with the following columns:

| Column | Description | Example |
|--------|-------------|---------|
| **Endpoint/Method** | Full path or function name | `POST /api/viz/filter` |
| **HTTP Verb** | GET, POST, PUT, DELETE, etc. | `POST` |
| **Primary Purpose** | In user language, not technical terms | "Filter data to show only matching rows" |
| **Parameters** | Name, type, required/optional | `field: string (required), value: any (required)` |
| **Return Shape** | Brief description or type | `{success: boolean, rowCount: number}` |
| **Side Effects** | Reads only? Writes state? External calls? | "Modifies active filter state" |
| **Usage Frequency** | From telemetry if available | "~500 calls/day" |

### Step 2: Classify by "LLM-Friendliness"

For each endpoint, score it on these five dimensions:

#### A. Semantic Clarity
*Can an LLM infer purpose from name and parameters?*

- ✅ **Green**: `setFilter(field, operator, value)` - self-documenting
- ⚠️ **Yellow**: `updateView(config)` - vague, needs inspection of `config` shape
- ❌ **Red**: `handleAction(type, payload)` - totally opaque dispatch pattern

#### B. Granularity
*Is it one clear intent or a multi-tool?*

- ✅ **Green**: Single responsibility (filter XOR encoding XOR export)
- ⚠️ **Yellow**: Does 2-3 related things
- ❌ **Red**: Kitchen-sink method with mode flags

#### C. State Coupling
*Can it work with explicit state, or does it rely on hidden context?*

- ✅ **Green**: Pure function or accepts explicit state
- ⚠️ **Yellow**: Reads some shared state but could be passed
- ❌ **Red**: Deeply coupled to global mutable state

#### D. Error Handling
*Are failures actionable?*

- ✅ **Green**: Returns structured errors with codes and hints
- ⚠️ **Yellow**: Returns generic messages
- ❌ **Red**: Throws strings or swallows errors

#### E. Idempotency
*Safe to retry?*

- ✅ **Green**: Already idempotent or has dedup key
- ⚠️ **Yellow**: Idempotent by accident (overwrites)
- ❌ **Red**: Accumulates (adds to array, increments counter)

### Step 3: Map to User Intents

For each endpoint, write the **user sentence** it serves:

- `GET /fields` → *"What columns are available?"*
- `POST /filter` → *"Show only rows where [condition]"*
- `PUT /chart-type` → *"Make it a bar chart"*

**Red flag**: If you can't write a natural sentence, the endpoint is probably too low-level.

---

## Phase 2: Gap Analysis (half day)

Compare your inventory to LLM-readiness requirements. Look for these critical gaps:

### 1. Missing Introspection
**Problem**: No way to ask "what fields exist?" or "what chart types are supported?"  
**Impact**: LLMs will hallucinate field names and capabilities  
**Fix**: Add `GET /schema/fields`, `GET /capabilities`

### 2. No Version/Conflict Detection
**Problem**: Concurrent edits silently overwrite each other  
**Impact**: Race conditions in multi-turn conversations or collaborative contexts  
**Fix**: Add `state_version` parameter to all writes; return 409 on conflict

### 3. No Operation Deduplication
**Problem**: Retrying a filter adds it twice  
**Impact**: Network errors cause duplicate operations  
**Fix**: Add `operation_id` parameter; track processed IDs

### 4. Imperative Composition
**Problem**: Must call `selectRows` → `getSelection` → `computeStats` (3 round-trips)  
**Impact**: Slow, brittle multi-step sequences  
**Fix**: Add `summarize_selection` that does all three atomically

### 5. Weak Contracts
**Problem**: Parameters like `config: any` or optional enums without defaults  
**Impact**: LLMs guess incorrectly, leading to errors  
**Fix**: Tighten schemas; make enums exhaustive; add `additionalProperties: false`

### 6. Silent Failures
**Problem**: Invalid field names return empty results instead of errors  
**Impact**: LLMs can't tell if they made a mistake  
**Fix**: Validate field names against schema; return `unknown_field` error with suggestions

### 7. No Dry-Run Mode
**Problem**: Can't preview cost/rows affected before committing  
**Impact**: Expensive operations run blindly  
**Fix**: Add `dry_run: boolean` parameter to expensive operations

---

## Phase 3: Migration Triage (half day)

Categorize your endpoints into **four buckets**:

### Bucket A: Ship As-Is (0-10% effort)
**Criteria**: Already LLM-friendly. Just add JSON Schema docs.

**Example**: `GET /fields` that returns `{name, type, cardinality}[]`

**Action Items**:
- Write JSON Schema documentation
- Add to API specification
- Test with sample LLM prompts

---

### Bucket B: Augment (10-30% effort)
**Criteria**: Core logic is fine; add LLM-readiness features around it.

**Changes Needed**:
- Add `state_version` + `operation_id` parameters
- Return `{result, diff, explanation}` instead of just `result`
- Add `dry_run` flag
- Improve error messages with codes and hints

**Example**: Existing `POST /filter` becomes:
```typescript
// Before
POST /filter { field: string, value: any }
→ { success: boolean }

// After
POST /filter {
  session_id: string,
  state_version: number,
  operation_id: string,
  field: string,
  op: "=" | "!=" | ">" | "<" | "in",
  value: string | number | any[],
  dry_run?: boolean
}
→ {
  new_state_version: number,
  diff: { filters: [...] },
  explanation: string,
  telemetry: { rows_affected: number }
}
```

---

### Bucket C: Wrap (30-60% effort)
**Criteria**: Current endpoint is too low-level; create new intent-based wrapper.

**Approach**:
- Keep existing endpoint for UI backward compatibility
- New endpoint composes 2-3 old ones into single intent
- Document the mapping between old and new

**Example**: `summarize_selection` wraps `getSelection` + `computeStats`

---

### Bucket D: Rethink (60-100% effort)
**Criteria**: Fundamentally incompatible with LLM usage; needs redesign.

**Examples**:
- `POST /action` with `{type: string, payload: any}` (generic dispatch)
- Streaming WebSocket API with no request/response pairs
- Endpoints that require multi-step setup with hidden dependencies

**Recommendation**: Defer until Buckets A-C are complete. These are longer-term refactors.

---

## Phase 4: Schema Definition (1-2 days)

For all Bucket A/B/C endpoints, write **JSON Schemas** following these rules:

### Critical Requirements

```json
{
  "type": "object",
  "additionalProperties": false,  // ← CRITICAL: Reject unknown fields
  "properties": {
    "session_id": {
      "type": "string",
      "description": "Unique session identifier"
    },
    "state_version": {
      "type": "integer",
      "minimum": 0,
      "description": "Current state version for optimistic locking"
    },
    "operation_id": {
      "type": "string",
      "description": "Unique operation ID for idempotency"
    },
    "field": {
      "type": "string",
      "description": "Field name from the dataset schema"
    },
    "op": {
      "type": "string",
      "enum": ["=", "!=", ">", "<", ">=", "<=", "in", "between"],
      "description": "Comparison operator"
    },
    "value": {
      "oneOf": [
        {"type": "string"},
        {"type": "number"},
        {"type": "array", "items": {}}
      ],
      "description": "Value(s) to filter by"
    }
  },
  "required": ["session_id", "state_version", "operation_id", "field", "op", "value"]
}
```

### Best Practices

- ✅ Use `enum` for any constrained string (operators, chart types, aggregations)
- ✅ Mark all non-optional fields as `required`
- ✅ Add `description` to every property (LLMs read these!)
- ✅ Use `oneOf` for polymorphic values
- ✅ Set `additionalProperties: false` to catch typos/hallucinations
- ✅ Include examples in descriptions

---

## Phase 5: Response Standardization (1 day)

### Write Responses

All endpoints that modify state should return:

```typescript
interface WriteResponse<T> {
  // Core result
  new_state_version: number;
  spec: T;  // Your viz spec (Vega-Lite, custom, etc.)
  
  // LLM-friendly additions
  diff: Diff;  // Machine-readable delta
  explanation: string;  // Human-readable summary (50-80 words max)
  
  // Telemetry (optional but helpful)
  telemetry?: {
    rows_affected?: number;
    elapsed_ms: number;
    cache_hit?: boolean;
  };
}

interface Diff {
  filters?: Array<{
    added?: Filter;
    removed?: Filter;
    changed?: {old: Filter; new: Filter};
  }>;
  encodings?: Array<{
    changed?: Encoding;
  }>;
  selection?: {
    set?: Selection;
    cleared?: boolean;
  };
}
```

### Error Responses

All errors should return:

```typescript
interface ErrorResponse {
  error: {
    code: ErrorCode;  // Enum of known errors
    message: string;
    hint?: string;  // Optional guidance
    suggested_fixes?: Array<{
      action: string;  // Tool name to call
      args?: Record<string, unknown>;  // Pre-filled arguments
    }>;
    alternatives?: string[];  // e.g., field name suggestions
  }
}
```

### Example Error Codes

```typescript
type ErrorCode =
  | "unknown_field"
  | "invalid_operator"
  | "value_out_of_range"
  | "not_authorized"
  | "too_expensive"
  | "version_conflict"
  | "timeout"
  | "rate_limited";
```

### Example Error Response

```json
{
  "error": {
    "code": "unknown_field",
    "message": "Field 'revenu' not found in dataset.",
    "hint": "Did you mean 'revenue'?",
    "suggested_fixes": [
      {
        "action": "retry",
        "args": {"field": "revenue"}
      },
      {
        "action": "describe_fields"
      }
    ],
    "alternatives": ["revenue", "revenue_usd", "rev_per_user"]
  }
}
```

---

## Practical Audit Questions

As you review each endpoint, ask:

### 1. Can I describe this in one user sentence?
If not, it's too low-level or does too much.

### 2. What happens if I call this twice with the same args?
If the answer isn't "nothing" or "conflict error", it's not idempotent.

### 3. If this fails, can the LLM recover without asking the user?
If not, your error needs `suggested_fixes`.

### 4. Does this require secret knowledge?
(e.g., "you must call A before B"). If yes, compose them into one tool.

### 5. Can I dry-run this?
If it's expensive (time/cost/rows), add `dry_run: true`.

### 6. Does this expose fields the LLM shouldn't hallucinate?
If yes, add introspection so it can look them up.

---

## Red Flags That Demand Immediate Attention

- ❌ **Any endpoint that accepts arbitrary SQL/code** → Security nightmare; replace with constrained filters
- ❌ **Endpoints that modify state without version checks** → Race conditions; add `state_version` immediately
- ❌ **Generic error messages** ("Invalid request") → LLMs will loop; add error codes + hints
- ❌ **Implicit session state** (relies on cookies/localStorage) → Won't work in agent/MCP contexts; make state explicit
- ❌ **No field/capability introspection** → LLMs will hallucinate; add discovery endpoints

---

## Expected Deliverables

After completing the audit, you should have:

✅ **Complete inventory spreadsheet** with LLM-friendliness scores  
✅ **Categorized endpoint list** (Buckets A/B/C/D with effort estimates)  
✅ **JSON Schemas** for all Bucket A/B endpoints  
✅ **Migration plan** prioritizing high-value, low-effort changes  
✅ **Error code catalog** with suggested fixes  
✅ **Prototype introspection endpoints** (`describe_fields`, `describe_capabilities`)

---

## Recommended Approach

### Week 1: Sample Audit (1 day)
Pick 5-10 representative endpoints (mix of read/write, simple/complex) and run them through Phases 1-3. This will:
1. Validate the approach
2. Surface patterns (e.g., "80% of our endpoints have the same gap")
3. Give you effort estimates for the full audit

### Week 2: Full Audit (2-3 days)
Complete Phases 1-3 for all endpoints. Present findings to the team.

### Week 3: Schema & Standards (2 days)
Complete Phases 4-5 for high-priority endpoints (Buckets A & B).

### Week 4+: Implementation
Begin rolling out changes, starting with Bucket A (quick wins).

---

## Success Criteria

You'll know the audit is complete when you can answer:

1. **How many endpoints are LLM-ready today?** (Bucket A count)
2. **What's the critical path to an LLM-powered MVP?** (Bucket A + highest-value Bucket B items)
3. **What's the long-term refactor backlog?** (Bucket C + D items)
4. **What are our biggest risks?** (Red flags identified and prioritized)
5. **Do we have introspection coverage?** (Can LLMs discover fields, capabilities, constraints?)

---

## Questions or Need Help?

If you encounter edge cases or need clarification on scoring, bring specific endpoint examples to the team and we'll work through them together. The goal is pragmatic progress, not perfection—start shipping LLM-friendly endpoints incrementally rather than waiting for a complete transformation.