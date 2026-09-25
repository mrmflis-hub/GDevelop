/**
 * @jest-environment jsdom
 */
// @flow

// The OptionalRequire module is mocked so the IPC backend sees a fake
// electron ipcRenderer, and the build service / qdrant bridges are mocked
// so the tab is tested against their contracts.
jest.mock('../../Utils/OptionalRequire', () => ({
  __esModule: true,
  default: (name: string) => {
    if (name === 'electron') {
      return {
        ipcRenderer: {
          invoke: (jest.fn(async (...args: Array<any>) => {
            const channel = args[0];
            if (channel === 'byok-rag-read') return { ok: true, data: null };
            if (channel === 'byok-qdrant-status') {
              return {
                installed: true,
                healthy: true,
                baseUrl: 'http://127.0.0.1:6333',
              };
            }
            if (channel === 'byok-qdrant-setup') {
              return {
                ok: true,
                mode: 'installed',
                baseUrl: 'http://127.0.0.1:7333',
                port: 7333,
              };
            }
            return { ok: true, data: null };
          }): any),
        },
      };
    }
    return null;
  },
}));
jest.mock('./Rag/ByokRagBuildService', () => ({
  rebuildByokRagIndex: jest.fn(async () => ({ ok: true, chunkCount: 1234 })),
  readByokRagIndexStatus: jest.fn(async () => null),
}));
jest.mock('./Rag/ByokRagFileBackends', () => ({
  // The bridges are re-exported from the mocked module shape the tab uses —
  // the real bridges live in the same module as the (unmocked here) file
  // backends, so the setup/status pair is faked through the electron mock
  // instead. The tab imports them from ByokRagFileBackends: provide them.
  invokeByokQdrantSetup: jest.fn(async () => ({
    ok: true,
    mode: 'installed',
    baseUrl: 'http://127.0.0.1:7333',
    port: 7333,
  })),
  invokeByokQdrantStatus: jest.fn(async () => ({
    installed: true,
    healthy: true,
    baseUrl: 'http://127.0.0.1:6333',
  })),
}));

// jsdom does not implement matchMedia (PreferencesContext loads at import).
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

const React = require('react');
const { act } = require('react-dom/test-utils');
const TestRenderer = require('react-test-renderer');
const PreferencesContext = require('../../MainFrame/Preferences/PreferencesContext')
  .default;
const AlertContext = require('../../UI/Alert/AlertContext').default;
const ByokRagSettingsTabModule = require('./Rag/ByokRagSettingsTab');
const ByokRagSettingsTab = ByokRagSettingsTabModule.default;
const ByokRagBuildService: any = require('./Rag/ByokRagBuildService');
const ByokRagFileBackendsModule: any = require('./Rag/ByokRagFileBackends');
const { I18nProvider } = require('@lingui/react');
const { setupI18n } = require('@lingui/core');

const i18n = setupI18n({ language: 'en', catalogs: {} });

// The jest preset resets every mock's implementation before each test
// (resetMocks): the factory-provided implementations of the module mocks
// must be re-established here (the known quirk of this repo).
beforeEach(() => {
  ByokRagBuildService.rebuildByokRagIndex.mockImplementation(async () => ({
    ok: true,
    chunkCount: 1234,
  }));
  ByokRagBuildService.readByokRagIndexStatus.mockImplementation(
    async () => null
  );
  ByokRagFileBackendsModule.invokeByokQdrantSetup.mockImplementation(
    async () => ({
      ok: true,
      mode: 'installed',
      baseUrl: 'http://127.0.0.1:7333',
      port: 7333,
    })
  );
  ByokRagFileBackendsModule.invokeByokQdrantStatus.mockImplementation(
    async () => ({
      installed: true,
      healthy: true,
      baseUrl: 'http://127.0.0.1:6333',
    })
  );
});

const renderTab = ({
  ragSettings,
  confirmAnswer = true,
}: {|
  ragSettings: Object,
  confirmAnswer?: boolean,
|}) => {
  const setMultipleValues = (jest.fn(): any);
  let confirmCallback: any = null;
  let component: any = null;
  act(() => {
    component = TestRenderer.create(
      <I18nProvider i18n={i18n} language="en">
        <AlertContext.Provider
          value={
            ({
              showAlertDialog: jest.fn(),
              showConfirmDialog: jest.fn(({ callback }: any) => {
                confirmCallback = callback;
              }),
              showConfirmDeleteDialog: jest.fn(),
              showYesNoCancelDialog: jest.fn(),
            }: any)
          }
        >
          <PreferencesContext.Provider
            value={
              ({
                values: { byokRag: ragSettings },
                setMultipleValues,
              }: any)
            }
          >
            <ByokRagSettingsTab />
          </PreferencesContext.Provider>
        </AlertContext.Provider>
      </I18nProvider>
    );
  });
  const answerConfirmation = (answer: boolean) => {
    act(() => {
      if (confirmCallback) confirmCallback(answer);
    });
  };
  return { component, setMultipleValues, answerConfirmation };
};

const defaultRagSettings = () => ({
  enabled: false,
  embedderId: 'Xenova/all-MiniLM-L6-v2',
  backend: 'in-process',
  docsFolderPath: '',
  qdrantBaseUrl: 'http://127.0.0.1:6333',
});

describe('ByokRagSettingsTab (Phase 13.8)', () => {
  it('renders the status card, embedder picker and the Qdrant card', () => {
    const { component } = renderTab({ ragSettings: defaultRagSettings() });
    const json = JSON.stringify(component.toJSON());
    expect(json).toContain('RAG');
    expect(json).toContain('MiniLM L6 v2');
    expect(json).toContain('25 MB download');
    expect(json).toContain('Set up permanent indexing with Qdrant');
    expect(json).toContain('Rebuild index');
    expect(json).toContain('No index built yet');
  });

  it('shows the built index status when one exists', async () => {
    (ByokRagBuildService.readByokRagIndexStatus: any).mockResolvedValueOnce({
      chunkCount: 2567,
      builtAt: '2026-09-25T10:00:00.000Z',
      embedderId: 'Xenova/all-MiniLM-L6-v2',
      corpusHash: 'abc',
    });
    const { component } = renderTab({ ragSettings: defaultRagSettings() });
    await act(async () => {});
    const json = JSON.stringify(component.toJSON());
    expect(json).toContain('2567 chunks');
  });

  it('asks for the embedder download consent before building (D13-9)', async () => {
    const { component, answerConfirmation } = renderTab({
      ragSettings: defaultRagSettings(),
    });
    // The tab renders two RaisedButtons in tree order: Rebuild index,
    // then the Qdrant setup.
    const RaisedButton = require('../../UI/RaisedButton').default;
    const raisedButtons = component.root.findAllByType(RaisedButton);
    expect(raisedButtons.length).toBe(2);
    expect(JSON.stringify(component.toJSON())).toContain('Rebuild index');
    const rebuildButton = raisedButtons[0];
    await act(async () => {
      rebuildButton.props.onClick();
    });
    // The confirmation was asked; declining means no build at all.
    answerConfirmation(false);
    expect(ByokRagBuildService.rebuildByokRagIndex).not.toHaveBeenCalled();

    await act(async () => {
      rebuildButton.props.onClick();
    });
    answerConfirmation(true);
    await act(async () => {});
    expect(ByokRagBuildService.rebuildByokRagIndex).toHaveBeenCalledTimes(1);
    expect(
      ByokRagBuildService.rebuildByokRagIndex.mock.calls[0][0].settings
    ).toEqual(defaultRagSettings());
  });

  it('switches the index backend through the dropdown', () => {
    const { component, setMultipleValues } = renderTab({
      ragSettings: defaultRagSettings(),
    });
    const selects = component.root.findAllByType(
      require('../../UI/CompactSelectField').default
    );
    // Two selects: embedder + backend; the backend one is the last.
    act(() => {
      selects[selects.length - 1].props.onChange('qdrant');
    });
    expect(setMultipleValues).toHaveBeenCalledWith({
      byokRag: { ...defaultRagSettings(), backend: 'qdrant' },
    });
  });

  it('runs the Qdrant setup and adopts its base URL (with a clean fallback)', async () => {
    const { component, setMultipleValues } = renderTab({
      ragSettings: defaultRagSettings(),
    });
    const RaisedButton = require('../../UI/RaisedButton').default;
    const raisedButtons = component.root.findAllByType(RaisedButton);
    const setupButton = raisedButtons[raisedButtons.length - 1];
    expect(JSON.stringify(component.toJSON())).toContain(
      'Set up permanent indexing with Qdrant'
    );
    await act(async () => {
      setupButton.props.onClick();
    });
    await act(async () => {});
    expect(setMultipleValues).toHaveBeenCalledWith({
      byokRag: {
        ...defaultRagSettings(),
        backend: 'qdrant',
        qdrantBaseUrl: 'http://127.0.0.1:7333',
      },
    });
  });
});
