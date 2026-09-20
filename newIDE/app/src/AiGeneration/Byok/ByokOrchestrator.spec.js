// @flow
import {
  createByokOrchestrator,
  createByokSubAgentRunner,
  capToolOutput,
  BYOK_TOOL_OUTPUT_CAP,
  MAX_BYOK_TOOL_ROUNDS,
} from './ByokOrchestrator';
import { DEFAULT_BYOK_SETTINGS } from './ByokTypes';
import { createByokAiRequestShell } from './ByokTranscript';
import { sendByokChatCompletionWithRetries } from './ByokClient';

jest.mock('./ByokClient', () => ({
  sendByokChatCompletionWithRetries: jest.fn(),
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
  const orchestrator = createByokOrchestrator({
    connection: { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test' },
    settings: { ...DEFAULT_BYOK_SETTINGS, modelName: 'test-model' },
    aiRequest,
    hasOpenedProject: true,
    executeFunctionCalls: makeFakeExecutor(),
    getProjectUserContent: async () => '{"scenes":[]}',
    onAiRequestUpdated,
    doesCallRequireApproval: () => false,
    onRequestEditApproval: async () => true,
    usageTracker,
    onFunctionCallsExecuted: mockFn(jest.fn()),
    ...overrides,
  });
  return { orchestrator, aiRequest, onAiRequestUpdated, usageTracker };
};

describe('ByokOrchestrator', () => {
  beforeEach(() => {
    mockSendByokChatCompletion.mockReset();
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
      toolCalls: [makeToolCall(`call-x`, 'describe_instances', '{}')],
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

  it('suspends the chat when an edit approval is refused, without executing', async () => {
    const executeFunctionCalls = makeFakeExecutor();
    const onRequestEditApproval = mockFn((jest.fn(async () => false): any));
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

    await orchestrator.startNewChat('Create something');

    expect(onRequestEditApproval).toHaveBeenCalledTimes(1);
    expect(executeFunctionCalls).not.toHaveBeenCalled();
    expect(aiRequest.status).toBe('suspended');
    expect(
      (aiRequest.output || []).filter(
        message => message.type === 'function_call_output'
      )
    ).toHaveLength(0);
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
        toolCalls: [makeToolCall('call-1', 'describe_instances', '{}')],
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
  it('returns null in v1 (single-agent BYOK)', () => {
    expect(createByokSubAgentRunner()).toBe(null);
  });
});
