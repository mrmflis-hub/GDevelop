// @flow
import { t, Trans } from '@lingui/macro';
import * as React from 'react';

import PreferencesContext from '../../MainFrame/Preferences/PreferencesContext';
import Checkbox from '../../UI/Checkbox';
import FlatButton from '../../UI/FlatButton';
import { Column, Line } from '../../UI/Grid';
import { ColumnStackLayout, LineStackLayout } from '../../UI/Layout';
import CompactSelectField from '../../UI/CompactSelectField';
import RaisedButton from '../../UI/RaisedButton';
import SelectOption from '../../UI/SelectOption';
import Text from '../../UI/Text';
import TextField from '../../UI/TextField';
import {
  BYOK_IMAGE_SUPPORTS,
  BYOK_REASONING_EFFORTS,
  DEFAULT_BYOK_SETTINGS,
  MAX_CONTEXT_WINDOW_TOKENS,
  MIN_CONTEXT_WINDOW_TOKENS,
  getByokSettings,
  type ByokChatCompletionOptions,
  type ByokModelInfo,
  type ByokSettings,
} from './ByokTypes';
import {
  clearByokKey,
  getByokKeyStorageInfo,
  loadByokKey,
  saveByokKey,
} from './ByokKeyStorage';
import {
  classifyByokError,
  getGenericMessageForKind,
  type ByokError,
  type ByokErrorKind,
} from './ByokErrors';
import {
  clearByokModels,
  getCachedByokModels,
  refreshByokModels,
} from './ByokModelsCache';
import { sendByokChatCompletionWithRetries } from './ByokClient';

/**
 * Keep the context window in a range every provider accepts: below the
 * minimum, requests would lose too much context; above the maximum, the
 * value is almost certainly a typo (and would break the request budgeting).
 */
export const clampContextWindow = (value: number): number => {
  if (Number.isNaN(value)) return DEFAULT_BYOK_SETTINGS.contextWindowTokens;
  if (value < MIN_CONTEXT_WINDOW_TOKENS) return MIN_CONTEXT_WINDOW_TOKENS;
  if (value > MAX_CONTEXT_WINDOW_TOKENS) return MAX_CONTEXT_WINDOW_TOKENS;
  return value;
};

/**
 * The storage-status text shown under the API key field: null (row hidden)
 * when no key is stored, the OS-encryption text on the desktop app, and the
 * honest obfuscation warning on the web build.
 */
export const getKeyStorageStatusText = (
  encrypted: boolean,
  hasStoredKey: boolean
): React.Node => {
  if (!hasStoredKey) return null;
  if (encrypted) {
    return (
      <Trans>
        Your API key is encrypted by your operating system (DPAPI on Windows)
        and can only be read by this app under your user account.
      </Trans>
    );
  }
  return (
    <Trans>
      Your API key is stored with light obfuscation only. The desktop app
      protects it with OS-level encryption.
    </Trans>
  );
};

/**
 * The translated message for each error kind — the display-side counterpart
 * of ByokErrors' English fallbacks (which stay machine-readable and are also
 * what non-React consumers log).
 */
const renderGenericMessageForKind = (kind: ByokErrorKind): React.Node => {
  if (kind === 'authentication') {
    return (
      <Trans>
        Your API key was rejected by the endpoint (401). Check the API key in
        the BYOK settings.
      </Trans>
    );
  }
  if (kind === 'forbidden') {
    return (
      <Trans>
        The endpoint refused the request (403). Your API key may not have access
        to this model or resource.
      </Trans>
    );
  }
  if (kind === 'not-found') {
    return (
      <Trans>
        The endpoint was not found (404). Check the base URL in the BYOK
        settings: for most providers it should end with /v1.
      </Trans>
    );
  }
  if (kind === 'rate-limit') {
    return (
      <Trans>
        The endpoint is rate-limiting the requests (429). Wait a moment and try
        again.
      </Trans>
    );
  }
  if (kind === 'invalid-request') {
    return (
      <Trans>
        The endpoint rejected the request as invalid (400). The request
        contained something it does not accept.
      </Trans>
    );
  }
  if (kind === 'server') {
    return <Trans>The endpoint had an internal error. Try again later.</Trans>;
  }
  if (kind === 'network') {
    return (
      <Trans>
        Could not reach the endpoint (network error). Check the base URL and
        your internet connection.
      </Trans>
    );
  }
  if (kind === 'timeout') {
    return (
      <Trans>
        The endpoint took too long to answer (timeout). Try again in a moment.
      </Trans>
    );
  }
  if (kind === 'cancelled') {
    return <Trans>The request was cancelled.</Trans>;
  }
  return <Trans>The endpoint returned an unexpected error.</Trans>;
};

/**
 * What to show the user for a BYOK error: the endpoint-provided message when
 * it sent one (dynamic text, escaped by React), the translated generic
 * message otherwise.
 */
export const renderByokErrorMessage = (error: ByokError): React.Node => {
  if (error.message !== getGenericMessageForKind(error.kind)) {
    return error.message;
  }
  return renderGenericMessageForKind(error.kind);
};

// The value of the "Type manually…" option of the models dropdown: chosen,
// it swaps the dropdown back to the free-text field (for servers without a
// /models endpoint).
const MANUAL_MODEL_OPTION_VALUE = '__manual__';

// A test ping should fail fast, not hold the button for up to 3 × 120s of
// retries (the conversation timeout does not fit a settings dialog).
const CONNECTION_TEST_TIMEOUT_MS = 15000;

type ConnectionTestResult = {| ok: boolean, message: React.Node |};

type ContextWindowRow = {|
  modelId: string,
  tokens: number,
  isAutoFromServer: boolean,
|};

const ByokSettingsTab = (): React.Node => {
  const { values, setMultipleValues } = React.useContext(PreferencesContext);
  const byokSettings = getByokSettings(values);
  // The API key lives in its own storage (see `saveByokKey`), never in the
  // preferences: it is held here in local state until the field is left.
  const [apiKey, setApiKey] = React.useState<string>('');
  const [
    isKeyStorageEncrypted,
    setIsKeyStorageEncrypted,
  ] = React.useState<boolean>(false);
  const [hasStoredKey, setHasStoredKey] = React.useState<boolean>(false);
  const [
    fetchedModels,
    setFetchedModels,
  ] = React.useState<?Array<ByokModelInfo>>(null);
  const [isFetchingModels, setIsFetchingModels] = React.useState<boolean>(
    false
  );
  const [
    modelsFetchMessage,
    setModelsFetchMessage,
  ] = React.useState<?React.Node>(null);
  const [
    isManuallyTypingModel,
    setIsManuallyTypingModel,
  ] = React.useState<boolean>(false);
  const [isTestingConnection, setIsTestingConnection] = React.useState<boolean>(
    false
  );
  const [
    connectionTestResult,
    setConnectionTestResult,
  ] = React.useState<?ConnectionTestResult>(null);
  // The raw text of a context-window field being edited: while set, the
  // field shows it as-is and the clamped value is persisted only on blur —
  // clamping on every keystroke would rewrite what the user is typing.
  const [
    defaultContextWindowDraft,
    setDefaultContextWindowDraft,
  ] = React.useState<string | null>(null);
  const [
    perModelContextWindowDraft,
    setPerModelContextWindowDraft,
  ] = React.useState<{| modelId: string, text: string |} | null>(null);

  // Async handlers must not update state once the dialog is closed.
  const isSubscribedRef = React.useRef<boolean>(true);
  React.useEffect(() => {
    isSubscribedRef.current = true;
    return () => {
      isSubscribedRef.current = false;
    };
  }, []);

  // The save triggered by leaving the key field is async (an IPC round-trip
  // on desktop): buttons reading the key await this promise first, so
  // "type a key then immediately click Fetch models" cannot race the save
  // and read the previous (or empty) stored key.
  const pendingKeySaveRef = React.useRef<?Promise<boolean>>(null);

  const refreshKeyStorageState = React.useCallback(async () => {
    const storageInfo = await getByokKeyStorageInfo();
    const storedKey = await loadByokKey();
    if (!isSubscribedRef.current) return;

    setIsKeyStorageEncrypted(storageInfo.encrypted);
    setHasStoredKey(!!storedKey);
  }, []);

  React.useEffect(
    () => {
      refreshKeyStorageState();
    },
    [refreshKeyStorageState]
  );

  // Partial rather than the $Shape the preferences files use: this Flow
  // version flags $Shape as deprecated.
  const updateByokSetting = (partial: Partial<ByokSettings>) => {
    setMultipleValues({ byok: { ...byokSettings, ...partial } });
  };

  // The models fetched in a previous visit of the tab are shown right away
  // (a pure read of the in-memory cache, safe during render).
  const cachedModels = getCachedByokModels(byokSettings.endpointUrl);
  const visibleModels = fetchedModels || cachedModels;

  const showModelsDropdown =
    !!visibleModels &&
    visibleModels.length > 0 &&
    !isManuallyTypingModel &&
    // A model the list does not contain (typed manually earlier) would
    // render as a blank dropdown selection: keep the free-text field until
    // the model appears in the list.
    (!byokSettings.modelName ||
      visibleModels.some(model => model.id === byokSettings.modelName));

  const onFetchModels = async () => {
    setIsFetchingModels(true);
    setModelsFetchMessage(null);
    setIsManuallyTypingModel(false);

    try {
      if (pendingKeySaveRef.current) await pendingKeySaveRef.current;
      const storedApiKey = (await loadByokKey()) || '';
      const models = await refreshByokModels({
        baseUrl: byokSettings.endpointUrl,
        apiKey: storedApiKey,
      });
      if (!isSubscribedRef.current) return;

      setFetchedModels(models);
      if (models.length === 0) {
        setModelsFetchMessage(
          <Trans>
            The endpoint returned an empty model list. Type the model name
            manually below.
          </Trans>
        );
      }
    } catch (rawError) {
      if (!isSubscribedRef.current) return;

      const byokError = classifyByokError(rawError);
      setModelsFetchMessage(renderByokErrorMessage(byokError));
    } finally {
      if (isSubscribedRef.current) setIsFetchingModels(false);
    }
  };

  const onTestConnection = async () => {
    setIsTestingConnection(true);
    setConnectionTestResult(null);

    const options: ByokChatCompletionOptions = {
      model: byokSettings.modelName,
      messages: [{ role: 'user', content: 'ping' }],
      timeoutMs: CONNECTION_TEST_TIMEOUT_MS,
    };
    if (byokSettings.reasoningEffort !== 'default') {
      options.reasoningEffort = byokSettings.reasoningEffort;
    }

    try {
      if (pendingKeySaveRef.current) await pendingKeySaveRef.current;
      const storedApiKey = (await loadByokKey()) || '';
      await sendByokChatCompletionWithRetries({
        baseUrl: byokSettings.endpointUrl,
        apiKey: storedApiKey,
        options,
      });
      if (!isSubscribedRef.current) return;

      setConnectionTestResult({
        ok: true,
        message: (
          <Trans>
            Connection successful! The endpoint answered the test message.
          </Trans>
        ),
      });
    } catch (rawError) {
      if (!isSubscribedRef.current) return;

      const byokError = classifyByokError(rawError);
      setConnectionTestResult({
        ok: false,
        message: renderByokErrorMessage(byokError),
      });
    } finally {
      if (isSubscribedRef.current) setIsTestingConnection(false);
    }
  };

  const saveApiKey = () => {
    const savePromise = saveByokKey(apiKey).then(saved => {
      // The cached model list belongs to the previous key: forget it so the
      // next fetch reflects what the new key can access.
      if (apiKey) clearByokModels();
      return saved;
    });
    pendingKeySaveRef.current = savePromise;
    savePromise.then(() => {
      if (isSubscribedRef.current) refreshKeyStorageState();
    });
  };

  const onClearStoredKey = async () => {
    setApiKey('');
    await clearByokKey();
    clearByokModels();
    if (isSubscribedRef.current) {
      setIsKeyStorageEncrypted(false);
      setHasStoredKey(false);
    }
  };

  // The rows of the per-model context windows: the models the user set a
  // value for, plus the selected model (so its value can be set without
  // being selected… it *is* selected, but it may not have a row yet).
  const selectedModelInfo = visibleModels
    ? visibleModels.find(model => model.id === byokSettings.modelName)
    : null;
  const selectedModelServerTokens =
    selectedModelInfo &&
    typeof selectedModelInfo.contextWindowTokens === 'number'
      ? selectedModelInfo.contextWindowTokens
      : null;
  const contextWindowRows: Array<ContextWindowRow> = Object.keys(
    byokSettings.contextWindowByModel
  ).map(modelId => ({
    modelId,
    tokens: byokSettings.contextWindowByModel[modelId],
    isAutoFromServer: false,
  }));
  if (
    byokSettings.modelName &&
    !contextWindowRows.some(row => row.modelId === byokSettings.modelName)
  ) {
    contextWindowRows.push({
      modelId: byokSettings.modelName,
      tokens:
        selectedModelServerTokens !== null
          ? selectedModelServerTokens
          : byokSettings.contextWindowTokens,
      isAutoFromServer: selectedModelServerTokens !== null,
    });
  }

  const updateContextWindowForModel = (modelId: string, text: string) => {
    updateByokSetting({
      contextWindowByModel: {
        ...byokSettings.contextWindowByModel,
        [modelId]: clampContextWindow(parseInt(text, 10)),
      },
    });
  };

  const commitDefaultContextWindowDraft = () => {
    if (defaultContextWindowDraft === null) return;

    updateByokSetting({
      contextWindowTokens: clampContextWindow(
        parseInt(defaultContextWindowDraft, 10)
      ),
    });
    setDefaultContextWindowDraft(null);
  };

  const commitPerModelContextWindowDraft = () => {
    if (!perModelContextWindowDraft) return;

    updateContextWindowForModel(
      perModelContextWindowDraft.modelId,
      perModelContextWindowDraft.text
    );
    setPerModelContextWindowDraft(null);
  };

  const reasoningEffortLabels = {
    default: t`Default`,
    low: t`Low`,
    medium: t`Medium`,
    high: t`High`,
  };

  const imageSupportLabels = {
    auto: t`Auto-detect`,
    yes: t`Yes`,
    no: t`No`,
  };

  const keyStorageStatusText = getKeyStorageStatusText(
    isKeyStorageEncrypted,
    hasStoredKey
  );

  return (
    <ColumnStackLayout>
      <Text size="block-title">
        <Trans>BYOK — Bring Your Own Key</Trans>
      </Text>
      <Text>
        <Trans>
          Use your own OpenAI-compatible provider (with your own API key) to
          power Ask AI, instead of using GDevelop AI credits.
        </Trans>
      </Text>
      <Checkbox
        checked={byokSettings.enabled}
        onCheck={(event, checked) => updateByokSetting({ enabled: checked })}
        label={<Trans>Use BYOK for Ask AI</Trans>}
      />
      <TextField
        name="byok-endpoint-url"
        floatingLabelText={<Trans>Endpoint base URL</Trans>}
        hintText="https://api.openai.com/v1"
        value={byokSettings.endpointUrl}
        onChange={(event, text) => updateByokSetting({ endpointUrl: text })}
      />
      <Line noMargin>
        <Text size="body2" color="secondary">
          <Trans>
            The base URL of your provider, including /v1 if it uses one: /models
            and /chat/completions are appended automatically.
          </Trans>
        </Text>
      </Line>
      <TextField
        name="byok-api-key"
        type="password"
        autoComplete="off"
        floatingLabelText={<Trans>API key</Trans>}
        value={apiKey}
        onChange={(event, text) => setApiKey(text)}
        onBlur={saveApiKey}
      />
      {keyStorageStatusText && (
        <Line noMargin>
          <Text size="body2" color="secondary">
            {keyStorageStatusText}
          </Text>
        </Line>
      )}
      <Line noMargin>
        {/* The discoverable way to remove a stored key (emptying the field
            and blurring also clears it, but nothing says so). */}
        <FlatButton
          label={<Trans>Clear the stored key</Trans>}
          onClick={onClearStoredKey}
          disabled={!hasStoredKey}
        />
      </Line>
      <LineStackLayout noMargin alignItems="center">
        <Column noMargin expand>
          <Text noMargin>
            <Trans>Model</Trans>
          </Text>
        </Column>
        <Column noMargin expand>
          <RaisedButton
            label={
              isFetchingModels ? (
                <Trans>Fetching…</Trans>
              ) : (
                <Trans>Fetch models</Trans>
              )
            }
            onClick={onFetchModels}
            disabled={isFetchingModels || !byokSettings.endpointUrl}
          />
        </Column>
      </LineStackLayout>
      {modelsFetchMessage && (
        <Line noMargin>
          <Text size="body2" color="error">
            {modelsFetchMessage}
          </Text>
        </Line>
      )}
      {showModelsDropdown ? (
        <CompactSelectField
          value={byokSettings.modelName}
          onChange={(value: string) => {
            if (value === MANUAL_MODEL_OPTION_VALUE) {
              setIsManuallyTypingModel(true);
              return;
            }

            updateByokSetting({ modelName: value });
          }}
        >
          {visibleModels &&
            visibleModels.map(model => (
              <SelectOption key={model.id} value={model.id} label={model.id} />
            ))}
          <SelectOption
            value={MANUAL_MODEL_OPTION_VALUE}
            label={t`Type manually…`}
          />
        </CompactSelectField>
      ) : (
        <TextField
          name="byok-model"
          floatingLabelText={<Trans>Model</Trans>}
          hintText="gpt-4o-mini"
          value={byokSettings.modelName}
          onChange={(event, text) => updateByokSetting({ modelName: text })}
        />
      )}
      <Text noMargin>
        <Trans>Context windows per model (tokens)</Trans>
      </Text>
      {contextWindowRows.map(contextWindowRow => (
        <LineStackLayout
          key={contextWindowRow.modelId}
          noMargin
          alignItems="center"
        >
          <Column noMargin expand>
            <Text noMargin>{contextWindowRow.modelId}</Text>
          </Column>
          {contextWindowRow.isAutoFromServer && (
            <Text size="body2" color="secondary" noMargin>
              <Trans>auto (server)</Trans>
            </Text>
          )}
          <Column noMargin expand>
            <TextField
              name={`byok-context-window-${contextWindowRow.modelId}`}
              type="number"
              value={
                perModelContextWindowDraft &&
                perModelContextWindowDraft.modelId === contextWindowRow.modelId
                  ? perModelContextWindowDraft.text
                  : String(contextWindowRow.tokens)
              }
              min={MIN_CONTEXT_WINDOW_TOKENS}
              max={MAX_CONTEXT_WINDOW_TOKENS}
              onChange={(event, value) =>
                setPerModelContextWindowDraft({
                  modelId: contextWindowRow.modelId,
                  text: value,
                })
              }
              onBlur={commitPerModelContextWindowDraft}
            />
          </Column>
        </LineStackLayout>
      ))}
      <LineStackLayout noMargin alignItems="center">
        <Column noMargin expand>
          <Text noMargin>
            <Trans>Default context window (tokens)</Trans>
          </Text>
        </Column>
        <Column noMargin expand>
          <TextField
            name="byok-context-window"
            type="number"
            value={
              defaultContextWindowDraft !== null
                ? defaultContextWindowDraft
                : String(byokSettings.contextWindowTokens)
            }
            min={MIN_CONTEXT_WINDOW_TOKENS}
            max={MAX_CONTEXT_WINDOW_TOKENS}
            onChange={(event, value) => setDefaultContextWindowDraft(value)}
            onBlur={commitDefaultContextWindowDraft}
          />
        </Column>
      </LineStackLayout>
      <LineStackLayout noMargin alignItems="center">
        <Column noMargin expand>
          <Text noMargin>
            <Trans>Reasoning effort</Trans>
          </Text>
        </Column>
        <Column noMargin expand>
          <CompactSelectField
            value={byokSettings.reasoningEffort}
            onChange={(value: string) => {
              const effort = BYOK_REASONING_EFFORTS.find(
                candidate => candidate === value
              );
              if (!effort) return;

              updateByokSetting({ reasoningEffort: effort });
            }}
          >
            {BYOK_REASONING_EFFORTS.map(effort => (
              <SelectOption
                key={effort}
                value={effort}
                label={reasoningEffortLabels[effort]}
              />
            ))}
          </CompactSelectField>
        </Column>
      </LineStackLayout>
      <LineStackLayout noMargin alignItems="center">
        <Column noMargin expand>
          <Text noMargin>
            <Trans>Image support</Trans>
          </Text>
        </Column>
        <Column noMargin expand>
          <CompactSelectField
            value={byokSettings.imageSupport}
            onChange={(value: string) => {
              const support = BYOK_IMAGE_SUPPORTS.find(
                candidate => candidate === value
              );
              if (!support) return;

              updateByokSetting({ imageSupport: support });
            }}
          >
            {BYOK_IMAGE_SUPPORTS.map(support => (
              <SelectOption
                key={support}
                value={support}
                label={imageSupportLabels[support]}
              />
            ))}
          </CompactSelectField>
        </Column>
      </LineStackLayout>
      <LineStackLayout noMargin alignItems="center">
        <Column noMargin expand>
          <Text noMargin>
            <Trans>Connection</Trans>
          </Text>
        </Column>
        <Column noMargin expand>
          <RaisedButton
            label={
              isTestingConnection ? (
                <Trans>Testing…</Trans>
              ) : (
                <Trans>Test connection</Trans>
              )
            }
            onClick={onTestConnection}
            disabled={
              isTestingConnection ||
              !byokSettings.endpointUrl ||
              !byokSettings.modelName
            }
          />
        </Column>
      </LineStackLayout>
      {connectionTestResult && (
        <Line noMargin>
          <Text
            size="body2"
            color={connectionTestResult.ok ? 'secondary' : 'error'}
          >
            {connectionTestResult.message}
          </Text>
        </Line>
      )}
    </ColumnStackLayout>
  );
};

export default ByokSettingsTab;
