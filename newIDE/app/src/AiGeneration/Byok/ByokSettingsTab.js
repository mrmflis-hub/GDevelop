// @flow
import { t, Trans } from '@lingui/macro';
import * as React from 'react';

import PreferencesContext from '../../MainFrame/Preferences/PreferencesContext';
import Checkbox from '../../UI/Checkbox';
import { Column, Line } from '../../UI/Grid';
import { ColumnStackLayout, LineStackLayout } from '../../UI/Layout';
import CompactSelectField from '../../UI/CompactSelectField';
import SelectOption from '../../UI/SelectOption';
import Text from '../../UI/Text';
import TextField from '../../UI/TextField';
import {
  BYOK_REASONING_EFFORTS,
  DEFAULT_BYOK_SETTINGS,
  MAX_CONTEXT_WINDOW_TOKENS,
  MIN_CONTEXT_WINDOW_TOKENS,
  getByokSettings,
  type ByokSettings,
} from './ByokTypes';
import { getByokKeyStorageInfo, saveByokKey } from './ByokKeyStorage';

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
            The base URL of your provider: /models and /chat/completions are
            appended automatically.
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
            <Trans>API key storage: not yet encrypted (planned).</Trans>
          )}
        </Text>
      </Line>
      <TextField
        name="byok-model"
        floatingLabelText={<Trans>Model</Trans>}
        value={byokSettings.modelName}
        onChange={(event, text) => updateByokSetting({ modelName: text })}
      />
      <Line noMargin>
        <Text size="body2" color="secondary">
          <Trans>
            Fetching the model list from your provider arrives in a later
            update.
          </Trans>
        </Text>
      </Line>
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
            <Trans>Context window (tokens)</Trans>
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
    </ColumnStackLayout>
  );
};

export default ByokSettingsTab;
