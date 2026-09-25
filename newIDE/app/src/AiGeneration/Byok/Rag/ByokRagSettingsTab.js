// @flow
import { t, Trans } from '@lingui/macro';
import * as React from 'react';

import PreferencesContext from '../../../MainFrame/Preferences/PreferencesContext';
import Checkbox from '../../../UI/Checkbox';
import FlatButton from '../../../UI/FlatButton';
import { Column, Line } from '../../../UI/Grid';
import { ColumnStackLayout, LineStackLayout } from '../../../UI/Layout';
import CompactSelectField from '../../../UI/CompactSelectField';
import RaisedButton from '../../../UI/RaisedButton';
import SelectOption from '../../../UI/SelectOption';
import Text from '../../../UI/Text';
import TextField from '../../../UI/TextField';
import useAlertDialog from '../../../UI/Alert/useAlertDialog';
import {
  BYOK_RAG_EMBEDDERS,
  getByokRagSettings,
  type ByokRagSettings,
} from './ByokRagTypes';
import {
  rebuildByokRagIndex,
  readByokRagIndexStatus,
  type ByokRagBuildProgress,
} from './ByokRagBuildService';
import {
  invokeByokQdrantSetup,
  invokeByokQdrantStatus,
  type ByokQdrantStatus,
} from './ByokRagFileBackends';
import { openFilePicker } from '../../../Utils/FileSystem';

/**
 * The RAG preferences tab (Phase 13.8): the status card, the embedder
 * picker (with explicit download size + consent, D13-9), the rebuild
 * button with progress, the opt-in local docs folder, and the Qdrant card
 * (one-click permanent indexing, loopback only, clean fallback).
 */
const ByokRagSettingsTab = (): React.Node => {
  const { values, setMultipleValues } = React.useContext(PreferencesContext);
  const ragSettings = getByokRagSettings(values);
  const { showConfirmation } = useAlertDialog();

  const [isBuilding, setIsBuilding] = React.useState<boolean>(false);
  const [
    buildProgress,
    setBuildProgress,
  ] = React.useState<ByokRagBuildProgress | null>(null);
  const [buildError, setBuildError] = React.useState<string | null>(null);
  const [indexStatus, setIndexStatus] = React.useState<?{
    chunkCount: number,
    builtAt: string,
    embedderId: string,
    corpusHash?: string,
  }>(null);
  const [qdrantStatus, setQdrantStatus] = React.useState<?ByokQdrantStatus>(
    null
  );
  const [qdrantBusy, setQdrantBusy] = React.useState<boolean>(false);
  const [qdrantMessage, setQdrantMessage] = React.useState<React.Node | null>(
    null
  );

  const updateRagSetting = (partial: Partial<ByokRagSettings>) => {
    setMultipleValues({ byokRag: { ...ragSettings, ...partial } });
  };

  const refreshStatus = React.useCallback(
    async () => {
      const status: any = await readByokRagIndexStatus(ragSettings);
      setIndexStatus(status);
      setQdrantStatus(await invokeByokQdrantStatus());
    },
    [ragSettings]
  );

  // The status refresh runs once per mount (a ref guards it): the settings
  // object is re-created every render, and the status objects come back
  // with fresh identities too — an ungated [refreshStatus] effect would
  // loop renders forever.
  const didRefreshStatusRef = React.useRef<boolean>(false);
  React.useEffect(
    () => {
      if (didRefreshStatusRef.current) return;
      didRefreshStatusRef.current = true;
      void refreshStatus();
    },
    [refreshStatus]
  );

  /**
   * Build the index: the consent for the embedder download runs first
   * (D13-9: explicit size, nothing downloads behind the user's back).
   */
  const onRebuild = async () => {
    const embedder = BYOK_RAG_EMBEDDERS.find(
      candidate => candidate.id === ragSettings.embedderId
    );
    const downloadMegabytes = embedder
      ? embedder.approximateDownloadMegabytes
      : 25;
    const accepted = await showConfirmation({
      title: t`Download the local embedding model?`,
      message: t`The semantic index needs a small local model (~${downloadMegabytes} MB), downloaded once and cached. Everything stays on your machine: no text ever leaves it.`,
      confirmButtonLabel: t`Download and build`,
      dismissButtonLabel: t`Cancel`,
    });
    if (!accepted) return;

    setIsBuilding(true);
    setBuildError(null);
    setBuildProgress({ stage: 'embedding', progress: 0 });
    const outcome = await rebuildByokRagIndex({
      settings: ragSettings,
      onProgress: progress => setBuildProgress(progress),
    });
    setIsBuilding(false);
    setBuildProgress(null);
    if (outcome.ok) {
      await refreshStatus();
    } else {
      setBuildError(
        `${
          outcome.error
        } The search_knowledge tool still works with exact-text search.`
      );
    }
  };

  const onToggleEnabled = async (enabled: boolean) => {
    if (enabled) {
      const accepted = await showConfirmation({
        title: t`Enable on-device semantic search?`,
        message: t`The first build downloads a small local embedding model (about 25 MB) and indexes the bundled corpus on this machine. Nothing is sent anywhere.`,
        confirmButtonLabel: t`Enable`,
        dismissButtonLabel: t`Cancel`,
      });
      if (!accepted) return;
    }
    updateRagSetting({ enabled });
  };

  const onSetupQdrant = async () => {
    setQdrantBusy(true);
    setQdrantMessage(null);
    const outcome = await invokeByokQdrantSetup();
    setQdrantBusy(false);
    if (outcome.ok) {
      setQdrantMessage(
        outcome.mode === 'used-existing' ? (
          <Trans>
            Using the Qdrant instance already running on this machine.
          </Trans>
        ) : (
          <Trans>
            Qdrant installed and started (loopback only). It will start with the
            app from now on.
          </Trans>
        )
      );
      if (outcome.baseUrl) {
        updateRagSetting({ backend: 'qdrant', qdrantBaseUrl: outcome.baseUrl });
      }
    } else {
      // The clean fallback (D13-8): RAG never hard-depends on Qdrant.
      setQdrantMessage(
        <Trans>
          {(outcome.error || 'The setup failed.') +
            ' The built-in in-process index keeps working — you can retry later.'}
        </Trans>
      );
    }
    setQdrantStatus(await invokeByokQdrantStatus());
  };

  const onPickDocsFolder = async () => {
    const folderPath = await openFilePicker({
      title: 'Choose the documentation folder to index',
      properties: ['openDirectory'],
      message: 'Every .md file under this folder joins the local index',
      filters: [{ name: 'Folders', extensions: [] }],
    });
    if (folderPath && typeof folderPath === 'string') {
      updateRagSetting({ docsFolderPath: folderPath });
    }
  };

  return (
    <ColumnStackLayout>
      <Text size="block-title">
        <Trans>RAG — on-device semantic search</Trans>
      </Text>
      <Text>
        <Trans>
          Build a local semantic index over the engine reference, the bundled
          documentation, the skills and the EventScript examples, so the AI can
          grep the full documentation on-device. Nothing ever leaves this
          machine.
        </Trans>
      </Text>
      <Checkbox
        checked={ragSettings.enabled}
        onCheck={(event, checked) => {
          void onToggleEnabled(checked);
        }}
        label={<Trans>Enable semantic search (search_knowledge tool)</Trans>}
      />
      <Text size="block-title">
        <Trans>Status</Trans>
      </Text>
      <Line noMargin>
        <Text size="body2" color="secondary">
          {indexStatus
            ? `${indexStatus.chunkCount} chunks · built ${
                indexStatus.builtAt
              } · embedder ${indexStatus.embedderId}`
            : 'No index built yet — the tool answers with exact-text search until then.'}
        </Text>
      </Line>
      {isBuilding && buildProgress && (
        <Line noMargin>
          <Text size="body2" color="secondary">
            {buildProgress.stage === 'embedding'
              ? `Embedding the corpus… ${Math.round(
                  buildProgress.progress * 100
                )}%`
              : buildProgress.stage === 'uploading'
              ? 'Uploading to Qdrant…'
              : 'Done.'}
          </Text>
        </Line>
      )}
      <Text size="block-title">
        <Trans>Embedder</Trans>
      </Text>
      <LineStackLayout noMargin alignItems="center">
        <Column noMargin expand>
          <CompactSelectField
            value={ragSettings.embedderId}
            onChange={(value: string) => {
              const embedder = BYOK_RAG_EMBEDDERS.find(
                candidate => candidate.id === value
              );
              if (!embedder) return;
              updateRagSetting({ embedderId: embedder.id });
            }}
          >
            {BYOK_RAG_EMBEDDERS.map(embedder => (
              <SelectOption
                key={embedder.id}
                value={embedder.id}
                label={embedder.label}
              />
            ))}
          </CompactSelectField>
        </Column>
      </LineStackLayout>
      <Line noMargin>
        <Text size="body2" color="secondary">
          {(() => {
            const selected = BYOK_RAG_EMBEDDERS.find(
              embedder => embedder.id === ragSettings.embedderId
            );
            return selected
              ? `${selected.approximateDownloadMegabytes} MB download · ${
                  selected.languageNote
                } · changes require a rebuild`
              : '';
          })()}
        </Text>
      </Line>
      <Line noMargin>
        <RaisedButton
          label={
            isBuilding ? <Trans>Building…</Trans> : <Trans>Rebuild index</Trans>
          }
          onClick={onRebuild}
          disabled={isBuilding}
        />
      </Line>
      {buildError && (
        <Line noMargin>
          <Text size="body2" color="error">
            {buildError}
          </Text>
        </Line>
      )}
      <Text size="block-title">
        <Trans>Extra documentation folder (optional)</Trans>
      </Text>
      <TextField
        name="byok-rag-docs-folder"
        floatingLabelText={<Trans>Local folder of .md files to index</Trans>}
        hintText="C:\Projects\GDevelop\DOCs"
        value={ragSettings.docsFolderPath}
        onChange={(event, text) => updateRagSetting({ docsFolderPath: text })}
      />
      <Line noMargin>
        <FlatButton
          label={<Trans>Pick a folder…</Trans>}
          onClick={onPickDocsFolder}
        />
      </Line>
      <Text size="block-title">
        <Trans>Qdrant (permanent index)</Trans>
      </Text>
      <Text>
        <Trans>
          Set up permanent indexing with Qdrant: the official binary is
          downloaded into your GDevelop user-data folder and started with the
          app (loopback only). The built-in in-process index keeps working
          without it.
        </Trans>
      </Text>
      <Line noMargin>
        <Text size="body2" color="secondary">
          {qdrantStatus
            ? qdrantStatus.healthy
              ? `Healthy at ${qdrantStatus.baseUrl || ''}`
              : qdrantStatus.installed
              ? 'Installed but not running.'
              : 'Not installed.'
            : 'Qdrant management needs the desktop app.'}
        </Text>
      </Line>
      <Line noMargin>
        <RaisedButton
          label={
            qdrantBusy ? (
              <Trans>Setting up…</Trans>
            ) : (
              <Trans>Set up permanent indexing with Qdrant</Trans>
            )
          }
          onClick={onSetupQdrant}
          disabled={qdrantBusy}
        />
      </Line>
      {qdrantMessage && (
        <Line noMargin>
          <Text size="body2" color="secondary">
            {qdrantMessage}
          </Text>
        </Line>
      )}
      <Text size="block-title">
        <Trans>Index backend</Trans>
      </Text>
      <LineStackLayout noMargin alignItems="center">
        <Column noMargin expand>
          <CompactSelectField
            value={ragSettings.backend}
            onChange={(value: string) => {
              const backend = value === 'qdrant' ? 'qdrant' : 'in-process';
              // Switching backends invalidates the vectors: the next
              // rebuild uploads to (or rebuilds in) the new backend.
              updateRagSetting({ backend });
            }}
          >
            <SelectOption
              value="in-process"
              label={t`Built-in (in this app, no server)`}
            />
            <SelectOption value="qdrant" label={t`Qdrant (permanent)`} />
          </CompactSelectField>
        </Column>
      </LineStackLayout>
    </ColumnStackLayout>
  );
};

export default ByokRagSettingsTab;
