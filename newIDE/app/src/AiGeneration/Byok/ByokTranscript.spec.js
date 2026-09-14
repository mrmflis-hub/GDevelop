// @flow
import {
  assistantMessageToByokMessage,
  byokResponseToAssistantMessage,
  byokToolResultToFunctionCallOutput,
  createByokAiRequestShell,
  userRequestToByokMessage,
} from './ByokTranscript';
import { getFunctionCallsToProcess } from '../AiRequestUtils';
import { type AiRequestMessage } from '../../Utils/GDevelopServices/Generation';
import {
  type ByokChatCompletionResponse,
  type ByokToolCall,
} from './ByokTypes';

const makeToolCall = (
  id: string,
  name: string,
  args?: string
): ByokToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: args || '{}' },
});

const makeResponse = (
  content?: string | null,
  toolCalls?: Array<ByokToolCall>
): ByokChatCompletionResponse => ({
  choices: [
    {
      message: {
        role: 'assistant',
        content: content === undefined ? 'Done!' : content,
        ...(toolCalls ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: 'tool_calls',
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
});

const makeUserRequestMessage = (text: string): AiRequestMessage => ({
  type: 'message',
  status: 'completed',
  role: 'user',
  content: [{ type: 'user_request', status: 'completed', text }],
});

describe('byokResponseToAssistantMessage', () => {
  it('maps a response with text and 2 tool calls to one assistant message with 3 content items', () => {
    const message = byokResponseToAssistantMessage(
      makeResponse('Let me check.', [
        makeToolCall('call-1', 'describe_instances', '{"scene_name":"Scene"}'),
        makeToolCall('call-2', 'read_scene_events'),
      ])
    );

    expect(message.type).toBe('message');
    expect(message.status).toBe('completed');
    if (message.type !== 'message' || message.role !== 'assistant') {
      throw new Error('Expected an assistant message');
    }
    expect(message.content).toHaveLength(3);
    expect(message.content[0]).toEqual({
      type: 'output_text',
      status: 'completed',
      text: 'Let me check.',
      annotations: [],
    });
    expect(message.content[1]).toEqual({
      type: 'function_call',
      status: 'completed',
      call_id: 'call-1',
      name: 'describe_instances',
      arguments: '{"scene_name":"Scene"}',
    });
    expect(message.content[2]).toEqual({
      type: 'function_call',
      status: 'completed',
      call_id: 'call-2',
      name: 'read_scene_events',
      arguments: '{}',
    });
  });

  it('skips the output_text item when the model answers with no text', () => {
    const message = byokResponseToAssistantMessage(
      makeResponse(null, [makeToolCall('call-1', 'create_scene')])
    );
    if (message.type !== 'message') throw new Error('Expected a message');
    expect(message.content).toHaveLength(1);
    expect(message.content[0].type).toBe('function_call');
  });

  it('maps a text-only response to a single output_text item', () => {
    const message = byokResponseToAssistantMessage(makeResponse('Done!'));
    if (message.type !== 'message') throw new Error('Expected a message');
    expect(message.content).toHaveLength(1);
    expect(message.content[0]).toEqual({
      type: 'output_text',
      status: 'completed',
      text: 'Done!',
      annotations: [],
    });
  });

  it('maps an empty response to an assistant message with no content', () => {
    const message = byokResponseToAssistantMessage(makeResponse(null));
    if (message.type !== 'message') throw new Error('Expected a message');
    expect(message.content).toEqual([]);
  });
});

describe('byokToolResultToFunctionCallOutput', () => {
  it('maps a tool result to a standalone function_call_output message', () => {
    expect(
      byokToolResultToFunctionCallOutput(
        'call-1',
        '{"success":true,"message":"Created."}'
      )
    ).toEqual({
      type: 'function_call_output',
      call_id: 'call-1',
      output: '{"success":true,"message":"Created."}',
    });
  });
});

describe('userRequestToByokMessage', () => {
  it('maps the user text to a user message', () => {
    expect(userRequestToByokMessage('Create a scene')).toEqual({
      role: 'user',
      content: 'Create a scene',
    });
  });
});

describe('assistantMessageToByokMessage', () => {
  it('rebuilds an assistant message with its tool calls (call_ids preserved)', () => {
    const assistantMessage = byokResponseToAssistantMessage(
      makeResponse('Checking.', [
        makeToolCall('call-1', 'describe_instances', '{"scene_name":"Scene"}'),
      ])
    );

    expect(assistantMessageToByokMessage(assistantMessage)).toEqual({
      role: 'assistant',
      content: 'Checking.',
      tool_calls: [
        {
          id: 'call-1',
          type: 'function',
          function: {
            name: 'describe_instances',
            arguments: '{"scene_name":"Scene"}',
          },
        },
      ],
    });
  });

  it('rebuilds a tool result as a tool message with tool_call_id', () => {
    const output = byokToolResultToFunctionCallOutput(
      'call-1',
      '{"success":true}'
    );

    expect(assistantMessageToByokMessage(output)).toEqual({
      role: 'tool',
      content: '{"success":true}',
      tool_call_id: 'call-1',
    });
  });

  it('rebuilds a user request as a user message', () => {
    expect(
      assistantMessageToByokMessage(makeUserRequestMessage('Make a game'))
    ).toEqual({ role: 'user', content: 'Make a game' });
  });

  it('uses null content for an assistant message with only tool calls', () => {
    const assistantMessage = byokResponseToAssistantMessage(
      makeResponse(null, [makeToolCall('call-1', 'create_scene')])
    );

    const byokMessage = assistantMessageToByokMessage(assistantMessage);
    expect(byokMessage.role).toBe('assistant');
    if (byokMessage.role !== 'assistant') throw new Error('Expected assistant');
    expect(byokMessage.content).toBe(null);
  });
});

describe('round-trip and compatibility with the transcript helpers', () => {
  it('is compatible with getFunctionCallsToProcess (the shell + mapped response)', () => {
    const aiRequest = createByokAiRequestShell('byok-chat-1');
    const assistantMessage = byokResponseToAssistantMessage(
      makeResponse('Placing instances.', [
        makeToolCall('call-1', 'put_2d_instances', '{"scene_name":"Scene"}'),
      ])
    );
    aiRequest.output = [
      makeUserRequestMessage('Add a player'),
      assistantMessage,
    ];

    const callsToProcess = getFunctionCallsToProcess({
      aiRequest,
      editorFunctionCallResults: null,
    });
    expect(callsToProcess).toHaveLength(1);
    expect(callsToProcess[0].call_id).toBe('call-1');
    expect(callsToProcess[0].name).toBe('put_2d_instances');
    expect(callsToProcess[0].arguments).toBe('{"scene_name":"Scene"}');
  });

  it('stops returning calls once their output is in the transcript', () => {
    const aiRequest = createByokAiRequestShell('byok-chat-1');
    const assistantMessage = byokResponseToAssistantMessage(
      makeResponse(null, [makeToolCall('call-1', 'create_scene')])
    );
    aiRequest.output = [
      assistantMessage,
      byokToolResultToFunctionCallOutput('call-1', '{"success":true}'),
    ];

    expect(
      getFunctionCallsToProcess({
        aiRequest,
        editorFunctionCallResults: null,
      })
    ).toEqual([]);
  });

  it('round-trips a full transcript through the Byok message mapping', () => {
    const transcript: Array<AiRequestMessage> = [
      makeUserRequestMessage('Create a scene'),
      byokResponseToAssistantMessage(
        makeResponse('On it.', [makeToolCall('call-1', 'create_scene')])
      ),
      byokToolResultToFunctionCallOutput('call-1', '{"success":true}'),
      byokResponseToAssistantMessage(makeResponse('Scene created!')),
    ];

    const byokMessages = transcript.map(message =>
      assistantMessageToByokMessage(message)
    );
    expect(byokMessages).toEqual([
      { role: 'user', content: 'Create a scene' },
      {
        role: 'assistant',
        content: 'On it.',
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'create_scene', arguments: '{}' },
          },
        ],
      },
      { role: 'tool', content: '{"success":true}', tool_call_id: 'call-1' },
      { role: 'assistant', content: 'Scene created!' },
    ]);
  });
});

describe('createByokAiRequestShell', () => {
  it('creates a working AiRequest with an empty transcript', () => {
    const aiRequest = createByokAiRequestShell('byok-chat-1');

    expect(aiRequest.id).toBe('byok-chat-1');
    expect(aiRequest.status).toBe('working');
    expect(aiRequest.error).toBe(null);
    expect(aiRequest.output).toEqual([]);
    expect(aiRequest.contextStats).toBe(null);
    expect(typeof aiRequest.createdAt).toBe('string');
    expect(aiRequest.createdAt).toBe(aiRequest.updatedAt);
  });

  it('accepts initial context stats', () => {
    const aiRequest = createByokAiRequestShell('byok-chat-1', {
      totalTokens: 150,
      usedPercentage: 0.02,
    });
    expect(aiRequest.contextStats).toEqual({
      totalTokens: 150,
      usedPercentage: 0.02,
    });
  });
});
