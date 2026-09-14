/**
 * @jest-environment jsdom
 */
// @flow
import * as React from 'react';
import { act } from 'react-dom/test-utils';
import TestRenderer from 'react-test-renderer';
import TextField from '../../UI/TextField';
import RaisedButton from '../../UI/RaisedButton';
import SelectOption from '../../UI/SelectOption';
import {
  DEFAULT_BYOK_SETTINGS,
  type ByokSettings,
  type ByokModelInfo,
} from './ByokTypes';

// The models cache and the client are mocked: the tab is tested against
// their contracts, not against axios.
jest.mock('./ByokModelsCache', () => ({
  getCachedByokModels: (jest.fn(): any).mockReturnValue(null),
  refreshByokModels: jest.fn(),
}));
jest.mock('./ByokClient', () => ({
  sendByokChatCompletionWithRetries: jest.fn(),
}));

// jsdom does not implement matchMedia, which PreferencesContext.js calls at
// module load to choose the default theme.
if (!(window: any).matchMedia) {
  (window: any).matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  });
}

// Required after the matchMedia polyfill above: static imports would be
// hoisted and executed before it.
const PreferencesContext = require('../../MainFrame/Preferences/PreferencesContext')
  .default;
const ByokSettingsTabModule = require('./ByokSettingsTab');
const ByokSettingsTab = ByokSettingsTabModule.default;
const clampContextWindow = ByokSettingsTabModule.clampContextWindow;
const ByokModelsCache = require('./ByokModelsCache');
const ByokClientModule = require('./ByokClient');
const { I18nProvider } = require('@lingui/react');
const { setupI18n } = require('@lingui/core');

const mockRefreshByokModels = mockFn(ByokModelsCache.refreshByokModels);
const mockGetCachedByokModels = mockFn(ByokModelsCache.getCachedByokModels);
const mockSendForTestConnection = mockFn(
  ByokClientModule.sendByokChatCompletionWithRetries
);

// The UI components used by the tab (SelectOption, TextField) need a lingui
// i18n instance in their context, like the app provides with GDI18nProvider.
// An empty catalogs set makes them render the English (source) messages.
const i18n = setupI18n({ language: 'en', catalogs: {} });

function mockFn(fn: any): JestMockFn<any, any> {
  return fn;
}

const makePreferencesValues = (byok: ByokSettings = DEFAULT_BYOK_SETTINGS) => ({
  byok,
});

const renderTab = (byok?: ByokSettings) => {
  const setMultipleValues = mockFn(jest.fn());
  const values = makePreferencesValues(byok);
  let component;
  act(() => {
    component = TestRenderer.create(
      <I18nProvider i18n={i18n} language="en">
        <PreferencesContext.Provider
          value={({ values, setMultipleValues }: any)}
        >
          <ByokSettingsTab />
        </PreferencesContext.Provider>
      </I18nProvider>
    );
  });
  if (!component) throw new Error('The tab did not render');
  return { component, setMultipleValues };
};

const findFieldByName = (component: any, name: string) => {
  const field = component.root
    .findAllByType(TextField)
    .find(field => field.props.name === name);
  if (!field) throw new Error(`Field ${name} not found`);
  return field;
};

const flushPromises = async () => {
  for (let i = 0; i < 10; i++) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
};

describe('ByokSettingsTab', () => {
  beforeEach(() => {
    localStorage.clear();
    mockRefreshByokModels.mockReset();
    mockGetCachedByokModels.mockReset();
    mockGetCachedByokModels.mockReturnValue(null);
    mockSendForTestConnection.mockReset();
  });

  it('mounts and shows the BYOK title', async () => {
    const { component } = renderTab();
    // The title is rendered as the fallback (English) message of the
    // translated string.
    await act(async () => {
      await flushPromises();
    });
    expect(JSON.stringify(component.toJSON())).toContain(
      'BYOK — Bring Your Own Key'
    );
  });

  it('persists the endpoint URL through setMultipleValues', () => {
    const { component, setMultipleValues } = renderTab();
    const endpointField = findFieldByName(component, 'byok-endpoint-url');

    act(() => {
      endpointField.props.onChange(
        { target: { value: 'https://example.com/v1' } },
        'https://example.com/v1'
      );
    });

    expect(setMultipleValues).toHaveBeenCalledWith({
      byok: { ...DEFAULT_BYOK_SETTINGS, endpointUrl: 'https://example.com/v1' },
    });
  });

  it('clamps the context window entered in the field to 512', () => {
    const { component, setMultipleValues } = renderTab();
    const contextWindowField = findFieldByName(
      component,
      'byok-context-window'
    );

    act(() => {
      contextWindowField.props.onChange({}, '10');
    });

    expect(setMultipleValues).toHaveBeenCalledWith({
      byok: { ...DEFAULT_BYOK_SETTINGS, contextWindowTokens: 512 },
    });
  });

  it('clamps the context window entered in the field to 1,000,000', () => {
    const { component, setMultipleValues } = renderTab();
    const contextWindowField = findFieldByName(
      component,
      'byok-context-window'
    );

    act(() => {
      contextWindowField.props.onChange({}, '99999999');
    });

    expect(setMultipleValues).toHaveBeenCalledWith({
      byok: { ...DEFAULT_BYOK_SETTINGS, contextWindowTokens: 1000000 },
    });
  });

  it('keeps the API key out of every setMultipleValues call', () => {
    const { component, setMultipleValues } = renderTab();

    const apiKeyField = findFieldByName(component, 'byok-api-key');
    act(() => {
      apiKeyField.props.onChange(
        { target: { value: 'sk-very-secret-key' } },
        'sk-very-secret-key'
      );
    });
    const endpointField = findFieldByName(component, 'byok-endpoint-url');
    act(() => {
      endpointField.props.onChange(
        { target: { value: 'https://example.com/v1' } },
        'https://example.com/v1'
      );
    });

    expect(setMultipleValues).toHaveBeenCalled();
    for (const call of setMultipleValues.mock.calls) {
      const byok = call[0].byok || {};
      expect(Object.keys(byok).sort()).toEqual(
        Object.keys(DEFAULT_BYOK_SETTINGS).sort()
      );
    }
    // No key material anywhere in the preferences updates.
    expect(JSON.stringify(setMultipleValues.mock.calls)).not.toContain(
      'sk-very-secret-key'
    );
  });

  it('saves the API key to the separate key storage when the field is left', async () => {
    const { component } = renderTab();
    const apiKeyField = findFieldByName(component, 'byok-api-key');

    act(() => {
      apiKeyField.props.onChange(
        { target: { value: 'sk-very-secret-key' } },
        'sk-very-secret-key'
      );
    });
    act(() => {
      apiKeyField.props.onBlur({
        currentTarget: { value: 'sk-very-secret-key' },
      });
    });
    await act(async () => {
      await flushPromises();
    });

    // The key is stored obfuscated (version 2): the stored value is not the
    // plaintext key, but the key storage loads it back unchanged.
    const storedRawValue = localStorage.getItem('gd-byok-key') || '';
    expect(storedRawValue).not.toContain('sk-very-secret-key');
    expect(JSON.parse(storedRawValue).version).toBe(2);
    const { loadByokKey } = require('./ByokKeyStorage');
    expect(await loadByokKey()).toBe('sk-very-secret-key');
    // The preferences blob was never written with the key.
    expect(localStorage.getItem('gd-preferences')).toBe(null);
  });

  it('shows the obfuscated storage status when the key is not encrypted', async () => {
    const { component } = renderTab();
    await act(async () => {
      await flushPromises();
    });

    expect(JSON.stringify(component.toJSON())).toContain(
      'API key stored obfuscated'
    );
    expect(JSON.stringify(component.toJSON())).toContain(
      'OS-level encryption is added on desktop'
    );
  });
});

describe('ByokSettingsTab: models fetching', () => {
  beforeEach(() => {
    localStorage.clear();
    mockRefreshByokModels.mockReset();
    mockGetCachedByokModels.mockReset();
    mockGetCachedByokModels.mockReturnValue(null);
    mockSendForTestConnection.mockReset();
  });

  const getRaisedButtons = (component: any) =>
    component.root.findAllByType(RaisedButton);

  it('populates the models dropdown when the fetch succeeds', async () => {
    const models: Array<ByokModelInfo> = [
      { id: 'model-b', contextWindowTokens: null },
      { id: 'model-a', contextWindowTokens: 32768 },
    ];
    mockRefreshByokModels.mockResolvedValueOnce(models);

    const { component } = renderTab();
    const fetchModelsButton = getRaisedButtons(component)[0];
    expect(getRaisedButtons(component)).toHaveLength(2);

    await act(async () => {
      fetchModelsButton.props.onClick({});
      await flushPromises();
    });

    // The dropdown appeared, with one option per fetched model (plus the
    // reasoning-effort dropdown options that were always there).
    const options = component.root.findAllByType(SelectOption);
    const optionValues = options.map(option => option.props.value);
    expect(optionValues).toContain('model-a');
    expect(optionValues).toContain('model-b');
    expect(mockRefreshByokModels).toHaveBeenCalledWith({
      baseUrl: '',
      apiKey: '',
    });
  });

  it('falls back to the free-text model field when the fetch returns nothing', async () => {
    mockRefreshByokModels.mockResolvedValueOnce([]);

    const { component } = renderTab();
    const fetchModelsButton = getRaisedButtons(component)[0];

    await act(async () => {
      fetchModelsButton.props.onClick({});
      await flushPromises();
    });

    // The free-text model field is still there, with an explanation.
    findFieldByName(component, 'byok-model');
    expect(JSON.stringify(component.toJSON())).toContain(
      'returned an empty model list'
    );
    const optionValues = component.root
      .findAllByType(SelectOption)
      .map(option => option.props.value);
    expect(optionValues).not.toContain('model-a');
  });

  it('shows the ByokError message when the fetch fails', async () => {
    mockRefreshByokModels.mockRejectedValueOnce({
      kind: 'authentication',
      message: 'Your API key was rejected by the endpoint (401).',
      status: 401,
    });

    const { component } = renderTab();
    const fetchModelsButton = getRaisedButtons(component)[0];

    await act(async () => {
      fetchModelsButton.props.onClick({});
      await flushPromises();
    });

    expect(JSON.stringify(component.toJSON())).toContain(
      'Your API key was rejected by the endpoint (401).'
    );
    // The free-text field is still shown.
    findFieldByName(component, 'byok-model');
  });

  it('shows the models cached for the endpoint without a new fetch', () => {
    mockGetCachedByokModels.mockReturnValueOnce([
      { id: 'cached-model', contextWindowTokens: null },
    ]);

    const { component } = renderTab();
    const optionValues = component.root
      .findAllByType(SelectOption)
      .map(option => option.props.value);
    expect(optionValues).toContain('cached-model');
    expect(mockRefreshByokModels).not.toHaveBeenCalled();
  });
});

describe('ByokSettingsTab: per-model context windows', () => {
  beforeEach(() => {
    localStorage.clear();
    mockRefreshByokModels.mockReset();
    mockGetCachedByokModels.mockReset();
    mockGetCachedByokModels.mockReturnValue(null);
    mockSendForTestConnection.mockReset();
  });

  it('persists a context window for the selected model via setMultipleValues', () => {
    const settings: ByokSettings = {
      ...DEFAULT_BYOK_SETTINGS,
      modelName: 'my-model',
    };
    const { component, setMultipleValues } = renderTab(settings);

    const contextWindowField = findFieldByName(
      component,
      'byok-context-window-my-model'
    );
    act(() => {
      contextWindowField.props.onChange({}, '4096');
    });

    expect(setMultipleValues).toHaveBeenCalledWith({
      byok: {
        ...DEFAULT_BYOK_SETTINGS,
        modelName: 'my-model',
        contextWindowByModel: { 'my-model': 4096 },
      },
    });
  });

  it('prefills the context window reported by the server, marked as auto (server)', () => {
    mockGetCachedByokModels.mockReturnValueOnce([
      { id: 'my-model', contextWindowTokens: 32768 },
    ]);
    const settings: ByokSettings = {
      ...DEFAULT_BYOK_SETTINGS,
      modelName: 'my-model',
    };

    const { component } = renderTab(settings);

    const contextWindowField = findFieldByName(
      component,
      'byok-context-window-my-model'
    );
    expect(contextWindowField.props.value).toBe(32768);
    expect(JSON.stringify(component.toJSON())).toContain('auto (server)');
  });

  it('lets the user override an auto (server) context window', () => {
    mockGetCachedByokModels.mockReturnValueOnce([
      { id: 'my-model', contextWindowTokens: 32768 },
    ]);
    const settings: ByokSettings = {
      ...DEFAULT_BYOK_SETTINGS,
      modelName: 'my-model',
    };

    const { component, setMultipleValues } = renderTab(settings);
    const contextWindowField = findFieldByName(
      component,
      'byok-context-window-my-model'
    );
    act(() => {
      contextWindowField.props.onChange({}, '16384');
    });

    expect(setMultipleValues).toHaveBeenCalledWith({
      byok: {
        ...DEFAULT_BYOK_SETTINGS,
        modelName: 'my-model',
        contextWindowByModel: { 'my-model': 16384 },
      },
    });
  });
});

describe('ByokSettingsTab: test connection', () => {
  beforeEach(() => {
    localStorage.clear();
    mockRefreshByokModels.mockReset();
    mockGetCachedByokModels.mockReset();
    mockGetCachedByokModels.mockReturnValue(null);
    mockSendForTestConnection.mockReset();
  });

  const renderTabAndClickTest = async () => {
    const { component, setMultipleValues } = renderTab();
    const raisedButtons = component.root.findAllByType(RaisedButton);
    const testConnectionButton = raisedButtons[raisedButtons.length - 1];

    await act(async () => {
      testConnectionButton.props.onClick({});
      await flushPromises();
    });

    return { component, setMultipleValues };
  };

  it('renders an inline success message when the endpoint answers', async () => {
    mockSendForTestConnection.mockResolvedValueOnce({
      choices: [{ message: { role: 'assistant', content: 'pong' } }],
    });

    const { component } = await renderTabAndClickTest();

    expect(mockSendForTestConnection).toHaveBeenCalledTimes(1);
    const call = mockSendForTestConnection.mock.calls[0][0];
    expect(call.options.model).toBe('');
    expect(call.options.messages).toEqual([{ role: 'user', content: 'ping' }]);
    expect(JSON.stringify(component.toJSON())).toContain(
      'Connection successful!'
    );
  });

  it('sends the reasoning effort of the settings when it is not default', async () => {
    mockSendForTestConnection.mockResolvedValueOnce({
      choices: [{ message: { role: 'assistant', content: 'pong' } }],
    });
    const settings: ByokSettings = {
      ...DEFAULT_BYOK_SETTINGS,
      endpointUrl: 'https://api.example.com/v1',
      modelName: 'my-model',
      reasoningEffort: 'high',
    };

    const { component } = renderTab(settings);
    const raisedButtons = component.root.findAllByType(RaisedButton);
    const testConnectionButton = raisedButtons[raisedButtons.length - 1];
    await act(async () => {
      testConnectionButton.props.onClick({});
      await flushPromises();
    });

    expect(
      mockSendForTestConnection.mock.calls[0][0].options.reasoningEffort
    ).toBe('high');
    expect(JSON.stringify(component.toJSON())).toContain(
      'Connection successful!'
    );
  });

  it('renders the error message inline when the endpoint rejects', async () => {
    mockSendForTestConnection.mockRejectedValueOnce({
      kind: 'not-found',
      message: 'The endpoint was not found (404).',
      status: 404,
    });

    const { component } = await renderTabAndClickTest();

    expect(JSON.stringify(component.toJSON())).toContain(
      'The endpoint was not found (404).'
    );
    expect(JSON.stringify(component.toJSON())).not.toContain(
      'Connection successful!'
    );
  });
});

describe('clampContextWindow', () => {
  it('raises a too-small value to the minimum of 512', () => {
    expect(clampContextWindow(10)).toBe(512);
    expect(clampContextWindow(511)).toBe(512);
  });

  it('lowers a too-large value to the maximum of 1,000,000', () => {
    expect(clampContextWindow(99999999)).toBe(1000000);
    expect(clampContextWindow(1000001)).toBe(1000000);
  });

  it('keeps a value inside the bounds as-is', () => {
    expect(clampContextWindow(512)).toBe(512);
    expect(clampContextWindow(8192)).toBe(8192);
    expect(clampContextWindow(1000000)).toBe(1000000);
  });

  it('falls back to the default context window on a non-number (empty field)', () => {
    expect(clampContextWindow(NaN)).toBe(
      DEFAULT_BYOK_SETTINGS.contextWindowTokens
    );
  });
});
