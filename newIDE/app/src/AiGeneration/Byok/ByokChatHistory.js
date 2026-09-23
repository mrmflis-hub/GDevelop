// @flow
import { t, Trans } from '@lingui/macro';
import * as React from 'react';

import FlatButton from '../../UI/FlatButton';
import IconButton from '../../UI/IconButton';
import { ColumnStackLayout, LineStackLayout } from '../../UI/Layout';
import { Line } from '../../UI/Grid';
import Text from '../../UI/Text';
import TextField from '../../UI/TextField';
import RaisedButton from '../../UI/RaisedButton';
import Archive from '../../UI/CustomSvgIcons/Archive';
import Restore from '../../UI/CustomSvgIcons/Restore';
import Trash from '../../UI/CustomSvgIcons/Trash';
import Check from '../../UI/CustomSvgIcons/Check';
import Cross from '../../UI/CustomSvgIcons/Cross';
import Edit from '../../UI/CustomSvgIcons/Edit';
import useAlertDialog from '../../UI/Alert/useAlertDialog';
import { getByokChatPersistence } from './ByokChatStore';
import type { ByokChatFileMeta } from './ByokChatPersistence';

/**
 * The BYOK chat history (Phase 9.3, owner decision #1): the button in the
 * chat tab lists the saved chats (names and dates only — the full chat
 * loads when it is opened), with rename, archive/restore, delete and open.
 * It lives alongside — not inside — the server-backed AskAiHistory flow.
 */

export type ByokChatHistoryProps = {|
  onOpenChat: (chatId: string) => Promise<void> | void,
  selectedChatId: string | null,
|};

const formatDate = (isoDate: string): string => {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return isoDate;
  return (
    date.toLocaleDateString() +
    ' ' +
    date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  );
};

export const ByokChatHistory = ({
  onOpenChat,
  selectedChatId,
}: ByokChatHistoryProps): React.Node => {
  const { showConfirmation } = useAlertDialog();
  const [isDialogOpen, setIsDialogOpen] = React.useState<boolean>(false);
  const [activeMetas, setActiveMetas] = React.useState<Array<ByokChatFileMeta>>(
    []
  );
  const [archivedMetas, setArchivedMetas] = React.useState<
    Array<ByokChatFileMeta>
  >([]);
  const [renamingChatId, setRenamingChatId] = React.useState<string | null>(
    null
  );
  const [renameDraft, setRenameDraft] = React.useState<string>('');

  const refreshMetas = React.useCallback(async (): Promise<void> => {
    const store = getByokChatPersistence();
    if (!store) return;
    try {
      const allMetas = await store.listChatMetas();
      setActiveMetas(allMetas.filter(meta => !meta.archivedAt));
      setArchivedMetas(allMetas.filter(meta => !!meta.archivedAt));
    } catch (error) {
      // The history is best-effort: an unreadable storage shows an empty list.
    }
  }, []);

  React.useEffect(
    () => {
      if (isDialogOpen) refreshMetas();
    },
    [isDialogOpen, refreshMetas]
  );

  const onRename = async (chatId: string): Promise<void> => {
    const store = getByokChatPersistence();
    if (!store) return;
    await store.renameChat(chatId, renameDraft);
    setRenamingChatId(null);
    refreshMetas();
  };

  const onSetArchived = async (
    chatId: string,
    archived: boolean
  ): Promise<void> => {
    const store = getByokChatPersistence();
    if (!store) return;
    await store.setArchived(chatId, archived ? new Date().toISOString() : null);
    refreshMetas();
  };

  const onDelete = async (chatId: string): Promise<void> => {
    const store = getByokChatPersistence();
    if (!store) return;
    const confirmed = await showConfirmation({
      title: t`Delete this chat?`,
      message: t`The chat and its screenshots will be permanently deleted. This cannot be undone.`,
      confirmButtonLabel: t`Delete`,
    });
    if (!confirmed) return;
    await store.deleteChat(chatId);
    refreshMetas();
  };

  const renderMetaRow = (meta: ByokChatFileMeta, isArchived: boolean) => {
    const isRenaming = renamingChatId === meta.id;
    return (
      <LineStackLayout key={meta.id} noMargin alignItems="center">
        <ColumnStackLayout expand noMargin>
          {isRenaming ? (
            <TextField
              name="byok-chat-rename"
              value={renameDraft}
              onChange={(event, text) => setRenameDraft(text)}
            />
          ) : (
            <>
              <Text noMargin>
                {meta.name}
                {selectedChatId === meta.id ? (
                  <Text size="body2" color="secondary">
                    {' '}
                    (<Trans>open</Trans>)
                  </Text>
                ) : null}
              </Text>
              <Text size="body2" color="secondary" noMargin>
                {formatDate(meta.updatedAt)} · {meta.messageCount}{' '}
                <Trans>message(s)</Trans>
              </Text>
            </>
          )}
        </ColumnStackLayout>
        {isRenaming ? (
          <>
            <IconButton
              tooltip={t`Save the new name`}
              onClick={() => onRename(meta.id)}
            >
              <Check fontSize="small" />
            </IconButton>
            <IconButton
              tooltip={t`Cancel`}
              onClick={() => setRenamingChatId(null)}
            >
              <Cross fontSize="small" />
            </IconButton>
          </>
        ) : (
          <>
            <FlatButton
              label={<Trans>Open</Trans>}
              onClick={async () => {
                await onOpenChat(meta.id);
                setIsDialogOpen(false);
              }}
            />
            <IconButton
              tooltip={t`Rename`}
              onClick={() => {
                setRenamingChatId(meta.id);
                setRenameDraft(meta.name);
              }}
            >
              <Edit fontSize="small" />
            </IconButton>
            <IconButton
              tooltip={isArchived ? t`Restore` : t`Archive`}
              onClick={() => onSetArchived(meta.id, !isArchived)}
            >
              {isArchived ? (
                <Restore fontSize="small" />
              ) : (
                <Archive fontSize="small" />
              )}
            </IconButton>
            <IconButton tooltip={t`Delete`} onClick={() => onDelete(meta.id)}>
              <Trash fontSize="small" />
            </IconButton>
          </>
        )}
      </LineStackLayout>
    );
  };

  return (
    <>
      <FlatButton
        label={<Trans>Chat history</Trans>}
        onClick={() => setIsDialogOpen(true)}
      />
      {isDialogOpen && (
        // A self-contained overlay panel: no new dependency, no portal.
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
          }}
          onClick={() => setIsDialogOpen(false)}
        >
          <div
            style={{
              background: '#fff',
              color: '#000',
              borderRadius: 8,
              padding: 16,
              maxWidth: 520,
              width: '90%',
              maxHeight: '80%',
              overflowY: 'auto',
            }}
            onClick={event => event.stopPropagation()}
          >
            <ColumnStackLayout noMargin>
              <Text size="block-title">
                <Trans>BYOK chat history</Trans>
              </Text>
              <Text size="body2" color="secondary">
                <Trans>
                  Chats are saved on this computer after every message. Open one
                  to continue it.
                </Trans>
              </Text>
              {activeMetas.length === 0 && archivedMetas.length === 0 ? (
                <Text size="body2" color="secondary">
                  <Trans>No saved chats yet.</Trans>
                </Text>
              ) : null}
              {activeMetas.map(meta => renderMetaRow(meta, false))}
              {archivedMetas.length > 0 && (
                <Text size="block-title">
                  <Trans>Archived</Trans>
                </Text>
              )}
              {archivedMetas.map(meta => renderMetaRow(meta, true))}
              <Line noMargin justifyContent="flex-end">
                <RaisedButton
                  label={<Trans>Close</Trans>}
                  onClick={() => setIsDialogOpen(false)}
                />
              </Line>
            </ColumnStackLayout>
          </div>
        </div>
      )}
    </>
  );
};

export default ByokChatHistory;
