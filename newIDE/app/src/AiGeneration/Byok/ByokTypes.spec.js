// @flow
import {
  BYOK_IMAGE_SUPPORTS,
  DEFAULT_BYOK_SETTINGS,
  getByokSettings,
  isByokFullyConfigured,
  isByokImageSupport,
  isByokReasoningEffort,
  type ByokSettings,
} from './ByokTypes';

const makeByokSettings = (overrides?: Partial<ByokSettings>): ByokSettings => ({
  ...DEFAULT_BYOK_SETTINGS,
  ...overrides,
});

describe('DEFAULT_BYOK_SETTINGS', () => {
  it('has the documented default values', () => {
    expect(DEFAULT_BYOK_SETTINGS).toEqual({
      enabled: false,
      endpointUrl: '',
      modelName: '',
      reasoningEffort: 'default',
      imageSupport: 'auto',
      contextWindowTokens: 8192,
      contextWindowByModel: {},
    });
  });
});

describe('ByokImageSupport', () => {
  it('accepts the three documented values and rejects the others', () => {
    for (const support of BYOK_IMAGE_SUPPORTS) {
      expect(isByokImageSupport(support)).toBe(true);
    }
    expect(isByokImageSupport('maybe')).toBe(false);
    expect(isByokImageSupport(null)).toBe(false);
  });

  it('is read back by getByokSettings, defaulting corrupted values', () => {
    expect(
      getByokSettings({ byok: ({ imageSupport: 'no' }: any) }).imageSupport
    ).toBe('no');
    expect(
      getByokSettings({ byok: ({ imageSupport: 'sometimes' }: any) })
        .imageSupport
    ).toBe('auto');
    expect(getByokSettings(({}: any)).imageSupport).toBe('auto');
  });
});

describe('getByokSettings', () => {
  it('returns the defaults when the byok field is missing', () => {
    expect(getByokSettings(({}: any))).toEqual(DEFAULT_BYOK_SETTINGS);
  });

  it('returns the defaults when the byok field is null', () => {
    expect(getByokSettings({ byok: null })).toEqual(DEFAULT_BYOK_SETTINGS);
  });

  it('returns the defaults when the byok field is not an object (corrupted storage)', () => {
    expect(getByokSettings({ byok: ('not an object': any) })).toEqual(
      DEFAULT_BYOK_SETTINGS
    );
  });

  it('returns a fresh copy of the defaults, never the shared constant', () => {
    // A caller mutating what it got must not pollute the module default
    // (which also seeds the preferences defaults).
    const first = getByokSettings(({}: any));
    first.contextWindowByModel['some-model'] = 1234;
    first.endpointUrl = 'https://mutated.example.com/v1';

    expect(getByokSettings(({}: any)).contextWindowByModel).toEqual({});
    expect(getByokSettings(({}: any)).endpointUrl).toBe(
      DEFAULT_BYOK_SETTINGS.endpointUrl
    );
  });

  it('returns the defaults for missing fields on a partially-filled object', () => {
    // Simulates settings saved by an older build, before some fields existed.
    const partialByok = { endpointUrl: 'https://example.com/v1' };
    expect(getByokSettings({ byok: (partialByok: any) })).toEqual({
      ...DEFAULT_BYOK_SETTINGS,
      endpointUrl: 'https://example.com/v1',
    });
  });

  it('ignores fields with an unexpected type on a partially-filled object', () => {
    const corruptedByok = {
      enabled: 'yes',
      contextWindowTokens: 'a lot',
      reasoningEffort: 42,
    };
    expect(getByokSettings({ byok: (corruptedByok: any) })).toEqual(
      DEFAULT_BYOK_SETTINGS
    );
  });

  it('returns the stored values when the object is complete', () => {
    const storedSettings = makeByokSettings({
      enabled: true,
      endpointUrl: 'https://api.example.com/v1',
      modelName: 'my-model',
      reasoningEffort: 'high',
      contextWindowTokens: 32768,
    });
    expect(getByokSettings({ byok: storedSettings })).toEqual(storedSettings);
  });
});

describe('getByokSettings: contextWindowByModel', () => {
  it('defaults to an empty map when the field is missing', () => {
    expect(getByokSettings({ byok: ({ endpointUrl: 'x' }: any) })).toEqual({
      ...DEFAULT_BYOK_SETTINGS,
      endpointUrl: 'x',
    });
  });

  it('keeps the per-model entries that are positive numbers', () => {
    const storedByok = {
      contextWindowByModel: { 'model-a': 32768, 'model-b': 4096 },
    };
    expect(
      getByokSettings({ byok: (storedByok: any) }).contextWindowByModel
    ).toEqual({
      'model-a': 32768,
      'model-b': 4096,
    });
  });

  it('drops the per-model entries that are not positive numbers', () => {
    const storedByok = {
      contextWindowByModel: {
        'model-a': 'big',
        'model-b': 0,
        'model-c': -1,
        'model-d': 2048,
      },
    };
    expect(
      getByokSettings({ byok: (storedByok: any) }).contextWindowByModel
    ).toEqual({
      'model-d': 2048,
    });
  });

  it('defaults to an empty map when the field is not an object', () => {
    expect(
      getByokSettings({ byok: ({ contextWindowByModel: 'nope' }: any) })
        .contextWindowByModel
    ).toEqual({});
    expect(
      getByokSettings({ byok: ({ contextWindowByModel: [8192] }: any) })
        .contextWindowByModel
    ).toEqual({});
  });
});

describe('isByokReasoningEffort', () => {
  it('accepts the four documented efforts', () => {
    expect(isByokReasoningEffort('default')).toBe(true);
    expect(isByokReasoningEffort('low')).toBe(true);
    expect(isByokReasoningEffort('medium')).toBe(true);
    expect(isByokReasoningEffort('high')).toBe(true);
  });

  it('rejects any other value', () => {
    expect(isByokReasoningEffort('gigachad')).toBe(false);
    expect(isByokReasoningEffort(null)).toBe(false);
    expect(isByokReasoningEffort(undefined)).toBe(false);
  });
});

describe('isByokFullyConfigured', () => {
  it('is false when BYOK is disabled', () => {
    const settings = makeByokSettings({
      enabled: false,
      endpointUrl: 'https://api.example.com/v1',
      modelName: 'my-model',
    });
    expect(isByokFullyConfigured(settings)).toBe(false);
  });

  it('is false when the endpoint URL is empty', () => {
    const settings = makeByokSettings({
      enabled: true,
      endpointUrl: '',
      modelName: 'my-model',
    });
    expect(isByokFullyConfigured(settings)).toBe(false);
  });

  it('is false when the model name is empty', () => {
    const settings = makeByokSettings({
      enabled: true,
      endpointUrl: 'https://api.example.com/v1',
      modelName: '',
    });
    expect(isByokFullyConfigured(settings)).toBe(false);
  });

  it('is true with an https:// endpoint URL', () => {
    const settings = makeByokSettings({
      enabled: true,
      endpointUrl: 'https://api.example.com/v1',
      modelName: 'my-model',
    });
    expect(isByokFullyConfigured(settings)).toBe(true);
  });

  it('is true with an http:// endpoint URL (local server like Ollama)', () => {
    const settings = makeByokSettings({
      enabled: true,
      endpointUrl: 'http://localhost:1234/v1',
      modelName: 'my-model',
    });
    expect(isByokFullyConfigured(settings)).toBe(true);
  });

  it('is false with another protocol like ftp://', () => {
    const settings = makeByokSettings({
      enabled: true,
      endpointUrl: 'ftp://api.example.com/v1',
      modelName: 'my-model',
    });
    expect(isByokFullyConfigured(settings)).toBe(false);
  });

  it('is false with a value that is not a URL at all', () => {
    const settings = makeByokSettings({
      enabled: true,
      endpointUrl: 'not a url',
      modelName: 'my-model',
    });
    expect(isByokFullyConfigured(settings)).toBe(false);
  });
});
