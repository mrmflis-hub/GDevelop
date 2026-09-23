---
name: extend-with-js
description: Authoring JavaScript in a GDevelop project — JS code events inline in scenes, and events-based extension authoring (custom functions, objects, behaviors) including JS inside them. Load it when the task needs real code, custom objects/behaviors, or reusable functions.
---

# Extending a game with JS and extensions

## When JS beats events

- Use events first: they are inspected by the read tools, refactored by
  renames, and visible to the player-facing tooling.
- Reach for a JS code event when: math-heavy logic (vectors, interpolation),
  DOM/platform access, or porting an existing algorithm.
- Reach for an EXTENSION when logic must be REUSED (a custom behavior, a
  custom object, a shared action/expression) — `create_extension` then
  `create_custom_function` / `create_custom_object` /
  `create_custom_behavior`.

## JS code events (in a scene)

- A `JsCodeEvent` carries `inlineCode` + `parameterObjects`; author it in an
  `add_scene_events` batch (the EventScript writer accepts JS code events).
- Scope: `runtimeScene` (the scene), `objects` (the parameter objects, each
  a list of instances), and the global `gdjs` namespace.
- Read state via `objects[0].getX()`, `runtimeScene.getSceneName()`;
  mutate freely, but declare shared numbers as variables so they stay
  tunable and inspectable.

## Extension authoring pipeline

1. `create_extension` — the container (its name is the namespace).
2. Add the parts:
   - `create_custom_function` for free actions/conditions/expressions;
   - `create_custom_behavior` for attachable state + per-frame logic;
   - `create_custom_object` for reusable composed objects.
3. Author the BODIES as EventScript (`event_script` argument) — or put a JS
   code event inside them when events cannot express it. Behavior lifecycle
   names matter: `onCreated`, `onDestroyed`, `doStepPreEvents`… run at the
   right engine moments.
4. In functions, read the parameters in order (object lists, expressions);
   give each a `description` so the sentence in the events editor reads
   well (`sentence` with `_PARAM0_` placeholders).
5. Regeneration is automatic after your batch — but verify: read the
   function back, then exercise it (preview or gameplay test).

## Discipline

- `find_extension_usages` before any delete or rename; deletes are refused
  while used unless you pass `delete_even_if_used: true` (say so to the
  user before passing it).
- One extension per concern; name it after the mechanic, not the author.
- Properties are the extension's tunables: create them with
  `changed_properties`, read them in the function bodies.
- Verify JS like everything else: `start_preview`,
  `read_preview_logs`/`get_runtime_errors` for exceptions, and a gameplay
  test for behavior.
