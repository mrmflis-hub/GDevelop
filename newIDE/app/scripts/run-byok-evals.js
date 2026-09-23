/**
 * The BYOK dev-only eval harness (Phase 9.8): ~30 real game-building tasks
 * scored mechanically, runnable on demand against any configured endpoint.
 * The instrument that tells whether a prompt/skill/tool change actually
 * helped — eval-driven tool development.
 *
 * This file lives OUTSIDE `src/`, so nothing of it enters the shipped app
 * bundle; `src/AiGeneration/Byok/evals/` holds its Jest self-check and is
 * dev-only by the same rule (no app module imports it — asserted by a test).
 *
 * Static-eval mode: the model is asked to answer with the tool calls it
 * *would* make, as strict JSON. The scorers then verify the outcome encoded
 * in those arguments (event structure, instance geometry, variable shapes,
 * code properties, repair coordinates) — no editor needed, so the suite runs
 * anywhere the endpoint is reachable. An LLM-as-judge pass is optional and
 * flagged as such in the report when enabled.
 *
 * Usage:
 *   node scripts/run-byok-evals.js --endpoint https://api.openai.com/v1 \
 *        --key sk-... --model gpt-4o [--judge-model gpt-4o] [--out REVIEW/evals]
 *
 * Report lines track the four numbers that matter per task:
 * pass/fail, rounds, tool calls, tokens.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ----------------------------------------------------------------------
// The task suite.
// ----------------------------------------------------------------------

/**
 * One eval task. `scorer` receives the parsed model answer
 * `{ answerText, toolCalls }` and returns `{ passed, reason }`.
 */
const makeTask = (id, category, prompt, scorer) => ({
  id,
  category,
  prompt,
  scorer,
});

// Small assertion helpers shared by the scorers.
const findToolCall = (result, name) =>
  result.toolCalls.find(call => call.name === name) || null;

const collectToolCall = (result, name) => {
  const calls = result.toolCalls.filter(call => call.name === name);
  return calls.length > 0 ? calls[0] : null;
};

const parseArgs = call => {
  if (!call) return null;
  if (call.arguments && typeof call.arguments === 'object') {
    return call.arguments;
  }
  try {
    return JSON.parse(call.arguments);
  } catch (error) {
    return null;
  }
};

const fail = reason => ({ passed: false, reason });
const pass = reason => ({ passed: true, reason });

/** Search a JSON structure for any string value containing the fragment. */
const jsonContainsFragment = (value, fragment) => {
  if (typeof value === 'string') return value.includes(fragment);
  if (Array.isArray(value)) {
    return value.some(entry => jsonContainsFragment(entry, fragment));
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).some(key =>
      jsonContainsFragment(value[key], fragment)
    );
  }
  return false;
};

// ---- Event-logic tasks (10): the model writes event batches. ----

const eventBatchHasStandardEvent = (args, conditionFragment, actionFragment) => {
  const batches = args && Array.isArray(args.event_batches)
    ? args.event_batches
    : args && args.events
    ? args.events
    : null;
  if (!batches) return fail('No event_batches found in the arguments.');
  const serialized = JSON.stringify(batches);
  if (conditionFragment && !serialized.includes(conditionFragment)) {
    return fail(`Missing condition marker "${conditionFragment}".`);
  }
  if (actionFragment && !serialized.includes(actionFragment)) {
    return fail(`Missing action marker "${actionFragment}".`);
  }
  return pass('Event batch carries the expected condition and action.');
};

const eventLogicScorers = {
  'coin-spawner-every-3s': result => {
    const call = collectToolCall(result, 'add_scene_events');
    const args = parseArgs(call);
    if (!args) return fail('No add_scene_events call found.');
    const check = eventBatchHasStandardEvent(args, 'Timer', 'CreerObjet');
    if (!check.passed) return check;
    if (!jsonContainsFragment(args, 'Coin')) return fail('No "Coin" created.');
    return pass('Timer condition and coin creation present.');
  },
  'player-movement-8-directions': result => {
    const args = parseArgs(collectToolCall(result, 'add_scene_events'));
    if (!args) return fail('No add_scene_events call found.');
    const check = eventBatchHasStandardEvent(args, 'Force', null);
    return check.passed
      ? pass('Forces applied for movement.')
      : check;
  },
  'enemy-patrol-left-right': result => {
    const args = parseArgs(collectToolCall(result, 'add_scene_events'));
    if (!args) return fail('No add_scene_events call found.');
    const serialized = JSON.stringify(args);
    if (!serialized.includes('Force')) return fail('No force-based movement.');
    if (!serialized.includes('XDirection')) return fail('No XDirection flip.');
    return pass('Patrol with direction flip described.');
  },
  'jump-when-space-pressed': result => {
    const args = parseArgs(collectToolCall(result, 'add_scene_events'));
    if (!args) return fail('No add_scene_events call found.');
    const check = eventBatchHasStandardEvent(args, 'Key', 'Force');
    return check;
  },
  'damage-on-collision': result => {
    const args = parseArgs(collectToolCall(result, 'add_scene_events'));
    if (!args) return fail('No add_scene_events call found.');
    const check = eventBatchHasStandardEvent(args, 'Collision', 'Variable');
    return check;
  },
  'score-increases-on-pickup': result => {
    const args = parseArgs(collectToolCall(result, 'add_scene_events'));
    if (!args) return fail('No add_scene_events call found.');
    const check = eventBatchHasStandardEvent(args, 'Collision', 'Score');
    return check;
  },
  'timer-based-difficulty-ramp': result => {
    const args = parseArgs(collectToolCall(result, 'add_scene_events'));
    if (!args) return fail('No add_scene_events call found.');
    const check = eventBatchHasStandardEvent(args, 'Timer', null);
    if (!check.passed) return check;
    if (!jsonContainsFragment(args, 'ResetTimer')) {
      return fail('The timer is never reset (event would fire every frame).');
    }
    return pass('Timer condition with reset present.');
  },
  'delete-object-when-offscreen': result => {
    const args = parseArgs(collectToolCall(result, 'add_scene_events'));
    if (!args) return fail('No add_scene_events call found.');
    const check = eventBatchHasStandardEvent(
      args,
      'DepartDeLaScene',
      'Supprimer'
    );
    return check;
  },
  'scene-change-on-goal': result => {
    const args = parseArgs(collectToolCall(result, 'add_scene_events'));
    if (!args) return fail('No add_scene_events call found.');
    const check = eventBatchHasStandardEvent(args, 'Collision', 'ChangeScene');
    return check;
  },
  'while-loop-spawn-grid': result => {
    const args = parseArgs(collectToolCall(result, 'add_scene_events'));
    if (!args) return fail('No add_scene_events call found.');
    const serialized = JSON.stringify(args);
    if (!serialized.includes('While')) return fail('No "While" event used.');
    if (!jsonContainsFragment(args, 'CreerObjet')) {
      return fail('No object creation inside the while loop.');
    }
    return pass('While loop with creation present.');
  },
};

// ---- Layout/spatial tasks (5): instance grids scored numerically. ----

/**
 * Assert the put_2d_instances arguments describe rows×columns instances on
 * an even grid starting at (startX, startY) with the given spacing.
 */
const scoreGridPlacement = (result, expected, spacingTolerance = 0.01) => {
  const call = collectToolCall(result, 'put_2d_instances');
  const args = parseArgs(call);
  if (!args) return fail('No put_2d_instances call found.');
  const instances = Array.isArray(args.instances)
    ? args.instances
    : Array.isArray(args.positions)
    ? args.positions
    : null;
  if (!instances) return fail('No instances/positions list in arguments.');
  if (instances.length !== expected.rows * expected.columns) {
    return fail(
      `Expected ${expected.rows * expected.columns} instances, got ${instances.length}.`
    );
  }
  const sortedX = instances
    .map(instance => Number(instance.x))
    .sort((a, b) => a - b);
  const distinctX = [...new Set(sortedX)];
  if (distinctX.length !== expected.columns) {
    return fail(
      `Expected ${expected.columns} distinct x positions, got ${distinctX.length}.`
    );
  }
  for (let index = 1; index < distinctX.length; index++) {
    const spacing = distinctX[index] - distinctX[index - 1];
    if (Math.abs(spacing - expected.spacingX) > spacingTolerance) {
      return fail(
        `Uneven x spacing: ${spacing} instead of ${expected.spacingX}.`
      );
    }
  }
  const sortedY = instances
    .map(instance => Number(instance.y))
    .sort((a, b) => a - b);
  const distinctY = [...new Set(sortedY)];
  if (distinctY.length !== expected.rows) {
    return fail(
      `Expected ${expected.rows} distinct y positions, got ${distinctY.length}.`
    );
  }
  for (let index = 1; index < distinctY.length; index++) {
    const spacing = distinctY[index] - distinctY[index - 1];
    if (Math.abs(spacing - expected.spacingY) > spacingTolerance) {
      return fail(
        `Uneven y spacing: ${spacing} instead of ${expected.spacingY}.`
      );
    }
  }
  return pass('A perfectly even grid.');
};

const layoutScorers = {
  'grid-5x5-platform': result =>
    scoreGridPlacement(result, { rows: 5, columns: 5, spacingX: 128, spacingY: 128 }),
  'wall-of-3x8-bricks': result =>
    scoreGridPlacement(result, { rows: 8, columns: 3, spacingX: 64, spacingY: 64 }),
  'row-of-6-lamps': result =>
    scoreGridPlacement(result, { rows: 1, columns: 6, spacingX: 200, spacingY: 0 }),
  'two-by-two-turrets': result =>
    scoreGridPlacement(result, { rows: 2, columns: 2, spacingX: 300, spacingY: 300 }),
  'stairs-of-4-platforms': result => {
    const call = collectToolCall(result, 'put_2d_instances');
    const args = parseArgs(call);
    if (!args) return fail('No put_2d_instances call found.');
    const instances = Array.isArray(args.instances)
      ? args.instances
      : Array.isArray(args.positions)
      ? args.positions
      : null;
    if (!instances || instances.length !== 4) {
      return fail('Expected 4 instances.');
    }
    const sorted = instances
      .map(instance => ({ x: Number(instance.x), y: Number(instance.y) }))
      .sort((a, b) => a.x - b.x);
    for (let index = 1; index < sorted.length; index++) {
      if (sorted[index].y >= sorted[index - 1].y) {
        return fail('Each platform must be higher (smaller y) than the previous one.');
      }
    }
    return pass('Four ascending platforms.');
  },
};

// ---- Variables/properties tasks (5): variable shapes. ----

const scoreVariable = (result, predicate, successReason) => {
  const call = collectToolCall(result, 'add_or_edit_variable');
  const args = parseArgs(call);
  if (!args) return fail('No add_or_edit_variable call found.');
  return predicate(args) ? pass(successReason) : fail('Variable arguments do not match the request.');
};

const variableScorers = {
  'global-score-number': result =>
    scoreVariable(
      result,
      args =>
        args.variable_name === 'Score' &&
        (!args.variable_type || args.variable_type === 'number'),
      'A numeric Score variable.'
    ),
  'scene-health-variable': result =>
    scoreVariable(
      result,
      args => args.variable_name === 'Health' && Number(args.initial_value) === 3,
      'Health starts at 3.'
    ),
  'player-structure-variable': result =>
    scoreVariable(
      result,
      args => args.variable_name === 'Inventory' && args.variable_type === 'structure',
      'An Inventory structure.'
    ),
  'object-ammo-variable': result =>
    scoreVariable(
      result,
      args => args.variable_name === 'Ammo' && !!args.object_name,
      'An object-scoped Ammo variable.'
    ),
  'boolean-has-key': result =>
    scoreVariable(
      result,
      args =>
        args.variable_name === 'HasKey' &&
        (args.initial_value === true || args.initial_value === 'true' || args.initial_value === 1),
      'HasKey is truthy by default.'
    ),
};

// ---- JS/extension tasks (5): produced code asserted statically. ----

const scoreJsCode = (result, requiredFragments) => {
  const text = result.answerText || '';
  const runScript = collectToolCall(result, 'run_script');
  const code = text + (runScript ? JSON.stringify(parseArgs(runScript) || '') : '');
  for (const fragment of requiredFragments) {
    if (!code.includes(fragment)) {
      return fail(`The code misses "${fragment}".`);
    }
  }
  return pass('All required API usages present.');
};

const jsScorers = {
  'js-spawn-every-seconds': result =>
    scoreJsCode(result, ['runtimeScene', 'getObjects', 'TimedTask']),
  'js-read-object-position': result =>
    scoreJsCode(result, ['getX()', 'getY()']),
  'js-change-scene': result =>
    scoreJsCode(result, ['runtimeScene', 'getSceneStack', 'push']),
  'extension-action-with-expression': result =>
    scoreJsCode(result, ['extension', 'addAction']),
  'js-camera-follow': result =>
    scoreJsCode(result, ['getCamera', 'setX']),
};

// ---- Perception-repair tasks (5): overlapping HUD fixtures. ----

/**
 * The fixture: two HUD objects declared at the same spot; the model must
 * move the score display to the described corner via set_instance_position
 * (or put_2d_instances) so the rectangles no longer overlap.
 */
const scoreHudRepair = (result, target) => {
  const call =
    collectToolCall(result, 'set_instance_position') ||
    collectToolCall(result, 'put_2d_instances');
  const args = parseArgs(call);
  if (!args) return fail('No repositioning tool call found.');
  const serialized = JSON.stringify(args);
  if (!serialized.includes(target.objectName)) {
    return fail(`The ${target.objectName} was not moved.`);
  }
  const x = Number(args.x);
  const y = Number(args.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return fail('No numeric target position.');
  }
  const overlaps =
    Math.abs(x - target.overlappingWith.x) < target.size &&
    Math.abs(y - target.overlappingWith.y) < target.size;
  if (overlaps) return fail('The new position still overlaps the other HUD object.');
  return pass(`The HUD object moved clear of the overlap.`);
};

const perceptionScorers = {
  'hud-score-overlaps-button': result =>
    scoreHudRepair(result, {
      objectName: 'ScoreText',
      size: 64,
      overlappingWith: { x: 20, y: 20 },
    }),
  'health-bar-overlaps-minimap': result =>
    scoreHudRepair(result, {
      objectName: 'HealthBar',
      size: 64,
      overlappingWith: { x: 400, y: 20 },
    }),
  'joystick-overlaps-jump-button': result =>
    scoreHudRepair(result, {
      objectName: 'JumpButton',
      size: 80,
      overlappingWith: { x: 60, y: 400 },
    }),
  'quest-text-overlaps-inventory': result =>
    scoreHudRepair(result, {
      objectName: 'QuestText',
      size: 100,
      overlappingWith: { x: 200, y: 150 },
    }),
  'boss-bar-overlaps-score': result =>
    scoreHudRepair(result, {
      objectName: 'BossBar',
      size: 64,
      overlappingWith: { x: 320, y: 30 },
    }),
};

const ALL_SCORERS = {
  'event-logic': eventLogicScorers,
  layout: layoutScorers,
  variables: variableScorers,
  'js-extension': jsScorers,
  'perception-repair': perceptionScorers,
};

const tasks = Object.keys(ALL_SCORERS)
  .map(category => Object.keys(ALL_SCORERS[category]).map(id => ({ id, category })))
  .reduce((all, entries) => all.concat(entries), [])
  .map(({ id, category }) =>
    makeTask(id, category, buildPromptForTask(id, category), result =>
      ALL_SCORERS[category][id](result)
    )
  );

/**
 * The task prompt: describes the goal and fixes the answer contract (the
 * strict JSON envelope the runner parses).
 */
function buildPromptForTask(id, category) {
  const envelope =
    'Answer with strict JSON only: {"tool_calls": [{"name": "<tool name>", ' +
    '"arguments": {…}}]} — the arguments must be complete and valid.';
  const prompts = require('./byok-eval-task-prompts');
  const prompt = prompts[id] || `Task ${id} (category ${category}).`;
  return `${prompt}\n\n${envelope}`;
}

// ----------------------------------------------------------------------
// The runner.
// ----------------------------------------------------------------------

/**
 * Parse the model's answer into the scorer input. Tolerant to code fences.
 */
function parseEvalAnswer(answerText) {
  let text = String(answerText || '').trim();
  const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fenceMatch) text = fenceMatch[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return { answerText: String(answerText || ''), toolCalls: [] };
  }
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    const toolCalls = Array.isArray(parsed.tool_calls)
      ? parsed.tool_calls
          .filter(call => call && typeof call.name === 'string')
          .map(call => ({
            name: call.name,
            arguments: call.arguments === undefined ? {} : call.arguments,
          }))
      : [];
    return { answerText: String(answerText || ''), toolCalls };
  } catch (error) {
    return { answerText: String(answerText || ''), toolCalls: [] };
  }
}

/**
 * Run one task against an endpoint. `sendCompletion` is injected so the
 * suite is testable without a network; the CLI builds it on axios.
 */
async function runEvalTask(task, sendCompletion) {
  const messages = [
    {
      role: 'system',
      content:
        'You complete GDevelop game-building tasks. You answer with the exact JSON envelope requested.',
    },
    { role: 'user', content: task.prompt },
  ];
  const response = await sendCompletion({ messages });
  const choice = response.choices && response.choices[0];
  const answerText =
    choice && choice.message && typeof choice.message.content === 'string'
      ? choice.message.content
      : '';
  const tokens =
    response.usage && typeof response.usage.total_tokens === 'number'
      ? response.usage.total_tokens
      : 0;
  const parsed = parseEvalAnswer(answerText);
  const score = task.scorer(parsed);
  return {
    taskId: task.id,
    category: task.category,
    passed: score.passed,
    reason: score.reason,
    rounds: 1,
    toolCalls: parsed.toolCalls.length,
    tokens,
  };
}

/**
 * The harness self-check: a trivially-passing and a trivially-failing task
 * both score correctly (this is what the Jest suite exercises).
 */
function makeSelfCheckTasks() {
  const passing = makeTask('self-check-pass', 'event-logic', 'always pass', () =>
    pass('by construction')
  );
  const failing = makeTask('self-check-fail', 'event-logic', 'always fail', () =>
    fail('by construction')
  );
  return { passing, failing };
}

function runSelfCheck() {
  const { passing, failing } = makeSelfCheckTasks();
  const passingResult = passing.scorer({ answerText: '', toolCalls: [] });
  const failingResult = failing.scorer({ answerText: '', toolCalls: [] });
  const ok = passingResult.passed === true && failingResult.passed === false;
  return {
    ok,
    passingResult,
    failingResult,
  };
}

/**
 * Format the report (markdown) — per task pass/fail, rounds, tool calls,
 * tokens; a summary line per category.
 */
function formatReport(modelName, results, options) {
  const lines = [];
  const ranAt = new Date().toISOString();
  lines.push(`# BYOK eval report — ${modelName} — ${ranAt}`);
  if (options && options.judgeModel) {
    lines.push(
      `> LLM-as-judge enabled (${options.judgeModel}) — subjective signal, the mechanical score above is the source of truth.`
    );
  }
  const passCount = results.filter(result => result.passed).length;
  lines.push(
    `**${passCount}/${results.length} tasks passed** · ${results.reduce(
      (total, result) => total + result.tokens,
      0
    )} tokens`
  );
  const categories = [...new Set(results.map(result => result.category))];
  for (const category of categories) {
    const categoryResults = results.filter(result => result.category === category);
    const categoryPasses = categoryResults.filter(result => result.passed).length;
    lines.push('');
    lines.push(`## ${category} (${categoryPasses}/${categoryResults.length})`);
    lines.push('');
    for (const result of categoryResults) {
      lines.push(
        `- ${result.passed ? '✅' : '❌'} **${result.taskId}** — ${result.reason} (rounds: ${result.rounds}, tool calls: ${result.toolCalls}, tokens: ${result.tokens})`
      );
    }
  }
  return lines.join('\n');
}

// ----------------------------------------------------------------------
// The CLI (only when run directly).
// ----------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const readArg = name => {
    const index = args.indexOf(`--${name}`);
    return index !== -1 && args[index + 1] ? args[index + 1] : null;
  };
  const endpoint = readArg('endpoint');
  const key = readArg('key');
  const model = readArg('model');
  const judgeModel = readArg('judge-model');
  const outDir = readArg('out') || path.join(__dirname, '..', '..', '..', 'REVIEW', 'evals');

  if (!endpoint || !model) {
    console.error(
      'Usage: node scripts/run-byok-evals.js --endpoint https://host/v1 --model <model> [--key <key>] [--judge-model <model>] [--out <dir>]'
    );
    process.exit(1);
  }

  // The axios dependency of the app; the script runs from newIDE/app.
  // eslint-disable-next-line import/no-unresolved
  const axios = require('axios');

  const sendCompletion = async ({ messages }) => {
    const body = { model, messages };
    const response = await axios.post(`${endpoint.replace(/\/+$/, '')}/chat/completions`, body, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      timeout: 120000,
    });
    return response.data;
  };

  console.log(`Running ${tasks.length} eval tasks on ${model}…`);
  const results = [];
  for (const task of tasks) {
    try {
      const result = await runEvalTask(task, sendCompletion);
      results.push(result);
      console.log(
        `${result.passed ? 'PASS' : 'FAIL'} ${result.taskId} (${result.tokens} tokens)`
      );
    } catch (error) {
      results.push({
        taskId: task.id,
        category: task.category,
        passed: false,
        reason: 'The task run failed.',
        rounds: 0,
        toolCalls: 0,
        tokens: 0,
        error: String((error && error.message) || error),
      });
      console.error(`ERROR ${task.id}: ${String((error && error.message) || error)}`);
    }
  }

  const report = formatReport(model, results, { judgeModel });
  fs.mkdirSync(outDir, { recursive: true });
  const fileName = `eval-${model.replace(/[^a-zA-Z0-9._-]+/g, '_')}-${Date.now()}.md`;
  const outPath = path.join(outDir, fileName);
  fs.writeFileSync(outPath, report, 'utf8');
  console.log(`Report written to ${outPath}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  tasks,
  makeTask,
  parseEvalAnswer,
  runEvalTask,
  makeSelfCheckTasks,
  runSelfCheck,
  formatReport,
  ALL_SCORERS,
};
