// @flow
import axios from 'axios';
import {
  buildEndpointUrl,
  fetchByokModels,
  sendByokChatCompletion,
  sendByokChatCompletionWithRetries,
} from './ByokClient';
import { type ByokChatCompletionOptions } from './ByokTypes';

jest.mock('axios');

const mockFn = (fn: any): JestMockFn<any, any> => fn;

const API_KEY = 'sk-test-key-1234567890';
const BASE_URL = 'https://api.example.com/v1';
const CONNECTION = { baseUrl: BASE_URL, apiKey: API_KEY };

// A synthetic axios-shaped rejection, like axios produces for an HTTP error.
const makeResponseError = (status: number, data?: any): Object => ({
  response: { status, data: data === undefined ? {} : data },
  request: {},
});

// A synthetic axios-shaped rejection for a request that got no response.
const makeRequestError = (code?: string | null): Object => ({
  response: null,
  request: {},
  code: code === undefined ? null : code,
});

const makeModelListResponse = (data: any): Object => ({ data });

const makeChatResponse = (overrides?: Object): Object => ({
  choices: [
    {
      message: { role: 'assistant', content: 'Hello!' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  ...overrides,
});

const makeChatOptions = (
  overrides?: Partial<ByokChatCompletionOptions>
): ByokChatCompletionOptions => ({
  model: 'my-model',
  messages: [{ role: 'user', content: 'Hi' }],
  ...overrides,
});

describe('buildEndpointUrl', () => {
  it('appends the path to the base URL', () => {
    expect(buildEndpointUrl('https://host/v1', '/models')).toBe(
      'https://host/v1/models'
    );
  });

  it('trims a trailing slash from the base URL', () => {
    expect(buildEndpointUrl('https://host/v1/', '/models')).toBe(
      'https://host/v1/models'
    );
    expect(buildEndpointUrl('https://host/v1//', '/chat/completions')).toBe(
      'https://host/v1/chat/completions'
    );
  });

  it('keeps the /v1 segment of the base URL as-is', () => {
    // The base URL already includes /v1 if the provider uses it: it must
    // not be added or removed by the client.
    expect(buildEndpointUrl('http://localhost:1234/v1', '/models')).toBe(
      'http://localhost:1234/v1/models'
    );
    expect(buildEndpointUrl('https://host', '/models')).toBe(
      'https://host/models'
    );
  });
});

describe('fetchByokModels', () => {
  beforeEach(() => {
    mockFn(axios.get).mockReset();
  });

  it('gets {baseUrl}/models with the key in the Authorization header only', async () => {
    mockFn(axios.get).mockResolvedValueOnce(
      makeModelListResponse([{ id: 'model-a' }, { id: 'model-b' }])
    );

    await fetchByokModels(CONNECTION);

    expect(mockFn(axios.get)).toHaveBeenCalledTimes(1);
    const [url, config] = mockFn(axios.get).mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/models');
    expect(config.headers.Authorization).toBe(`Bearer ${API_KEY}`);
    // The URL and the (absent) body never contain the key: it travels in
    // the Authorization header only.
    expect(url).not.toContain(API_KEY);
  });

  it('maps the entries to model infos, without context window (parsed later)', async () => {
    mockFn(axios.get).mockResolvedValueOnce(
      makeModelListResponse([
        { id: 'model-a', context_length: 4096 },
        { id: 'model-b' },
      ])
    );

    const models = await fetchByokModels(CONNECTION);

    expect(models).toEqual([
      { id: 'model-a', contextWindowTokens: null },
      { id: 'model-b', contextWindowTokens: null },
    ]);
  });

  it('skips entries without an id', async () => {
    mockFn(axios.get).mockResolvedValueOnce(
      makeModelListResponse([{ nope: true }, { id: 'model-a' }])
    );

    const models = await fetchByokModels(CONNECTION);

    expect(models).toEqual([{ id: 'model-a', contextWindowTokens: null }]);
  });

  it('throws a ByokError when the response is not a model list', async () => {
    mockFn(axios.get).mockResolvedValueOnce(makeModelListResponse({ nope: 1 }));

    let thrownError = null;
    try {
      await fetchByokModels(CONNECTION);
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).not.toBe(null);
    expect(thrownError.kind).toBe('unknown');
    expect(thrownError.message).toContain('did not return a model list');
  });

  it('throws an authentication error on a 401, without leaking the key', async () => {
    mockFn(axios.get).mockRejectedValueOnce(
      makeResponseError(401, { error: { message: 'Invalid API key' } })
    );

    let thrownError = null;
    try {
      await fetchByokModels(CONNECTION);
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError.kind).toBe('authentication');
    expect(thrownError.status).toBe(401);
    expect(thrownError.message).toBe('Invalid API key');
    expect(thrownError.message).not.toContain(API_KEY);
  });
});

describe('sendByokChatCompletion', () => {
  beforeEach(() => {
    mockFn(axios.post).mockReset();
  });

  it('posts to {baseUrl}/chat/completions with the key in the Authorization header only', async () => {
    mockFn(axios.post).mockResolvedValueOnce({ data: makeChatResponse() });

    await sendByokChatCompletion({
      ...CONNECTION,
      options: makeChatOptions(),
    });

    expect(mockFn(axios.post)).toHaveBeenCalledTimes(1);
    const [url, body, config] = mockFn(axios.post).mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect(body).toEqual({ model: 'my-model', messages: [{ role: 'user', content: 'Hi' }] });
    expect(config.headers.Authorization).toBe(`Bearer ${API_KEY}`);
    // The URL and the body never contain the key: it travels in the
    // Authorization header only.
    expect(url).not.toContain(API_KEY);
    expect(JSON.stringify(body)).not.toContain(API_KEY);
  });

  it('includes reasoning_effort in the body only when it is set', async () => {
    mockFn(axios.post).mockResolvedValueOnce({ data: makeChatResponse() });
    await sendByokChatCompletion({
      ...CONNECTION,
      options: makeChatOptions({ reasoningEffort: 'high' }),
    });
    expect(mockFn(axios.post).mock.calls[0][1].reasoning_effort).toBe('high');

    mockFn(axios.post).mockResolvedValueOnce({ data: makeChatResponse() });
    await sendByokChatCompletion({
      ...CONNECTION,
      options: makeChatOptions(),
    });
    expect(mockFn(axios.post).mock.calls[1][1].reasoning_effort).toBeUndefined();
  });

  it('includes the tools when provided, and not otherwise', async () => {
    const tools = [{ type: 'function', function: { name: 'create_scene' } }];
    mockFn(axios.post).mockResolvedValueOnce({ data: makeChatResponse() });
    await sendByokChatCompletion({
      ...CONNECTION,
      options: makeChatOptions({ tools }),
    });
    expect(mockFn(axios.post).mock.calls[0][1].tools).toEqual(tools);

    mockFn(axios.post).mockResolvedValueOnce({ data: makeChatResponse() });
    await sendByokChatCompletion({
      ...CONNECTION,
      options: makeChatOptions(),
    });
    expect(
      'tools' in mockFn(axios.post).mock.calls[1][1]
    ).toBe(false);
  });

  it('uses a 120 seconds default timeout, overridable with timeoutMs', async () => {
    mockFn(axios.post).mockResolvedValueOnce({ data: makeChatResponse() });
    await sendByokChatCompletion({
      ...CONNECTION,
      options: makeChatOptions(),
    });
    expect(mockFn(axios.post).mock.calls[0][2].timeout).toBe(120000);

    mockFn(axios.post).mockResolvedValueOnce({ data: makeChatResponse() });
    await sendByokChatCompletion({
      ...CONNECTION,
      options: makeChatOptions({ timeoutMs: 5000 }),
    });
    expect(mockFn(axios.post).mock.calls[1][2].timeout).toBe(5000);
  });

  it('returns the response when it has at least one choice', async () => {
    const response = makeChatResponse();
    mockFn(axios.post).mockResolvedValueOnce({ data: response });

    const result = await sendByokChatCompletion({
      ...CONNECTION,
      options: makeChatOptions(),
    });

    expect(result).toEqual(response);
  });

  it('throws an unknown ByokError when the response has no choice', async () => {
    mockFn(axios.post).mockResolvedValueOnce({
      data: makeChatResponse({ choices: [] }),
    });

    let thrownError = null;
    try {
      await sendByokChatCompletion({
        ...CONNECTION,
        options: makeChatOptions(),
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError.kind).toBe('unknown');
    expect(thrownError.message).toContain('unexpected chat response');
  });

  it('throws an unknown ByokError when the response is not an object', async () => {
    mockFn(axios.post).mockResolvedValueOnce({ data: 'not an object' });

    let thrownError = null;
    try {
      await sendByokChatCompletion({
        ...CONNECTION,
        options: makeChatOptions(),
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError.kind).toBe('unknown');
  });

  it('classifies a 429 response as rate-limit', async () => {
    mockFn(axios.post).mockRejectedValueOnce(
      makeResponseError(429, { error: { message: 'Too many requests' } })
    );

    let thrownError = null;
    try {
      await sendByokChatCompletion({
        ...CONNECTION,
        options: makeChatOptions(),
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError.kind).toBe('rate-limit');
    expect(thrownError.status).toBe(429);
  });

  it('classifies a request that never got a response as network', async () => {
    mockFn(axios.post).mockRejectedValueOnce(makeRequestError());

    let thrownError = null;
    try {
      await sendByokChatCompletion({
        ...CONNECTION,
        options: makeChatOptions(),
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError.kind).toBe('network');
  });

  it('never includes the API key in a thrown message, even if the server echoes it', async () => {
    mockFn(axios.post).mockRejectedValueOnce(
      makeResponseError(401, {
        error: { message: `The key ${API_KEY} is invalid.` },
      })
    );

    let thrownError = null;
    try {
      await sendByokChatCompletion({
        ...CONNECTION,
        options: makeChatOptions(),
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError.message).not.toContain(API_KEY);
    expect(thrownError.message).toContain('[redacted]');
  });
});

describe('sendByokChatCompletionWithRetries', () => {
  beforeEach(() => {
    mockFn(axios.post).mockReset();
  });

  it('retries a 500 and succeeds on the second attempt', async () => {
    mockFn(axios.post)
      .mockRejectedValueOnce(
        makeResponseError(500, { error: { message: 'Overloaded' } })
      )
      .mockResolvedValueOnce({ data: makeChatResponse() });

    const result = await sendByokChatCompletionWithRetries({
      ...CONNECTION,
      options: makeChatOptions(),
    });

    expect(result).toEqual(makeChatResponse());
    expect(mockFn(axios.post)).toHaveBeenCalledTimes(2);
  });

  it('fails with the original error after the retries are exhausted', async () => {
    const serverError = makeResponseError(500, {
      error: { message: 'Overloaded' },
    });
    mockFn(axios.post)
      .mockRejectedValueOnce(serverError)
      .mockRejectedValueOnce(serverError)
      .mockRejectedValueOnce(serverError);

    let thrownError = null;
    try {
      await sendByokChatCompletionWithRetries({
        ...CONNECTION,
        options: makeChatOptions(),
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError.kind).toBe('server');
    expect(thrownError.message).toBe('Overloaded');
    // The first attempt + 2 retries.
    expect(mockFn(axios.post)).toHaveBeenCalledTimes(3);
  });

  it('does not retry an authentication error', async () => {
    mockFn(axios.post).mockRejectedValueOnce(makeResponseError(401));

    let thrownError = null;
    try {
      await sendByokChatCompletionWithRetries({
        ...CONNECTION,
        options: makeChatOptions(),
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError.kind).toBe('authentication');
    expect(mockFn(axios.post)).toHaveBeenCalledTimes(1);
  });

  it('retries a network error with backoff', async () => {
    mockFn(axios.post)
      .mockRejectedValueOnce(makeRequestError(null))
      .mockRejectedValueOnce(makeRequestError(null))
      .mockRejectedValueOnce(makeRequestError(null));

    let thrownError = null;
    try {
      await sendByokChatCompletionWithRetries({
        ...CONNECTION,
        options: makeChatOptions(),
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError.kind).toBe('network');
    // The first attempt + 2 retries.
    expect(mockFn(axios.post)).toHaveBeenCalledTimes(3);
  });

  it('retries once without reasoning_effort when the rejection names it', async () => {
    mockFn(axios.post)
      .mockRejectedValueOnce(
        makeResponseError(400, {
          error: {
            message: "Unknown parameter: 'reasoning_effort' is not supported.",
          },
        })
      )
      .mockResolvedValueOnce({ data: makeChatResponse() });

    const result = await sendByokChatCompletionWithRetries({
      ...CONNECTION,
      options: makeChatOptions({ reasoningEffort: 'high' }),
    });

    expect(result).toEqual(makeChatResponse());
    expect(mockFn(axios.post)).toHaveBeenCalledTimes(2);
    expect(mockFn(axios.post).mock.calls[0][1].reasoning_effort).toBe('high');
    expect(
      'reasoning_effort' in mockFn(axios.post).mock.calls[1][1]
    ).toBe(false);
  });

  it('does not strip reasoning_effort for a 400 about something else', async () => {
    mockFn(axios.post).mockRejectedValueOnce(
      makeResponseError(400, {
        error: { message: "Model 'nope' does not exist." },
      })
    );

    let thrownError = null;
    try {
      await sendByokChatCompletionWithRetries({
        ...CONNECTION,
        options: makeChatOptions({ reasoningEffort: 'high' }),
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError.kind).toBe('invalid-request');
    expect(mockFn(axios.post)).toHaveBeenCalledTimes(1);
  });

  it('does not retry the reasoning-effort degradation when no effort was set', async () => {
    // A server rejecting reasoning_effort cannot happen when none was sent,
    // but the guard must not degrade an already-parameter-free request.
    mockFn(axios.post).mockRejectedValueOnce(
      makeResponseError(400, {
        error: { message: 'reasoning_effort is not supported.' },
      })
    );

    let thrownError = null;
    try {
      await sendByokChatCompletionWithRetries({
        ...CONNECTION,
        options: makeChatOptions(),
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError.kind).toBe('invalid-request');
    expect(mockFn(axios.post)).toHaveBeenCalledTimes(1);
  });
});

