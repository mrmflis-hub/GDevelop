// @flow
import { t, Trans } from '@lingui/macro';
import * as React from 'react';

import PreferencesContext from '../../MainFrame/Preferences/PreferencesContext';
import Checkbox from '../../UI/Checkbox';
import { Column, Line } from '../../UI/Grid';
import { ColumnStackLayout, LineStackLayout } from '../../UI/Layout';
import CompactSelectField from '../../UI/CompactSelectField';
import RaisedButton from '../../UI/RaisedButton';
import SelectOption from '../../UI/SelectOption';
import Text from '../../UI/Text';
import TextField from '../../UI/TextField';
import {
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
  getByokKeyStorageInfo,
  loadByokKey,
  saveByokKey,
} from './ByokKeyStorage';
import { classifyByokError } from './ByokErrors';
import { getCachedByokModels, refreshByokModels } from './ByokModelsCache';
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

// The value of the "Type manually…" option of the models dropdown: chosen,
// it swaps the dropdown back to the free-text field (for servers without a
// /models endpoint).
const MANUAL_MODEL_OPTION_VALUE = '__manual__';

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

  React.useEffect(() => {
    let isSubscribed = true;
    (async () => {
      const storageInfo = await getByokKeyStorageInfo();
      if (isSubscribed) setIsKeyStorageEncrypted(storageInfo.encrypted);
    })();
    return () => {
      isSubscribed = false;
    };
  }, []);

  const updateByokSetting = (partial: Partial<ByokSettings>) => {
    setMultipleValues({ byok: { ...byokSettings, ...partial } });
  };

  // The models fetched in a previous visit of the tab are shown right away
  // (a pure read of the in-memory cache, safe during render).
  const cachedModels = getCachedByokModels(byokSettings.endpointUrl);
  const visibleModels = fetchedModels || cachedModels;

  const showModelsDropdown =
    !!visibleModels && visibleModels.length > 0 && !isManuallyTypingModel;

  const onFetchModels = async () => {
    setIsFetchingModels(true);
    setModelsFetchMessage(null);
    setIsManuallyTypingModel(false);

    const storedApiKey = (await loadByokKey()) || '';
    try {
      const models = await refreshByokModels({
        baseUrl: byokSettings.endpointUrl,
        apiKey: storedApiKey,
      });
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
      const byokError = classifyByokError(rawError);
      setModelsFetchMessage(byokError.message);
    } finally {
      setIsFetchingModels(false);
    }
  };

  const onTestConnection = async () => {
    setIsTestingConnection(true);
    setConnectionTestResult(null);

    const storedApiKey = (await loadByokKey()) || '';
    const options: ByokChatCompletionOptions = {
      model: byokSettings.modelName,
      messages: [{ role: 'user', content: 'ping' }],
    };
    if (byokSettings.reasoningEffort !== 'default') {
      options.reasoningEffort = byokSettings.reasoningEffort;
    }

    try {
      await sendByokChatCompletionWithRetries({
        baseUrl: byokSettings.endpointUrl,
        apiKey: storedApiKey,
        options,
      });
      setConnectionTestResult({
        ok: true,
        message: (
          <Trans>
            Connection successful! The endpoint answered the test message.
          </Trans>
        ),
      });
    } catch (rawError) {
      const byokError = classifyByokError(rawError);
      setConnectionTestResult({ ok: false, message: byokError.message });
    } finally {
      setIsTestingConnection(false);
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

  const reasoningEffortLabels = {
    default: t`Default`,
    low: t`Low`,
    medium: t`Medium`,
    high: t`High`,
  };

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
        floatingLabelText={<Trans>API key</Trans>}
        value={apiKey}
        onChange={(event, text) => setApiKey(text)}
        onBlur={() => {
          saveByokKey(apiKey);
        }}
      />
      <Line noMargin>
        <Text size="body2" color="secondary">
          {isKeyStorageEncrypted ? (
            <Trans>API key storage: encrypted by the system.</Trans>
          ) : (
            <Trans>
              API key stored obfuscated in the browser storage — OS-level
              encryption is added on desktop.
            </Trans>
          )}
        </Text>
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
              value={contextWindowRow.tokens}
              min={MIN_CONTEXT_WINDOW_TOKENS}
              max={MAX_CONTEXT_WINDOW_TOKENS}
              onChange={(event, value) =>
                updateContextWindowForModel(contextWindowRow.modelId, value)
              }
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
            value={byokSettings.contextWindowTokens}
            min={MIN_CONTEXT_WINDOW_TOKENS}
            max={MAX_CONTEXT_WINDOW_TOKENS}
            onChange={(event, value) =>
              updateByokSetting({
                contextWindowTokens: clampContextWindow(parseInt(value, 10)),
              })
            }
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
