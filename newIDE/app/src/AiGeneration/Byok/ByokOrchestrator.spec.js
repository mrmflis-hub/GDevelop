// @flow
import {
  createByokOrchestrator,
  createByokSubAgentRunner,
  capToolOutput,
  BYOK_TOOL_OUTPUT_CAP,
  MAX_BYOK_TOOL_ROUNDS,
} from './ByokOrchestrator';
import { DEFAULT_BYOK_SETTINGS } from './ByokTypes';
import { createByokUsageTracker } from './ByokUsageTracker';
import { createByokAiRequestShell } from './ByokTranscript';
import {
  createByokCancellation,
  sendByokChatCompletionWithRetries,
} from './ByokClient';
import { cacheByokModels, clearByokModels } from './ByokModelsCache';
import { registerByokImage } from './ByokImageContent';

jest.mock('./ByokClient', () => ({
  sendByokChatCompletionWithRetries: jest.fn(),
  createByokCancellation: jest.fn(() => ({
    token: { __fakeCancelToken: true },
    cancel: jest.fn(),
  })),
}));

const mockSendByokChatCompletion = mockFn(sendByokChatCompletionWithRetries);

function mockFn(fn: any): any {
  return fn;
}

const makeToolCall = (id: string, name: string, args: string) => ({
  id,
  type: 'function',
  function: { name, arguments: args },
});

const makeResponse = ({
  text,
  toolCalls = [],
  usage,
}: {
  text?: string | null,
  toolCalls?: Array<any>,
  usage?: any,
}) => ({
  choices: [
    {
      message: {
        role: 'assistant',
        content: text === undefined ? null : text,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      },
      finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
    },
  ],
  usage,
});

// A successful executor: every call succeeds with a small output.
const makeFakeExecutor = () =>
  mockFn(
    jest.fn(async (functionCalls: Array<any>) => ({
      results: functionCalls.map((functionCall: any) => ({
        status: 'finished',
        call_id: functionCall.call_id,
        success: true,
        output: { message: 'done' },
      })),
      createdSceneNames: [],
      createdProject: null,
    }))
  );

const makeOrchestrator = (overrides: any = {}) => {
  const aiRequest = createByokAiRequestShell('byok-test-chat');
  const onAiRequestUpdated = mockFn(jest.fn());
  const usageTracker = {
    recordTurn: mockFn((jest.fn(): any)),
    getTotals: () => ({}),
  };
  // Back-compat with the pre-Phase-5 option name used across the tests
  // below: the orchestrator itself takes the getter (getExecutor).
  const { executeFunctionCalls, getExecutor, ...otherOverrides } = overrides;
  const defaultExecutor = makeFakeExecutor();
  const orchestrator = createByokOrchestrator({
    connection: { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test' },
    settings: { ...DEFAULT_BYOK_SETTINGS, modelName: 'test-model' },
    aiRequest,
    hasOpenedProject: () => true,
    getProject: () => null,
    getExecutor:
      getExecutor !== undefined
        ? getExecutor
        : () =>
            executeFunctionCalls !== undefined
              ? executeFunctionCalls
              : defaultExecutor,
    getProjectUserContent: async () => '{"scenes":[]}',
    onAiRequestUpdated,
    doesCallRequireApproval: () => false,
    onRequestEditApproval: async () => true,
    usageTracker,
    onFunctionCallsExecuted: mockFn(jest.fn()),
    ...otherOverrides,
  });
  return { orchestrator, aiRequest, onAiRequestUpdated, usageTracker };
};

// Phase 7: building the system prompt now goes through async storages
// (skills metadata, project notes), so reaching the model call takes a few
// extra microtasks. This flushes them deterministically.
const flushMicrotasks = async () => {
  for (let index = 0; index < 20; index++) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
};

describe('ByokOrchestrator', () => {
  beforeEach(() => {
    mockSendByokChatCompletion.mockReset();
    // The jest preset resets every mock's implementation before each test
    // (resetMocks): the factory-provided cancellation mock must be
    // re-implemented here, or createByokCancellation returns undefined.
    (createByokCancellation: any).mockImplementation(() => ({
      token: { __fakeCancelToken: true },
      cancel: jest.fn(),
    }));
    // The models cache is module state: no test may see another's models.
    clearByokModels();
  });

  it('runs the happy path: tool call → result fed back → final text answer', async () => {
    const executeFunctionCalls = makeFakeExecutor();
    mockSendByokChatCompletion
      .mockResolvedValueOnce(
        makeResponse({
          toolCalls: [
            makeToolCall('call-1', 'create_scene', '{"scene_name":"Forest"}'),
          ],
        })
      )
      .mockResolvedValueOnce(makeResponse({ text: 'Scene created!' }));
    const { orchestrator, aiRequest } = makeOrchestrator({
      executeFunctionCalls,
    });

    await orchestrator.startNewChat('Create a Forest scene');

    expect(aiRequest.status).toBe('ready');
    expect(aiRequest.error).toBe(null);
    // The transcript tells the whole story, in order.
    const transcript = aiRequest.output || [];
    expect(transcript).toHaveLength(4);
    expect(transcript[0].role).toBe('user');
    expect(transcript[1].content).toEqual([
      expect.objectContaining({
        type: 'function_call',
        call_id: 'call-1',
        name: 'create_scene',
      }),
    ]);
    expect(transcript[2].type).toBe('function_call_output');
    expect(transcript[2].call_id).toBe('call-1');
    expect(JSON.parse((transcript[2]: any).output)).toEqual({
      success: true,
      message: 'done',
    });
    expect(transcript[3].content).toEqual([
      expect.objectContaining({ type: 'output_text', text: 'Scene created!' }),
    ]);

    // The executor ran the call, and the second model call got the tool
    // result back as a `tool` message.
    expect(executeFunctionCalls).toHaveBeenCalledTimes(1);
    expect(mockSendByokChatCompletion).toHaveBeenCalledTimes(2);
    const secondCallMessages =
      mockSendByokChatCompletion.mock.calls[1][0].options.messages;
    expect(
      secondCallMessages.filter((message: any) => message.role === 'tool')
    ).toHaveLength(1);
  });

  it('persists the turn start exactly once while the first model call is pending', async () => {
    // The model call never resolves until the test allows it: the persists
    // counted below are exactly the turn-start ones.
    let resolveModelCall = (null: ?(response: any) => void);
    mockSendByokChatCompletion.mockReturnValueOnce(
      new Promise(resolve => {
        resolveModelCall = resolve;
      })
    );
    const { orchestrator, aiRequest, onAiRequestUpdated } = makeOrchestrator();

    const chatPromise = orchestrator.startNewChat('Hello');
    for (let i = 0; i < 10; i++) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.resolve();
    }

    // Once by appendUserMessage — not twice (the loop no longer re-persists
    // the same 'working' status).
    expect(onAiRequestUpdated).toHaveBeenCalledTimes(1);

    if (!resolveModelCall) throw new Error('The model call never started');
    resolveModelCall(makeResponse({ text: 'Done.' }));
    await chatPromise;
    expect(aiRequest.status).toBe('ready');
  });

  it('persists the turn start exactly once on a retry', async () => {
    const serverError = (new Error('boom'): any);
    serverError.response = { status: 500, data: null };
    mockSendByokChatCompletion.mockRejectedValueOnce(serverError);
    const { orchestrator, aiRequest, onAiRequestUpdated } = makeOrchestrator();

    await orchestrator.startNewChat('Hello');
    expect(aiRequest.status).toBe('error');
    onAiRequestUpdated.mockClear();

    let resolveModelCall = (null: ?(response: any) => void);
    mockSendByokChatCompletion.mockReturnValueOnce(
      new Promise(resolve => {
        resolveModelCall = resolve;
      })
    );
    const retryPromise = orchestrator.retryAfterError();
    for (let i = 0; i < 10; i++) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.resolve();
    }

    expect(onAiRequestUpdated).toHaveBeenCalledTimes(1);

    if (!resolveModelCall) throw new Error('The model call never started');
    resolveModelCall(makeResponse({ text: 'Recovered.' }));
    await retryPromise;
    expect(aiRequest.status).toBe('ready');
  });

  it('chains two rounds of tool calls before answering', async () => {
    mockSendByokChatCompletion
      .mockResolvedValueOnce(
        makeResponse({
          toolCalls: [makeToolCall('call-1', 'describe_instances', '{}')],
        })
      )
      .mockResolvedValueOnce(
        makeResponse({
          toolCalls: [makeToolCall('call-2', 'create_scene', '{}')],
        })
      )
      .mockResolvedValueOnce(makeResponse({ text: 'All done.' }));
    const { orchestrator, aiRequest } = makeOrchestrator();

    await orchestrator.startNewChat('Do two things');

    expect(mockSendByokChatCompletion).toHaveBeenCalledTimes(3);
    const functionCalls = (aiRequest.output || [])
      .filter(
        message => message.type === 'message' && message.role === 'assistant'
      )
      .flatMap(message => message.content)
      .filter(item => item.type === 'function_call');
    expect(functionCalls.map(item => item.name)).toEqual([
      'describe_instances',
      'create_scene',
    ]);
    expect(aiRequest.status).toBe('ready');
  });

  it('stops runaway tool loops with an error status at the round cap', async () => {
    const runawayResponse = makeResponse({
      toolCalls: [
        makeToolCall(`call-x`, 'create_or_update_plan', '{"tasks":[]}'),
      ],
    });
    mockSendByokChatCompletion.mockImplementation(async () => runawayResponse);
    const { orchestrator, aiRequest } = makeOrchestrator();

    await orchestrator.startNewChat('Loop forever');

    expect(mockSendByokChatCompletion).toHaveBeenCalledTimes(
      MAX_BYOK_TOOL_ROUNDS
    );
    expect(aiRequest.status).toBe('error');
    expect(aiRequest.error && aiRequest.error.code).toBe(
      'byok-too-many-tool-rounds'
    );
  });

  it('feeds a failed tool call back to the model as success:false, which recovers', async () => {
    const executeFunctionCalls = mockFn(
      jest.fn(async () => ({
        results: [
          {
            status: 'finished',
            call_id: 'call-1',
            success: false,
            output: { message: 'Invalid arguments (not a valid JSON string).' },
          },
        ],
        createdSceneNames: [],
        createdProject: null,
      }))
    );
    mockSendByokChatCompletion
      .mockResolvedValueOnce(
        makeResponse({
          toolCalls: [makeToolCall('call-1', 'create_scene', '{broken')],
        })
      )
      .mockResolvedValueOnce(makeResponse({ text: 'Fixed and done.' }));
    const { orchestrator, aiRequest } = makeOrchestrator({
      executeFunctionCalls,
    });

    await orchestrator.startNewChat('Break then fix');

    const toolOutput = (aiRequest.output || []).find(
      message => message.type === 'function_call_output'
    );
    expect(toolOutput).toBeTruthy();
    expect(JSON.parse((toolOutput: any).output).success).toBe(false);
    expect(JSON.parse((toolOutput: any).output).message).toContain(
      'Invalid arguments'
    );
    // The loop continued so the model could correct itself.
    expect(aiRequest.status).toBe('ready');
    expect(mockSendByokChatCompletion).toHaveBeenCalledTimes(2);
  });

  it('suspends the chat when an edit approval is refused, recording not-executed outputs', async () => {
    const executeFunctionCalls = makeFakeExecutor();
    const onRequestEditApproval = mockFn((jest.fn(async () => false): any));
    mockSendByokChatCompletion.mockResolvedValueOnce(
      makeResponse({
        toolCalls: [
          makeToolCall('call-1', 'describe_instances', '{}'),
          makeToolCall('call-2', 'create_scene', '{}'),
        ],
      })
    );
    const { orchestrator, aiRequest } = makeOrchestrator({
      executeFunctionCalls,
      onRequestEditApproval,
      doesCallRequireApproval: functionCall =>
        functionCall.name === 'create_scene',
    });

    await orchestrator.startNewChat('Create something');

    expect(onRequestEditApproval).toHaveBeenCalledTimes(1);
    expect(executeFunctionCalls).not.toHaveBeenCalled();
    expect(aiRequest.status).toBe('suspended');
    // Every call of the refused batch got a failure output — including the
    // non-modifying one, which was never run: the transcript stays a valid
    // OpenAI conversation (no dangling tool_calls).
    const transcript = aiRequest.output || [];
    const outputs = transcript.filter(
      message => message.type === 'function_call_output'
    );
    expect(outputs).toHaveLength(2);
    expect(outputs.map(output => output.call_id).sort()).toEqual([
      'call-1',
      'call-2',
    ]);
    for (const output of outputs) {
      expect(JSON.parse(output.output).success).toBe(false);
      expect(JSON.parse(output.output).message).toContain('refused');
    }
  });

  it('resumes cleanly after a refused edit: the next message is a protocol-valid request', async () => {
    const executeFunctionCalls = makeFakeExecutor();
    const onRequestEditApproval = mockFn((jest.fn(async () => false): any));
    mockSendByokChatCompletion
      .mockResolvedValueOnce(
        makeResponse({
          toolCalls: [makeToolCall('call-1', 'create_scene', '{}')],
        })
      )
      .mockResolvedValueOnce(
        makeResponse({ text: 'Understood, standing by.' })
      );
    const { orchestrator, aiRequest } = makeOrchestrator({
      executeFunctionCalls,
      onRequestEditApproval,
      doesCallRequireApproval: () => true,
    });

    await orchestrator.startNewChat('Create something');
    await orchestrator.sendUserMessage('Actually, do nothing');

    expect(aiRequest.status).toBe('ready');
    expect(mockSendByokChatCompletion).toHaveBeenCalledTimes(2);
    // The resume request replays the assistant tool_calls followed by their
    // tool results, then the new user message — no dangling tool_calls.
    const resumeMessages =
      mockSendByokChatCompletion.mock.calls[1][0].options.messages;
    const toolCallIndex = resumeMessages.findIndex(
      (message: any) =>
        message.role === 'assistant' && message.tool_calls !== undefined
    );
    expect(toolCallIndex).toBeGreaterThan(-1);
    expect(resumeMessages[toolCallIndex + 1].role).toBe('tool');
  });

  it('does not execute an arrived batch when suspended mid-model-call', async () => {
    const executeFunctionCalls = makeFakeExecutor();
    let resolveModelCall: (response: any) => void = () => {};
    mockSendByokChatCompletion.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveModelCall = resolve;
        })
    );
    const { orchestrator, aiRequest } = makeOrchestrator({
      executeFunctionCalls,
    });

    const startPromise = orchestrator.startNewChat('Slow round');
    // Let the user message append and the project content resolve, so the
    // loop is now awaiting the model call.
    await flushMicrotasks();
    orchestrator.suspend();
    resolveModelCall(
      makeResponse({
        toolCalls: [makeToolCall('call-1', 'create_scene', '{}')],
      })
    );
    await startPromise;

    expect(executeFunctionCalls).not.toHaveBeenCalled();
    expect(aiRequest.status).toBe('suspended');
    // The arrived batch is recorded as not executed, keeping the transcript
    // protocol-valid.
    const outputs = (aiRequest.output || []).filter(
      message => message.type === 'function_call_output'
    );
    expect(outputs).toHaveLength(1);
    expect(JSON.parse((outputs[0]: any).output).message).toContain('stopped');
  });

  it('proceeds when an edit approval is accepted', async () => {
    const executeFunctionCalls = makeFakeExecutor();
    const onRequestEditApproval = mockFn((jest.fn(async () => true): any));
    mockSendByokChatCompletion
      .mockResolvedValueOnce(
        makeResponse({
          toolCalls: [makeToolCall('call-1', 'create_scene', '{}')],
        })
      )
      .mockResolvedValueOnce(makeResponse({ text: 'Done.' }));
    const { orchestrator, aiRequest } = makeOrchestrator({
      executeFunctionCalls,
      onRequestEditApproval,
      doesCallRequireApproval: () => true,
    });

    await orchestrator.startNewChat('Create something');

    expect(onRequestEditApproval).toHaveBeenCalledTimes(1);
    expect(executeFunctionCalls).toHaveBeenCalledTimes(1);
    expect(aiRequest.status).toBe('ready');
  });

  it('updates contextStats each round and reports usage', async () => {
    mockSendByokChatCompletion
      .mockResolvedValueOnce(
        makeResponse({
          toolCalls: [makeToolCall('call-1', 'describe_instances', '{}')],
          usage: {
            prompt_tokens: 3000,
            completion_tokens: 500,
            total_tokens: 3500,
          },
        })
      )
      .mockResolvedValueOnce(
        makeResponse({
          text: 'Done.',
          usage: {
            prompt_tokens: 4000,
            completion_tokens: 200,
            total_tokens: 4200,
          },
        })
      );
    const { orchestrator, aiRequest, usageTracker } = makeOrchestrator();

    await orchestrator.startNewChat('Check usage');

    // The default context window of the settings is 8192 tokens.
    expect(aiRequest.contextStats).toEqual({
      totalTokens: 4200,
      usedPercentage: 4200 / 8192,
    });
    expect(usageTracker.recordTurn).toHaveBeenCalledTimes(2);
  });

  it('stops the loop at the context-ratio threshold, before executing more tools', async () => {
    const executeFunctionCalls = makeFakeExecutor();
    mockSendByokChatCompletion.mockResolvedValue(
      makeResponse({
        toolCalls: [
          makeToolCall('call-1', 'create_or_update_plan', '{"tasks":[]}'),
        ],
        // 8000+512 tokens of an 8192-token window: ~98% used.
        usage: {
          prompt_tokens: 8000,
          completion_tokens: 512,
          total_tokens: 8512,
        },
      })
    );
    const { orchestrator, aiRequest } = makeOrchestrator({
      executeFunctionCalls,
    });

    await orchestrator.startNewChat('Fill the context');

    expect(aiRequest.status).toBe('error');
    expect(aiRequest.error && aiRequest.error.code).toBe('byok-context-full');
    // The assistant turn was recorded (so the user sees what happened), but
    // no further tool was executed.
    expect(executeFunctionCalls).not.toHaveBeenCalled();
  });

  it('notifies onAiRequestUpdated after every transcript mutation', async () => {
    mockSendByokChatCompletion
      .mockResolvedValueOnce(
        makeResponse({
          toolCalls: [makeToolCall('call-1', 'create_scene', '{}')],
        })
      )
      .mockResolvedValueOnce(makeResponse({ text: 'Done.' }));
    const { orchestrator, onAiRequestUpdated } = makeOrchestrator();

    await orchestrator.startNewChat('Trace updates');

    // user message, loop start, assistant turn, tool outputs, ready —
    // strictly increasing, and always the same record.
    expect(onAiRequestUpdated.mock.calls.length).toBeGreaterThanOrEqual(5);
    for (const call of onAiRequestUpdated.mock.calls) {
      expect(call[0].id).toBe('byok-test-chat');
    }
  });

  it('reports a classified error when the endpoint call fails', async () => {
    mockSendByokChatCompletion.mockRejectedValue({
      kind: 'authentication',
      message: 'Your API key was rejected by the endpoint (401).',
      status: 401,
    });
    const { orchestrator, aiRequest } = makeOrchestrator();

    await orchestrator.startNewChat('Hello');

    expect(aiRequest.status).toBe('error');
    expect(aiRequest.error && aiRequest.error.code).toBe('authentication');
    expect(aiRequest.error && aiRequest.error.message).toContain('401');
  });

  it('continues an existing chat with sendUserMessage', async () => {
    mockSendByokChatCompletion
      .mockResolvedValueOnce(makeResponse({ text: 'First answer.' }))
      .mockResolvedValueOnce(makeResponse({ text: 'Second answer.' }));
    const { orchestrator, aiRequest } = makeOrchestrator();

    await orchestrator.startNewChat('First question');
    await orchestrator.sendUserMessage('Second question');

    const userMessages = (aiRequest.output || []).filter(
      message => message.type === 'message' && message.role === 'user'
    );
    expect(userMessages).toHaveLength(2);
    expect(aiRequest.status).toBe('ready');
    expect(mockSendByokChatCompletion).toHaveBeenCalledTimes(2);
  });

  it('handles create_or_update_plan itself, echoing the tasks as the plan output', async () => {
    const executeFunctionCalls = makeFakeExecutor();
    const tasks = [{ id: 't1', title: 'Do it', status: 'pending' }];
    mockSendByokChatCompletion
      .mockResolvedValueOnce(
        makeResponse({
          toolCalls: [
            makeToolCall(
              'call-plan',
              'create_or_update_plan',
              JSON.stringify({ tasks })
            ),
          ],
        })
      )
      .mockResolvedValueOnce(makeResponse({ text: 'Planned and done.' }));
    const { orchestrator, aiRequest } = makeOrchestrator({
      executeFunctionCalls,
    });

    await orchestrator.startNewChat('Plan then act');

    // The plan call never reaches the editor executor: its registry
    // implementation is a permanent failure stub (handled server-side
    // upstream), so the orchestrator answers it directly.
    expect(executeFunctionCalls).not.toHaveBeenCalled();
    const planOutput = (aiRequest.output || []).find(
      message => message.type === 'function_call_output'
    );
    const parsedOutput = JSON.parse((planOutput: any).output);
    expect(parsedOutput.success).toBe(true);
    // The wire field `depends_on` is mapped to the internal `dependsOn` of
    // AiRequestPlanTask (and defaults to an empty array).
    expect(parsedOutput.plan.tasks).toEqual([
      { id: 't1', title: 'Do it', status: 'pending', dependsOn: [] },
    ]);
    expect(aiRequest.status).toBe('ready');
  });

  it('reports invalid create_or_update_plan arguments as a failed output', async () => {
    mockSendByokChatCompletion
      .mockResolvedValueOnce(
        makeResponse({
          toolCalls: [
            makeToolCall('call-plan', 'create_or_update_plan', '{broken'),
          ],
        })
      )
      .mockResolvedValueOnce(makeResponse({ text: 'Recovered.' }));
    const { orchestrator, aiRequest } = makeOrchestrator();

    await orchestrator.startNewChat('Plan badly');

    const planOutput = (aiRequest.output || []).find(
      message => message.type === 'function_call_output'
    );
    const parsedOutput = JSON.parse((planOutput: any).output);
    expect(parsedOutput.success).toBe(false);
    expect(parsedOutput.message).toContain('tasks');
    expect(aiRequest.status).toBe('ready');
  });

  it('retries after an error without adding anything to the conversation', async () => {
    mockSendByokChatCompletion
      .mockRejectedValueOnce({
        kind: 'network',
        message: 'The endpoint could not be reached.',
      })
      .mockResolvedValueOnce(makeResponse({ text: 'Back online.' }));
    const { orchestrator, aiRequest } = makeOrchestrator();

    await orchestrator.startNewChat('Hello');
    expect(aiRequest.status).toBe('error');
    const outputLengthAfterFailure = (aiRequest.output || []).length;

    await orchestrator.retryAfterError();

    expect(aiRequest.status).toBe('ready');
    expect(mockSendByokChatCompletion).toHaveBeenCalledTimes(2);
    // Only the new final answer was appended — no extra user message.
    expect((aiRequest.output || []).length).toBe(outputLengthAfterFailure + 1);
  });

  it('ignores retryAfterError when the chat is not in the error state', async () => {
    mockSendByokChatCompletion.mockResolvedValueOnce(
      makeResponse({ text: 'ok' })
    );
    const { orchestrator } = makeOrchestrator();

    await orchestrator.startNewChat('Hello');
    await orchestrator.retryAfterError();

    expect(mockSendByokChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('marks the chat suspended when suspend() is called', async () => {
    const { orchestrator, aiRequest } = makeOrchestrator();

    orchestrator.suspend();

    expect(aiRequest.status).toBe('suspended');
  });

  it('sends the system prompt and folds the snapshot into the user message', async () => {
    mockSendByokChatCompletion.mockResolvedValueOnce(
      makeResponse({ text: 'ok' })
    );
    const { orchestrator } = makeOrchestrator();

    await orchestrator.startNewChat('Inspect this');

    const firstCallOptions =
      mockSendByokChatCompletion.mock.calls[0][0].options;
    expect(firstCallOptions.model).toBe('test-model');
    expect(firstCallOptions.tools).toEqual(expect.any(Array));
    expect(firstCallOptions.tools.length).toBeGreaterThan(0);
    const messages = firstCallOptions.messages;
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('GDevelop');
    const userMessage = messages.find(
      (message: any) => message.role === 'user'
    );
    expect(userMessage.content).toContain('Inspect this');
    expect(userMessage.content).toContain('{"scenes":[]}');
  });

  it('refuses to dispatch a hallucinated non-whitelisted tool and tells the model', async () => {
    const executeFunctionCalls = makeFakeExecutor();
    mockSendByokChatCompletion
      .mockResolvedValueOnce(
        makeResponse({
          toolCalls: [makeToolCall('call-x', 'run_tests', '{"query":"evil"}')],
        })
      )
      .mockResolvedValueOnce(makeResponse({ text: 'Recovered.' }));
    const { orchestrator, aiRequest } = makeOrchestrator({
      executeFunctionCalls,
    });

    await orchestrator.startNewChat('Do something');

    // The whitelist is enforced at dispatch, not only in the advertisement:
    // run_tests (a server-side stub) must never reach the executor.
    expect(executeFunctionCalls).not.toHaveBeenCalled();
    const outputs = (aiRequest.output || []).filter(
      message => message.type === 'function_call_output'
    );
    expect(outputs).toHaveLength(1);
    expect(outputs[0].call_id).toBe('call-x');
    expect(JSON.parse((outputs[0]: any).output).success).toBe(false);
    expect(JSON.parse((outputs[0]: any).output).message).toContain(
      'not available'
    );
    // The loop continued so the model could correct itself.
    expect(aiRequest.status).toBe('ready');
    expect(mockSendByokChatCompletion).toHaveBeenCalledTimes(2);
  });

  it('dispatches only the whitelisted calls of a mixed batch', async () => {
    const executeFunctionCalls = makeFakeExecutor();
    mockSendByokChatCompletion
      .mockResolvedValueOnce(
        makeResponse({
          toolCalls: [
            makeToolCall('call-1', 'run_tests', '{}'),
            makeToolCall('call-2', 'describe_instances', '{}'),
          ],
        })
      )
      .mockResolvedValueOnce(makeResponse({ text: 'Done.' }));
    const { orchestrator, aiRequest } = makeOrchestrator({
      executeFunctionCalls,
    });

    await orchestrator.startNewChat('Mixed batch');

    expect(executeFunctionCalls).toHaveBeenCalledTimes(1);
    expect(
      executeFunctionCalls.mock.calls[0][0].map((call: any) => call.name)
    ).toEqual(['describe_instances']);
    // Both calls got an output (one refusal, one result).
    const outputs = (aiRequest.output || []).filter(
      message => message.type === 'function_call_output'
    );
    expect(outputs.map(output => output.call_id).sort()).toEqual([
      'call-1',
      'call-2',
    ]);
    expect(aiRequest.status).toBe('ready');
  });

  it('aborts the in-flight model request on suspend and keeps the suspended status', async () => {
    let rejectModelCall: (error: any) => void = () => {};
    mockSendByokChatCompletion.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectModelCall = reject;
        })
    );
    const { orchestrator, aiRequest } = makeOrchestrator();

    const startPromise = orchestrator.startNewChat('Slow round');
    await flushMicrotasks();
    // The model call carries a cancellation handle, so suspend() can abort
    // it instead of letting it run (and bill) to its timeout.
    expect(
      mockSendByokChatCompletion.mock.calls[0][0].options.cancellation
    ).toBeDefined();

    orchestrator.suspend();
    const cancellationResults = (createByokCancellation: any).mock.results;
    const lastCancellation =
      cancellationResults[cancellationResults.length - 1].value;
    expect(lastCancellation.cancel).toHaveBeenCalled();

    // The client surfaces the abort as a cancelled rejection: no error is
    // shown, the status suspend() set wins.
    rejectModelCall({ __CANCEL__: true });
    await startPromise;

    expect(aiRequest.status).toBe('suspended');
    expect(aiRequest.error).toBe(null);
  });

  it('records a late plain-text answer after a suspension but keeps the suspended status', async () => {
    let resolveModelCall: (response: any) => void = () => {};
    mockSendByokChatCompletion.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveModelCall = resolve;
        })
    );
    const { orchestrator, aiRequest } = makeOrchestrator();

    const startPromise = orchestrator.startNewChat('Slow answer');
    await flushMicrotasks();
    orchestrator.suspend();
    resolveModelCall(makeResponse({ text: 'Late answer' }));
    await startPromise;

    expect(aiRequest.status).toBe('suspended');
    const output = aiRequest.output || [];
    const lastMessage = output[output.length - 1];
    expect(lastMessage.content).toEqual([
      expect.objectContaining({ type: 'output_text', text: 'Late answer' }),
    ]);
  });

  it('does not run an approved batch when Stop was pressed while the approval was pending', async () => {
    const executeFunctionCalls = makeFakeExecutor();
    let resolveApproval: (approved: boolean) => void = () => {};
    const onRequestEditApproval = mockFn(
      (jest.fn(
        () =>
          new Promise(resolve => {
            resolveApproval = resolve;
          })
      ): any)
    );
    mockSendByokChatCompletion.mockResolvedValueOnce(
      makeResponse({
        toolCalls: [makeToolCall('call-1', 'create_scene', '{}')],
      })
    );
    const { orchestrator, aiRequest } = makeOrchestrator({
      executeFunctionCalls,
      onRequestEditApproval,
      doesCallRequireApproval: () => true,
    });

    const startPromise = orchestrator.startNewChat('Edit something');
    await flushMicrotasks();
    await Promise.resolve();
    orchestrator.suspend();
    resolveApproval(true);
    await startPromise;

    // Approved or not, a batch must not run after the user pressed Stop.
    expect(executeFunctionCalls).not.toHaveBeenCalled();
    expect(aiRequest.status).toBe('suspended');
    const outputs = (aiRequest.output || []).filter(
      message => message.type === 'function_call_output'
    );
    expect(outputs).toHaveLength(1);
    expect(JSON.parse((outputs[0]: any).output).message).toContain('stopped');
  });

  it('computes the context ratio against the per-model context window', async () => {
    mockSendByokChatCompletion
      .mockResolvedValueOnce(
        makeResponse({
          toolCalls: [makeToolCall('call-1', 'describe_instances', '{}')],
          usage: {
            prompt_tokens: 9000,
            completion_tokens: 500,
            total_tokens: 9500,
          },
        })
      )
      .mockResolvedValueOnce(makeResponse({ text: 'Done.' }));
    const { orchestrator, aiRequest } = makeOrchestrator({
      settings: {
        ...DEFAULT_BYOK_SETTINGS,
        modelName: 'test-model',
        contextWindowByModel: { 'test-model': 100000 },
      },
    });

    await orchestrator.startNewChat('Big context');

    // 9500 tokens of the 100000-token window the user set for this model
    // (not of the 8192 global default: the guard must not fire).
    expect(aiRequest.contextStats).toEqual({
      totalTokens: 9500,
      usedPercentage: 9500 / 100000,
    });
    expect(aiRequest.status).toBe('ready');
  });

  it('computes the context ratio against the server-reported context window', async () => {
    cacheByokModels('https://api.example.com/v1', [
      { id: 'test-model', contextWindowTokens: 32768 },
    ]);
    mockSendByokChatCompletion
      .mockResolvedValueOnce(
        makeResponse({
          toolCalls: [makeToolCall('call-1', 'describe_instances', '{}')],
          usage: {
            prompt_tokens: 8000,
            completion_tokens: 512,
            total_tokens: 8512,
          },
        })
      )
      .mockResolvedValueOnce(makeResponse({ text: 'Done.' }));
    const { orchestrator, aiRequest } = makeOrchestrator();

    await orchestrator.startNewChat('Server-reported window');

    expect(aiRequest.contextStats).toEqual({
      totalTokens: 8512,
      usedPercentage: 8512 / 32768,
    });
    expect(aiRequest.status).toBe('ready');
  });

  it('closes the pending batch when the context guard fires, and refuses a retry', async () => {
    mockSendByokChatCompletion.mockResolvedValue(
      makeResponse({
        toolCalls: [
          makeToolCall('call-1', 'create_or_update_plan', '{"tasks":[]}'),
        ],
        usage: {
          prompt_tokens: 8000,
          completion_tokens: 512,
          total_tokens: 8512,
        },
      })
    );
    const { orchestrator, aiRequest } = makeOrchestrator();

    await orchestrator.startNewChat('Fill the context');

    expect(aiRequest.error && aiRequest.error.code).toBe('byok-context-full');
    // While older images could still be evicted (the default budget of 2),
    // the pending batch executed and the loop continued; only once no image
    // was left did the guard close the batch with a not-executed output and
    // settle into the clean error state.
    const outputs = (aiRequest.output || []).filter(
      message => message.type === 'function_call_output'
    );
    expect(outputs).toHaveLength(3);
    expect(outputs[0].call_id).toBe('call-1');
    expect(
      JSON.parse((outputs[outputs.length - 1]: any).output).message
    ).toContain('context window limit');

    // Retrying would re-send the oversized history to the user's endpoint
    // only to fail identically: it must be refused.
    await orchestrator.retryAfterError();
    expect(mockSendByokChatCompletion).toHaveBeenCalledTimes(3);
  });

  it('appends a failure output for a result that never finished, keeping the transcript valid', async () => {
    const executeFunctionCalls = mockFn(
      jest.fn(async () => ({
        results: [
          { status: 'aborted', call_id: 'call-1', success: false, output: {} },
        ],
        createdSceneNames: [],
        createdProject: null,
      }))
    );
    mockSendByokChatCompletion
      .mockResolvedValueOnce(
        makeResponse({
          toolCalls: [makeToolCall('call-1', 'describe_instances', '{}')],
        })
      )
      .mockResolvedValueOnce(makeResponse({ text: 'Noted.' }));
    const { orchestrator, aiRequest } = makeOrchestrator({
      executeFunctionCalls,
    });

    await orchestrator.startNewChat('Abort a tool');

    const outputs = (aiRequest.output || []).filter(
      message => message.type === 'function_call_output'
    );
    expect(outputs).toHaveLength(1);
    expect(outputs[0].call_id).toBe('call-1');
    expect(JSON.parse((outputs[0]: any).output).success).toBe(false);
    expect(JSON.parse((outputs[0]: any).output).message).toContain('aborted');
    // The follow-up request stays protocol-valid: the assistant tool_calls
    // are followed by a tool message.
    const secondCallMessages =
      mockSendByokChatCompletion.mock.calls[1][0].options.messages;
    const toolCallIndex = secondCallMessages.findIndex(
      (message: any) =>
        message.role === 'assistant' && message.tool_calls !== undefined
    );
    expect(toolCallIndex).toBeGreaterThan(-1);
    expect(secondCallMessages[toolCallIndex + 1].role).toBe('tool');
    expect(aiRequest.status).toBe('ready');
  });

  it('contains an executor crash as failure outputs and continues the loop', async () => {
    const executeFunctionCalls = mockFn(
      jest.fn(async () => {
        throw new Error('boom');
      })
    );
    mockSendByokChatCompletion
      .mockResolvedValueOnce(
        makeResponse({
          toolCalls: [makeToolCall('call-1', 'describe_instances', '{}')],
        })
      )
      .mockResolvedValueOnce(makeResponse({ text: 'Recovered.' }));
    const { orchestrator, aiRequest } = makeOrchestrator({
      executeFunctionCalls,
    });

    await orchestrator.startNewChat('Crash the executor');

    const outputs = (aiRequest.output || []).filter(
      message => message.type === 'function_call_output'
    );
    expect(outputs).toHaveLength(1);
    expect(JSON.parse((outputs[0]: any).output).success).toBe(false);
    expect(JSON.parse((outputs[0]: any).output).message).toContain('crashed');
    expect(aiRequest.status).toBe('ready');
    expect(mockSendByokChatCompletion).toHaveBeenCalledTimes(2);
  });

  it('marks an empty model answer as an error instead of a silent ready', async () => {
    mockSendByokChatCompletion.mockResolvedValueOnce(
      makeResponse({ text: null })
    );
    const { orchestrator, aiRequest } = makeOrchestrator();

    await orchestrator.startNewChat('Say nothing');

    expect(aiRequest.status).toBe('error');
    expect(aiRequest.error && aiRequest.error.code).toBe('byok-empty-answer');
  });
});

describe('capToolOutput', () => {
  it('keeps a short output unchanged', () => {
    expect(capToolOutput('{"success":true}')).toBe('{"success":true}');
  });

  it('truncates a long output to the cap and marks the cut', () => {
    const longOutput = 'x'.repeat(BYOK_TOOL_OUTPUT_CAP + 5000);
    const capped = capToolOutput(longOutput);

    expect(capped.length).toBeLessThanOrEqual(BYOK_TOOL_OUTPUT_CAP + 50);
    expect(capped).toContain('[output truncated]');
    expect(capped.startsWith('x'.repeat(BYOK_TOOL_OUTPUT_CAP))).toBe(true);
  });
});

describe('createByokSubAgentRunner', () => {
  it('is the real Phase 8 sub-agent runner (re-exported from ByokSubAgents)', () => {
    // The Phase 4 null-seam became real in Phase 8: the factory now builds
    // the scout/reviewer runner (its behavior is covered in
    // ByokSubAgents.spec.js) — assert the seam is no longer null.
    expect(typeof createByokSubAgentRunner).toBe('function');
    expect(
      createByokSubAgentRunner({
        connection: { baseUrl: 'https://example.invalid/v1', apiKey: 'k' },
        settings: DEFAULT_BYOK_SETTINGS,
        hasOpenedProject: () => false,
        getProject: () => null,
        getProjectUserContent: async () => null,
        createExecutor: () => {
          throw new Error('not used');
        },
        usageTracker: createByokUsageTracker(),
        sharedTurnBudget: { remaining: 10 },
      })
    ).not.toBe(null);
  });
});

const gd: libGDevelop = global.gd;

describe('ByokOrchestrator: local event writing interception (Phase 5)', () => {
  const makeProjectWithScene = (): any => {
    const project = gd.ProjectHelper.createNewGDJSProject();
    project.insertNewLayout('TestScene', 0);
    return project;
  };

  it('intercepts add_scene_events before the editor registry (zero backend, zero executor)', async () => {
    const project = makeProjectWithScene();
    try {
      const executeFunctionCalls = makeFakeExecutor();
      mockSendByokChatCompletion
        .mockResolvedValueOnce(
          makeResponse({
            toolCalls: [
              makeToolCall(
                'call-1',
                'add_scene_events',
                JSON.stringify({
                  scene_name: 'TestScene',
                  event_batches: [
                    {
                      event_script: 'always:\n  Wait(1)',
                      placement_relation: 'insert_at_end',
                    },
                  ],
                })
              ),
            ],
          })
        )
        .mockResolvedValueOnce(makeResponse({ text: 'Done.' }))
        // The completion gate (Phase 8.2) nudges once after an unverified
        // edit: the second claim is honored with the gate block.
        .mockResolvedValueOnce(makeResponse({ text: 'Done (confirmed).' }));
      const { orchestrator, aiRequest } = makeOrchestrator({
        executeFunctionCalls,
        getProject: () => project,
      });

      await orchestrator.startNewChat('Add events');

      expect(executeFunctionCalls).not.toHaveBeenCalled();
      const outputs = (aiRequest.output || []).filter(
        message => message.type === 'function_call_output'
      );
      expect(outputs).toHaveLength(1);
      const parsedOutput = JSON.parse((outputs[0]: any).output);
      expect(parsedOutput.success).toBe(true);
      expect(parsedOutput.message).toContain('Applied 1');
      // The events were really written to the scene, locally.
      const { renderEventsAsEventScript } = (jest.requireActual(
        '../../EventsSheet/EventsTree/TextRenderer/EventScriptRenderer'
      ): any);
      const { text } = renderEventsAsEventScript({
        eventsList: project.getLayout('TestScene').getEvents(),
      });
      expect(text).toContain('Wait(1)');
      expect(aiRequest.status).toBe('ready');
    } finally {
      project.delete();
    }
  });

  it('maps the hosted generate_events alias to the same local implementation', async () => {
    const project = makeProjectWithScene();
    try {
      const executeFunctionCalls = makeFakeExecutor();
      mockSendByokChatCompletion
        .mockResolvedValueOnce(
          makeResponse({
            toolCalls: [
              makeToolCall(
                'call-1',
                'generate_events',
                JSON.stringify({
                  scene_name: 'TestScene',
                  event_batches: [
                    {
                      event_script: 'always:\n  Wait(2)',
                      placement_relation: 'insert_at_end',
                    },
                  ],
                })
              ),
            ],
          })
        )
        .mockResolvedValueOnce(makeResponse({ text: 'Done.' }));
      const { orchestrator, aiRequest } = makeOrchestrator({
        executeFunctionCalls,
        getProject: () => project,
      });

      await orchestrator.startNewChat('Add events');

      expect(executeFunctionCalls).not.toHaveBeenCalled();
      const outputs = (aiRequest.output || []).filter(
        message => message.type === 'function_call_output'
      );
      expect(JSON.parse((outputs[0]: any).output).success).toBe(true);
    } finally {
      project.delete();
    }
  });
});

describe('ByokOrchestrator: stuck-loop guard (Phase 5)', () => {
  it('refuses the third identical call with a corrective output, stops on the fourth', async () => {
    const executeFunctionCalls = makeFakeExecutor();
    let round = 0;
    mockSendByokChatCompletion.mockImplementation(async () => {
      round++;
      return makeResponse({
        toolCalls: [
          makeToolCall(
            `call-${round}`,
            'describe_instances',
            '{"scene_name":"Scene"}'
          ),
        ],
      });
    });
    const { orchestrator, aiRequest } = makeOrchestrator({
      executeFunctionCalls,
    });

    await orchestrator.startNewChat('Loop');

    expect(aiRequest.status).toBe('error');
    expect(aiRequest.error && aiRequest.error.code).toBe(
      'byok-repeated-tool-call-loop'
    );
    // Rounds 1 and 2 executed; round 3 was refused with the corrective
    // message; round 4 stopped the chat.
    expect(executeFunctionCalls).toHaveBeenCalledTimes(2);
    expect(mockSendByokChatCompletion).toHaveBeenCalledTimes(4);
    const outputs = (aiRequest.output || []).filter(
      message => message.type === 'function_call_output'
    );
    expect(outputs).toHaveLength(4);
    expect(JSON.parse((outputs[2]: any).output).message).toContain(
      'already called this exact tool'
    );
    expect(JSON.parse((outputs[3]: any).output).message).toContain(
      'already called this exact tool'
    );
  });

  it('never trips the guard on repeated create_or_update_plan calls', async () => {
    let round = 0;
    mockSendByokChatCompletion.mockImplementation(async () => {
      round++;
      if (round > 3) return makeResponse({ text: 'Planned.' });
      return makeResponse({
        toolCalls: [
          makeToolCall(
            `call-${round}`,
            'create_or_update_plan',
            '{"tasks":[{"id":"task-1"}]}'
          ),
        ],
      });
    });
    const { orchestrator, aiRequest } = makeOrchestrator();

    await orchestrator.startNewChat('Plan');

    expect(aiRequest.status).toBe('ready');
    const outputs = (aiRequest.output || []).filter(
      message => message.type === 'function_call_output'
    );
    expect(outputs).toHaveLength(3);
    for (const output of outputs) {
      expect(JSON.parse((output: any).output).success).toBe(true);
    }
  });
});

describe('ByokOrchestrator: project creation and live getters (Phase 5)', () => {
  it('advertises initialize_project only while no project is open', async () => {
    mockSendByokChatCompletion.mockResolvedValueOnce(
      makeResponse({ text: 'Hi.' })
    );
    const { orchestrator } = makeOrchestrator({
      hasOpenedProject: () => false,
    });
    await orchestrator.startNewChat('Hi');

    const firstCallTools =
      mockSendByokChatCompletion.mock.calls[0][0].options.tools;
    expect(firstCallTools.map((tool: any) => tool.function.name)).toContain(
      'initialize_project'
    );
  });

  it('re-reads the project getters after initialize_project creates a project mid-chat', async () => {
    const createdProject = gd.ProjectHelper.createNewGDJSProject();
    createdProject.insertNewLayout('NewScene', 0);
    try {
      let projectIsOpen = false;
      const getProjectUserContent = mockFn(
        jest.fn(async () => '{"scenes":[]}')
      );
      const executor = mockFn(
        jest.fn(async (functionCalls: Array<any>) => ({
          results: functionCalls.map((functionCall: any) => ({
            status: 'finished',
            call_id: functionCall.call_id,
            success: true,
            output: { message: 'created' },
          })),
          createdSceneNames: [],
          createdProject,
        }))
      );
      mockSendByokChatCompletion
        .mockResolvedValueOnce(
          makeResponse({
            toolCalls: [
              makeToolCall(
                'call-1',
                'initialize_project',
                '{"project_name":"My game","template_slug":""}'
              ),
            ],
          })
        )
        .mockResolvedValueOnce(makeResponse({ text: 'Created.' }));
      const { orchestrator } = makeOrchestrator({
        hasOpenedProject: () => projectIsOpen,
        getProject: () => (projectIsOpen ? createdProject : null),
        getExecutor: () => executor,
        getProjectUserContent,
        onFunctionCallsExecuted: (results: any, meta: any) => {
          // The container remembers the created project synchronously —
          // the getters must see it on the very next round.
          if (meta.createdProject) projectIsOpen = true;
        },
      });

      await orchestrator.startNewChat('Make me a game');

      // The snapshot was fetched once for the message and once after the
      // project was created — not frozen at chat start.
      expect(getProjectUserContent).toHaveBeenCalledTimes(2);
      // The first turn advertised initialize_project; the second (after the
      // project exists) did not, and its system prompt left the
      // "no project" section behind.
      const firstCallOptions =
        mockSendByokChatCompletion.mock.calls[0][0].options;
      const secondCallOptions =
        mockSendByokChatCompletion.mock.calls[1][0].options;
      expect(
        firstCallOptions.tools.map((tool: any) => tool.function.name)
      ).toContain('initialize_project');
      expect(
        secondCallOptions.tools.map((tool: any) => tool.function.name)
      ).not.toContain('initialize_project');
      expect(firstCallOptions.messages[0].content).toContain(
        'initialize_project first'
      );
      expect(secondCallOptions.messages[0].content).not.toContain(
        'initialize_project first'
      );
    } finally {
      createdProject.delete();
    }
  });
});

describe('ByokOrchestrator: images (Phase 6)', () => {
  const makeImageRuntimeDeps = () => ({
    captureSceneCanvas: () => 'data:image/jpeg;base64,QUJD',
    invokePreviewCapture: async () => ({ ok: false, error: 'unused' }),
    getPreviewLauncher: () => null,
    storeImage: async () =>
      registerByokImage({
        dataUrl: 'data:image/jpeg;base64,QUJD',
        width: 1024,
        height: 1024,
      }),
  });

  const countImageParts = (messages: Array<any>): number =>
    messages.reduce((count: number, message: any) => {
      if (message.role !== 'user' || !Array.isArray(message.content)) {
        return count;
      }
      return (
        count +
        message.content.filter((part: any) => part.type === 'image_url').length
      );
    }, 0);

  const runCaptureRounds = async (overrides: any) => {
    let round = 0;
    mockSendByokChatCompletion.mockImplementation(async () => {
      round++;
      if (round > 3) return makeResponse({ text: 'Seen.' });
      return makeResponse({
        toolCalls: [
          makeToolCall(
            `call-${round}`,
            'capture_scene_screenshot',
            JSON.stringify({ scene_name: `Scene ${round}` })
          ),
        ],
      });
    });
    const { orchestrator, aiRequest } = makeOrchestrator(overrides);
    await orchestrator.startNewChat('Look');
    const calls = mockSendByokChatCompletion.mock.calls;
    const lastCallMessages = calls[calls.length - 1][0].options.messages;
    return { aiRequest, lastCallMessages };
  };

  it('materializes screenshots as image parts, keeping only the latest 2', async () => {
    const { aiRequest, lastCallMessages } = await runCaptureRounds({
      runtimeDeps: makeImageRuntimeDeps(),
    });

    expect(aiRequest.status).toBe('ready');
    expect(countImageParts(lastCallMessages)).toBe(2);
    // The oldest capture was replaced by a one-line placeholder.
    const placeholderText = lastCallMessages
      .filter((message: any) => Array.isArray(message.content))
      .map((message: any) => message.content[0].text)
      .join('\n');
    expect(placeholderText).toContain('removed to save context');
  });

  it('sends no image part at all with imageSupport "no"', async () => {
    const { aiRequest, lastCallMessages } = await runCaptureRounds({
      settings: {
        ...DEFAULT_BYOK_SETTINGS,
        modelName: 'test-model',
        imageSupport: 'no',
      },
      runtimeDeps: makeImageRuntimeDeps(),
    });

    expect(aiRequest.status).toBe('ready');
    expect(countImageParts(lastCallMessages)).toBe(0);
  });

  it('degrades to text-only once when the endpoint rejects images (auto mode)', async () => {
    const imageRejection = {
      response: {
        status: 400,
        data: {
          error: { message: 'This model does not support image content.' },
        },
      },
    };
    mockSendByokChatCompletion
      .mockResolvedValueOnce(
        makeResponse({
          toolCalls: [makeToolCall('call-1', 'capture_scene_screenshot', '{}')],
        })
      )
      .mockRejectedValueOnce(imageRejection)
      .mockResolvedValueOnce(makeResponse({ text: 'Text is enough.' }));
    const { orchestrator, aiRequest } = makeOrchestrator({
      runtimeDeps: makeImageRuntimeDeps(),
    });

    await orchestrator.startNewChat('Look');

    expect(aiRequest.status).toBe('ready');
    expect(mockSendByokChatCompletion).toHaveBeenCalledTimes(3);
    // The retried request carries no image part.
    const retriedMessages =
      mockSendByokChatCompletion.mock.calls[2][0].options.messages;
    expect(countImageParts(retriedMessages)).toBe(0);
  });

  it('evicts images under context pressure instead of stopping while text is small', async () => {
    // Two captures put two images in the transcript; the model then keeps
    // calling a cheap tool with usage that overflows the ratio until the
    // images are evicted — after which usage drops and the chat finishes.
    let round = 0;
    const inflatedUsage = {
      prompt_tokens: 8000,
      completion_tokens: 512,
      total_tokens: 8512,
    };
    const normalUsage = {
      prompt_tokens: 1000,
      completion_tokens: 100,
      total_tokens: 1100,
    };
    mockSendByokChatCompletion.mockImplementation(async () => {
      round++;
      if (round <= 2) {
        return makeResponse({
          toolCalls: [
            makeToolCall(
              `capture-${round}`,
              'capture_scene_screenshot',
              JSON.stringify({ scene_name: `Scene ${round}` })
            ),
          ],
        });
      }
      if (round <= 4) {
        // Two inflated rounds: enough to evict both images (2 to 1 to 0),
        // not enough to hard-stop while the text is small.
        return makeResponse({
          toolCalls: [
            makeToolCall(
              `plan-${round}`,
              'create_or_update_plan',
              `{"tasks":[{"id":"task-${round}"}]}`
            ),
          ],
          usage: inflatedUsage,
        });
      }
      if (round === 5) {
        return makeResponse({
          toolCalls: [
            makeToolCall(
              `plan-${round}`,
              'create_or_update_plan',
              `{"tasks":[{"id":"task-${round}"}]}`
            ),
          ],
          usage: normalUsage,
        });
      }
      return makeResponse({ text: 'Done.', usage: normalUsage });
    });
    const { orchestrator, aiRequest } = makeOrchestrator({
      runtimeDeps: makeImageRuntimeDeps(),
    });

    await orchestrator.startNewChat('Look then plan');

    // The loop survived the inflated rounds by evicting images (2 → 1 → 0)
    // and completed once usage came back down — images alone never stopped
    // the chat.
    expect(aiRequest.status).toBe('ready');
    const finalMessages =
      mockSendByokChatCompletion.mock.calls[
        mockSendByokChatCompletion.mock.calls.length - 1
      ][0].options.messages;
    expect(countImageParts(finalMessages)).toBe(0);
  });
});
