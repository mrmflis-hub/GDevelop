/**
 * The eval harness self-check (Phase 9.8): the trivially-passing and
 * trivially-failing tasks must both score correctly, the suite must hold
 * the planned task counts, and no shipped module may import the dev-only
 * eval code.
 */
const fs = require('fs');
const path = require('path');
const {
  tasks,
  makeSelfCheckTasks,
  parseEvalAnswer,
  formatReport,
  runEvalTask,
} = require('../../../../scripts/run-byok-evals.js');

describe('Byok eval harness: self-check', () => {
  it('scores the trivially-passing task as passed', () => {
    const { passing, failing } = makeSelfCheckTasks();
    const result = passing.scorer({ answerText: '', toolCalls: [] });
    expect(result.passed).toBe(true);
    expect(failing).toBeTruthy();
  });

  it('scores the trivially-failing task as failed', () => {
    const { failing } = makeSelfCheckTasks();
    const result = failing.scorer({ answerText: '', toolCalls: [] });
    expect(result.passed).toBe(false);
  });
});

describe('Byok eval harness: the task suite', () => {
  it('ships 30 tasks in the planned category split', () => {
    expect(tasks).toHaveLength(30);
    const byCategory = {};
    for (const task of tasks) {
      byCategory[task.category] = (byCategory[task.category] || 0) + 1;
    }
    expect(byCategory).toEqual({
      'event-logic': 10,
      layout: 5,
      variables: 5,
      'js-extension': 5,
      'perception-repair': 5,
    });
  });

  it('has unique task ids and a scorer for every task', () => {
    const ids = new Set(tasks.map(task => task.id));
    expect(ids.size).toBe(tasks.length);
    for (const task of tasks) {
      expect(typeof task.scorer({ answerText: '', toolCalls: [] })).toBe(
        'object'
      );
      expect(task.prompt.length).toBeGreaterThan(20);
    }
  });

  it('scores a correct layout answer through numeric geometry', () => {
    const task = tasks.find(entry => entry.id === 'grid-5x5-platform');
    const instances = [];
    for (let row = 0; row < 5; row++) {
      for (let column = 0; column < 5; column++) {
        instances.push({ x: column * 128, y: row * 128 });
      }
    }
    const result = task.scorer({
      answerText: '',
      toolCalls: [
        {
          name: 'put_2d_instances',
          arguments: { instances },
        },
      ],
    });
    expect(result.passed).toBe(true);

    // One instance off-grid → fail.
    instances[7].x += 5;
    const broken = task.scorer({
      answerText: '',
      toolCalls: [{ name: 'put_2d_instances', arguments: { instances } }],
    });
    expect(broken.passed).toBe(false);
  });

  it('scores an event-logic answer on the emitted tool arguments', () => {
    const task = tasks.find(entry => entry.id === 'coin-spawner-every-3s');
    const good = task.scorer({
      answerText: '',
      toolCalls: [
        {
          name: 'add_scene_events',
          arguments: {
            scene_name: 'Level 1',
            event_batches: [
              {
                placement_relation: 'insert_at_end',
                events: [
                  {
                    type: 'BuiltinCommonInstructions::Standard',
                    conditions: [
                      {
                        type: { value: 'BuiltinCommonInstructions::Timer' },
                        parameters: ['"spawn"', '3'],
                      },
                    ],
                    actions: [
                      {
                        type: { value: 'CreerObjet' },
                        parameters: ['', 'Coin', 'Level 1', 100, 200],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ],
    });
    expect(good.passed).toBe(true);

    const noCall = task.scorer({
      answerText: 'I would add events.',
      toolCalls: [],
    });
    expect(noCall.passed).toBe(false);
  });
});

describe('Byok eval harness: the runner pieces', () => {
  it('parses fenced, prose-wrapped and broken answers', () => {
    const fenced = parseEvalAnswer(
      'Here you go:\n```json\n{"tool_calls":[{"name":"a","arguments":{"x":1}}]}\n```'
    );
    expect(fenced.toolCalls).toEqual([{ name: 'a', arguments: { x: 1 } }]);

    const broken = parseEvalAnswer('no json at all');
    expect(broken.toolCalls).toEqual([]);

    const malformed = parseEvalAnswer('{"tool_calls": "not-a-list"}');
    expect(malformed.toolCalls).toEqual([]);
  });

  it('tracks rounds, tool calls and tokens per task', async () => {
    const task = tasks.find(entry => entry.id === 'grid-5x5-platform');
    const result = await runEvalTask(task, async () => ({
      choices: [
        {
          message: {
            role: 'assistant',
            content: '{"tool_calls": []}',
          },
        },
      ],
      usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
    }));
    expect(result.tokens).toBe(7);
    expect(result.rounds).toBe(1);
    expect(result.passed).toBe(false);
  });

  it('writes a markdown report with the four tracked numbers', () => {
    const report = formatReport(
      'eval-model',
      [
        {
          taskId: 't1',
          category: 'layout',
          passed: true,
          reason: 'even grid',
          rounds: 1,
          toolCalls: 1,
          tokens: 42,
        },
      ],
      { judgeModel: null }
    );
    expect(report).toContain('# BYOK eval report');
    expect(report).toContain('1/1 tasks passed');
    expect(report).toContain('42 tokens');
  });
});

describe('Byok eval harness: the dev-only build boundary', () => {
  it('is never imported by any shipped module', () => {
    const evalsDir = path.join(__dirname);
    const byokDir = path.join(__dirname, '..');
    const offenders: Array<string> = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'evals' || entry.name === '__tests__') continue;
          walk(entryPath);
          continue;
        }
        if (!entry.name.endsWith('.js')) continue;
        const content = fs.readFileSync(entryPath, 'utf8');
        if (
          content.includes('Byok/evals') ||
          content.includes('run-byok-evals')
        ) {
          offenders.push(entryPath);
        }
      }
    };
    walk(byokDir);
    expect(offenders).toEqual([]);
    // The boundary guard itself lives inside the dev-only folder.
    expect(evalsDir).toContain('evals');
  });
});
