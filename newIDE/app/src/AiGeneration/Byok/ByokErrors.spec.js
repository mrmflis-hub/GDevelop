// @flow
import {
  classifyByokError,
  describeInvalidRequestForReasoningEffort,
  isRetryableByokError,
  makeByokError,
  redactSecretFromByokError,
  redactSecretFromMessage,
  type ByokError,
  type ByokErrorKind,
} from './ByokErrors';

// A synthetic axios-shaped error, like the ones axios rejects with.
const makeAxiosError = (overrides?: Object): Object => ({
  isAxiosError: true,
  response: null,
  request: {},
  code: null,
  ...overrides,
});

const makeAxiosResponseError = (
  status: number,
  data?: any
): Object =>
  makeAxiosError({
    response: { status, data: data === undefined ? {} : data },
  });

describe('classifyByokError', () => {
  it('classifies a 401 response as authentication', () => {
    const error = classifyByokError(makeAxiosResponseError(401));
    expect(error.kind).toBe('authentication');
    expect(error.status).toBe(401);
  });

  it('classifies a 403 response as forbidden', () => {
    const error = classifyByokError(makeAxiosResponseError(403));
    expect(error.kind).toBe('forbidden');
    expect(error.status).toBe(403);
  });

  it('classifies a 404 response as not-found', () => {
    const error = classifyByokError(makeAxiosResponseError(404));
    expect(error.kind).toBe('not-found');
    expect(error.status).toBe(404);
  });

  it('classifies a 429 response as rate-limit', () => {
    const error = classifyByokError(makeAxiosResponseError(429));
    expect(error.kind).toBe('rate-limit');
    expect(error.status).toBe(429);
  });

  it('classifies a 400 response as invalid-request', () => {
    const error = classifyByokError(makeAxiosResponseError(400));
    expect(error.kind).toBe('invalid-request');
    expect(error.status).toBe(400);
  });

  it('classifies a 500 response as server', () => {
    const error = classifyByokError(makeAxiosResponseError(500));
    expect(error.kind).toBe('server');
    expect(error.status).toBe(500);
  });

  it('classifies a 503 response as server', () => {
    const error = classifyByokError(makeAxiosResponseError(503));
    expect(error.kind).toBe('server');
    expect(error.status).toBe(503);
  });

  it('classifies an unexpected status (302) as unknown', () => {
    const error = classifyByokError(makeAxiosResponseError(302));
    expect(error.kind).toBe('unknown');
    expect(error.status).toBe(302);
  });

  it('classifies an axios error without a response as network', () => {
    const error = classifyByokError(makeAxiosError());
    expect(error.kind).toBe('network');
    expect(error.status).toBe(null);
  });

  it('classifies an aborted request (ECONNABORTED) as timeout', () => {
    const error = classifyByokError(
      makeAxiosError({ code: 'ECONNABORTED', message: 'timeout of 100ms exceeded' })
    );
    expect(error.kind).toBe('timeout');
    expect(error.status).toBe(null);
  });

  it('classifies anything else (a string, no request at all) as unknown', () => {
    expect(classifyByokError('boom').kind).toBe('unknown');
    expect(classifyByokError(null).kind).toBe('unknown');
    expect(classifyByokError(undefined).kind).toBe('unknown');
    expect(classifyByokError(new Error('boom')).kind).toBe('unknown');
  });

  it('uses the message of the OpenAI-style error body when present', () => {
    const error = classifyByokError(
      makeAxiosResponseError(401, {
        error: { message: 'Incorrect API key provided.', type: 'invalid_request_error' },
      })
    );
    expect(error.kind).toBe('authentication');
    expect(error.message).toBe('Incorrect API key provided.');
  });

  it('uses a top-level message in the body when there is no error object', () => {
    const error = classifyByokError(
      makeAxiosResponseError(400, { message: 'Model not found.' })
    );
    expect(error.message).toBe('Model not found.');
  });

  it('falls back to a human-readable sentence per kind when the body has no message', () => {
    const error = classifyByokError(makeAxiosResponseError(401, {}));
    expect(error.kind).toBe('authentication');
    expect(error.message).toContain('API key');
  });

  it('keeps an already-classified ByokError unchanged', () => {
    const byokError = makeByokError('rate-limit', 'Slow down!', 429);
    expect(classifyByokError(byokError)).toEqual(byokError);
  });
});

describe('isRetryableByokError', () => {
  const cases: Array<[ByokErrorKind, boolean]> = [
    ['authentication', false],
    ['forbidden', false],
    ['not-found', false],
    ['rate-limit', true],
    ['invalid-request', false],
    ['server', true],
    ['network', true],
    ['timeout', true],
    ['unknown', false],
  ];

  for (const [kind, expected] of cases) {
    it(`returns ${String(expected)} for ${kind}`, () => {
      expect(isRetryableByokError(makeByokError(kind, 'message', null))).toBe(
        expected
      );
    });
  }
});

describe('describeInvalidRequestForReasoningEffort', () => {
  it('is true for an invalid-request mentioning reasoning_effort', () => {
    const error = classifyByokError(
      makeAxiosResponseError(400, {
        error: {
          message:
            'Unknown parameter: reasoning_effort is not supported by this model.',
        },
      })
    );
    expect(describeInvalidRequestForReasoningEffort(error)).toBe(true);
  });

  it('matches reasoning_effort regardless of case', () => {
    const error = classifyByokError(
      makeAxiosResponseError(400, {
        error: { message: 'REASONING_EFFORT is not a valid parameter.' },
      })
    );
    expect(describeInvalidRequestForReasoningEffort(error)).toBe(true);
  });

  it('is false for an invalid-request about something else', () => {
    const error = classifyByokError(
      makeAxiosResponseError(400, {
        error: { message: "Model 'nope' does not exist." },
      })
    );
    expect(describeInvalidRequestForReasoningEffort(error)).toBe(false);
  });

  it('is false for another kind even when the message mentions reasoning_effort', () => {
    const error = classifyByokError(
      makeAxiosResponseError(500, {
        error: { message: 'Internal error while applying reasoning_effort.' },
      })
    );
    expect(describeInvalidRequestForReasoningEffort(error)).toBe(false);
  });
});

describe('redactSecretFromMessage', () => {
  it('replaces every occurrence of the secret', () => {
    expect(redactSecretFromMessage('key sk-abc and sk-abc again', 'sk-abc')).toBe(
      'key [redacted] and [redacted] again'
    );
  });

  it('leaves the message alone when the secret is empty', () => {
    expect(redactSecretFromMessage('normal message', '')).toBe(
      'normal message'
    );
  });
});

describe('redactSecretFromByokError', () => {
  it('redacts the secret from the message and keeps the rest', () => {
    const error: ByokError = makeByokError(
      'network',
      'failed to call sk-secret-endpoint',
      null
    );
    expect(redactSecretFromByokError(error, 'sk-secret-endpoint')).toEqual({
      kind: 'network',
      message: 'failed to call [redacted]',
      status: null,
    });
  });
});
