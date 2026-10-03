---
name: extend-with-js
description: Authoring JavaScript in a GDevelop project — events-based extension authoring (custom functions, objects, behaviors) including JS inside them, and where real runtime code belongs (the game code folder). Load it when the task needs real code, custom objects/behaviors, or reusable functions.
---

# Extending a game with JS and extensions

## When JS beats events

- Use events first: they are inspected by the read tools, refactored by
  renames, and visible to the player-facing tooling.
- Reach for a GAME CODE FILE when: math-heavy logic (vectors,
  interpolation), DOM/platform access, or porting an existing algorithm —
  see load_skill("game-code-authoring") (the `<GameName>Code/` folder and
  its write_game_code_file tool).
- Reach for an EXTENSION when logic must be REUSED (a custom behavior, a
  custom object, a shared action/expression) — `create_extension` then
  `create_custom_function` / `create_custom_object` /
  `create_custom_behavior`.

## JS code events (the limit of EventScript)

- JS code events exist in the editor, but EventScript CANNOT author them:
  the grammar has no JsCode event, so `add_scene_events` will refuse one.
  To run JavaScript right now, use the run_script tool (it can call the
  other tools); for code that must ship with the game, write a game code
  file (`write_game_code_file`, load_skill("game-code-authoring")).
- Extension function bodies are events too: author them in EventScript —
  there is no JS-code-event syntax for them either.

## Extension authoring pipeline

1. `create_extension` — the container (its name is the namespace).
2. Add the parts:
   - `create_custom_function` for free actions/conditions/expressions;
   - `create_custom_behavior` for attachable state + per-frame logic;
   - `create_custom_object` for reusable composed objects.
3. Author the BODIES as EventScript (`event_script` argument). Behavior
   lifecycle names matter: `onCreated`, `onDestroyed`, `doStepPreEvents`…
   run at the right engine moments.
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
