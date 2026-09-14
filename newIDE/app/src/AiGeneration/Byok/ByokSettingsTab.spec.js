/**
 * @jest-environment jsdom
 */
// @flow
import * as React from 'react';
import { act } from 'react-dom/test-utils';
import TestRenderer from 'react-test-renderer';
import TextField from '../../UI/TextField';
import { DEFAULT_BYOK_SETTINGS, type ByokSettings } from './ByokTypes';

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
const { I18nProvider } = require('@lingui/react');
const { setupI18n } = require('@lingui/core');

// The UI components used by the tab (SelectOption, TextField) need a lingui
// i18n instance in their context, like the app provides with GDI18nProvider.
// An empty catalogs set makes them render the English (source) messages.
const i18n = setupI18n({ language: 'en', catalogs: {} });

const makePreferencesValues = (byok: ByokSettings = DEFAULT_BYOK_SETTINGS) => ({
  byok,
});

const mockFn = (fn: any): JestMockFn<any, any> => fn;

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

    const storedKey = JSON.parse(localStorage.getItem('gd-byok-key') || 'null');
    expect(storedKey).toEqual({ key: 'sk-very-secret-key' });
    // The preferences blob was never written with the key.
    expect(localStorage.getItem('gd-preferences')).toBe(null);
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
