# High-Level Command Orchestration for Hello 3D LLM via MCP

## 1. Overview

The current Hello 3D LLM integration exposes a set of **primitive tools** (functions) via MCP, such as:

* `change_model_color`
* `change_background_color`
* `set_key_light_intensity`
* `set_key_light_position`
* `set_fill_light_color`
* etc.

Each of these tools:

* Is called individually by ChatGPT.
* Requires **its own approval** in the client UI.
* Represents a low-level, graphics-oriented operation (change one parameter at a time).

You’d like to:

1. Control the scene using **high-level, domain-specific language** (e.g., photography studio metaphors: *dolly the camera*, *rotate the key light*, *warm up the scene*, *make it more dramatic*).
2. **Bundle multiple underlying operations** into a single “sentence” that:

   * Is expressed in natural language by the user.
   * Is translated by ChatGPT into a structured command.
   * Is parsed and executed on the MCP server as multiple low-level actions.
   * Appears as **one tool call / one approval** from ChatGPT’s perspective.

The key idea is to introduce a **high-level MCP tool** that accepts a “script” or “batch” representation of multiple actions, and to have ChatGPT translate user language into that representation.

---

## 2. Design Goals

1. **Single approval per compound operation**

   * Even if 10 low-level actions are executed, ChatGPT only makes a **single** MCP tool call.

2. **Domain-oriented commands**

   * Use photography/lighting/studio vocabulary (dolly, pan, tilt, rotate key, warm up, cool down, make it moodier, etc.).
   * Avoid exposing the user to raw function names like `set_fill_light_intensity`.

3. **Server-side orchestration**

   * The MCP server, not ChatGPT, is responsible for:

     * Parsing the script.
     * Executing multiple internal operations.
     * Managing state.

4. **Assistant-led mapping from natural language**

   * ChatGPT:

     * Interprets the user’s high-level, possibly ambiguous request.
     * Translates it into a **well-formed script** or **structured batch** that your MCP tool can parse.

---

## 3. Architecture

High-level data flow:

> User (studio language)
> → ChatGPT (maps to DSL / batch)
> → MCP tool: `execute_studio_command` (or similar)
> → MCP server parses script/batch
> → MCP server calls internal “verbs” or underlying primitives (e.g., model color, lights, camera)

### 3.1. Existing primitive tools (examples)

Already available primitives include (non-exhaustive):

* `change_model_color({ color })`
* `change_model_size({ size })`
* `scale_model({ x, y, z })`
* `change_background_color({ color })`
* `set_key_light_intensity({ intensity })`
* `set_key_light_position({ x, y, z })`
* `set_key_light_color({ color })`
* `set_key_light_size({ width, height })`
* `set_fill_light_intensity({ intensity })`
* `set_fill_light_position({ x, y, z })`
* `set_fill_light_color({ color })`
* `set_fill_light_size({ width, height })`

These are the **“atomic verbs”** of the scene.

### 3.2. New high-level tool

Introduce a new MCP tool such as:

* `execute_studio_command`

  * Accepts a single parameter, e.g. `script: string` (DSL approach)
    **or**
* `apply_scene_batch`

  * Accepts a structured `actions: [...]` array (JSON batch approach).

This tool encapsulates **multiple** low-level operations inside one MCP invocation.

---

## 4. Option A: Textual Studio DSL (“script”)

### 4.1. Tool definition (conceptual)

```json
{
  "name": "execute_studio_command",
  "description": "Execute a high-level photography-studio style scene command expressed in a custom DSL.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "script": {
        "type": "string",
        "description": "A sequence of Studio DSL commands, e.g. 'dollyCamera(distance:-1); rotateKey(deg:15); setModelColor(color:\"maroon\");'"
      }
    },
    "required": ["script"]
  }
}
```

### 4.2. Example DSL shapes

You define the DSL grammar. It could be code-like, for example:

```txt
dollyCamera(distance: -1.0);
panCamera(deg: 10);
tiltCamera(deg: -5);
setModelColor(color: "maroon");
setBackgroundColor(color: "midnight");
setKeyLight(
  intensity: 2.0,
  position: (2, 3, 5),
  color: "maraschino"
);
```

Or something even simpler:

```txt
model.color = maroon;
background.color = midnight;
key.intensity = 2.0;
key.position = (2, 3, 5);
key.color = maraschino;
```

You implement a parser for this on the MCP side, which then maps each DSL statement to internal low-level actions.

### 4.3. ChatGPT’s role

You instruct ChatGPT (via tool description + system prompt) roughly as:

* “When the user gives high-level photography studio instructions, translate them into the Studio DSL and put them in `script`.”

Example:

**User:**

> Dolly the camera back a bit, warm up the key light, and make the subject feel more maroon.

**ChatGPT → DSL:**

```txt
dollyCamera(distance: -1.0);
setKeyColor(color: "maraschino");
setModelColor(color: "maroon");
```

**ChatGPT → MCP tool call:**

```ts
execute_studio_command({
  script: 'dollyCamera(distance: -1.0); setKeyColor(color: "maraschino"); setModelColor(color: "maroon");'
});
```

From the UI perspective, the user approves **one** tool call. The MCP server then runs multiple internal operations.

---

## 5. Option B: JSON Batch of Actions

Instead of a textual DSL, you can define a **structured batch tool** that accepts an `actions` array.

### 5.1. Tool definition (conceptual)

```json
{
  "name": "apply_scene_batch",
  "description": "Apply a batch of scene modifications in one call.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "actions": {
        "type": "array",
        "items": {
          "type": "object",
          "oneOf": [
            {
              "properties": {
                "type": { "const": "change_model_color" },
                "color": { "type": "string" }
              },
              "required": ["type", "color"]
            },
            {
              "properties": {
                "type": { "const": "change_background_color" },
                "color": { "type": "string" }
              },
              "required": ["type", "color"]
            },
            {
              "properties": {
                "type": { "const": "set_key_light" },
                "intensity": { "type": "number" },
                "x": { "type": "number" },
                "y": { "type": "number" },
                "z": { "type": "number" }
              },
              "required": ["type"]
            }
            // Add others as needed...
          ]
        }
      }
    },
    "required": ["actions"]
  }
}
```

### 5.2. Example batch generated by ChatGPT

For the same user request:

**User:**

> Dolly the camera back a bit, warm up the key light, and make the subject feel more maroon.

You might define higher-level “action types” like `"dolly_camera"`, `"set_key_color"`, `"set_model_color"`.

**ChatGPT → batch:**

```json
{
  "actions": [
    { "type": "dolly_camera", "distance": -1.0 },
    { "type": "set_key_color", "color": "maraschino" },
    { "type": "set_model_color", "color": "maroon" }
  ]
}
```

The MCP server’s implementation of `apply_scene_batch`:

1. Iterates through `actions`.
2. Maps each action to one or more internal primitives (including existing Hello 3D LLM tools, if you’re layering on top of them).
3. Applies them in sequence.

Again, **one MCP tool call**, multiple effective operations.

---

## 6. Handling Ambiguity and Domain Language

A big part of what you want is:

> “I say: *make it more maroon / warm it up / make it moodier*, and ChatGPT figures out how to express that in the internal grammar.”

This is feasible if:

1. You define explicit mapping rules in your documentation/prompts, such as:

   * “Warm up the key light” → `setKeyColor` with a warm color (`maraschino`, `tangerine`, `lemon`).
   * “Cool down the light” → a cooler color (`sky`, `aqua`, `blueberry`).
   * “More maroon” → `setModelColor("maroon")` or adjust towards maroon.

2. You define **numeric heuristics** for phrases like:

   * “a bit more” → increase/decrease by +0.2
   * “a lot more” → +0.5
   * “slightly dimmer” → −0.2 intensity, min 0

Examples:

* “Brighten the key light a bit”
  → `setKeyIntensity(intensity: current + 0.2)` (if you expose state / rules for me to use, or pick a default like 1.2)

* “Make it more dramatic”
  → you can define a pattern like:

  ```txt
  increase key-light intensity,
  decrease fill-light intensity,
  darken background
  ```

  which I can encode as a DSL snippet or batch with fixed values.

The more explicit you are about these conventions in the tool description and system instructions, the more consistently I can generate the right DSL / batch.

---

## 7. Approvals and User Experience

Today:

* 3 primitive changes ⇒ 3 tool calls ⇒ 3 approvals.

With the high-level tool:

* 3 conceptual changes ⇒ 1 DSL or batch ⇒ 1 tool call ⇒ 1 approval.

Under the hood, your MCP server may still perform multiple low-level actions—but the **approval boundary** is the high-level MCP tool (`execute_studio_command` or `apply_scene_batch`), not each internal primitive.

From the user’s perspective:

1. They say a **single, domain-level sentence**.
2. ChatGPT confirms what it’s about to do (optional but helpful).
3. The client shows a **single approval prompt** for the high-level tool.
4. The scene updates with all the requested changes.

---

## 8. Implementation Checklist

When you implement this approach, you’ll want to:

1. **Design the “Studio” representation**

   * Choose between:

     * **Textual DSL** (`script: string`).
     * **JSON batch** (`actions: [...]`).
   * Define the available commands / action types (dolly, pan, tilt, key/fill operations, model/background color, etc.).
   * Decide on default units and ranges.

2. **Implement a parser / interpreter on the MCP server**

   * For textual DSL: parse the script into an AST or structured list of operations.
   * For JSON batch: validate and dispatch actions.
   * Map each logical action to:

     * Internal engine calls, or
     * Existing Hello 3D LLM primitives.

3. **Define translation rules for ChatGPT**

   * In the MCP tool’s `description` and/or system instructions, specify:

     * The DSL syntax or batch schema.
     * Examples of natural language → DSL/batch mappings.
     * Behavior for key phrases (“warm up”, “cool down”, “more dramatic”, “more maroon”, “dolly in/out a bit”, etc.).

4. **Add examples**

   * Provide few-shot examples in the description, such as:

     * *User*: “Make the subject feel more dramatic, with a darker background and a hotter key light.”
       *Assistant*: `execute_studio_command({ script: 'setBackgroundColor("midnight"); setKeyIntensity(2.0); setFillIntensity(0.3);' })`

5. **Iterate on the domain vocabulary**

   * Gradually expand the set of domain verbs to match how you and other users naturally speak about photography and lighting.

---

If you’d like, I can next help you:

* Sketch a concrete first version of the Studio DSL (with a mini “grammar spec”), or
* Design the initial `actions` schema for the JSON batch approach, including some ready-to-use examples you can plug into your MCP server.
