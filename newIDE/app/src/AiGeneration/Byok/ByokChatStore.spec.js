// @flow
const ByokChatStore = require('./ByokChatStore');

describe('ByokChatStore', () => {
  // The store is a module-level map: reset it between tests.
  let unsubscribeFromSetup: () => void;
  beforeEach(() => {
    for (const chat of ByokChatStore.listByokChats()) {
      ByokChatStore.archiveByokChat(chat.id);
    }
    unsubscribeFromSetup = ByokChatStore.subscribeByokChats(() => {});
  });
  afterEach(() => {
    unsubscribeFromSetup();
  });

  it('creates chats with unique ids prefixed by "byok-"', () => {
    const firstChat = ByokChatStore.createByokChat();
    const secondChat = ByokChatStore.createByokChat();

    expect(firstChat.id.startsWith('byok-')).toBe(true);
    expect(secondChat.id.startsWith('byok-')).toBe(true);
    expect(firstChat.id).not.toBe(secondChat.id);
  });

  it('creates chats ready to be rendered by the chat UI', () => {
    const chat = ByokChatStore.createByokChat();

    expect(chat.status).toBe('working');
    expect(chat.output).toEqual([]);
    expect(chat.error).toBe(null);
    expect(typeof chat.createdAt).toBe('string');
    expect(typeof chat.updatedAt).toBe('string');
  });

  it('gets a chat by id, and null for an unknown id', () => {
    const chat = ByokChatStore.createByokChat();

    expect(ByokChatStore.getByokChat(chat.id)).not.toBe(null);
    expect(ByokChatStore.getByokChat('byok-does-not-exist')).toBe(null);
  });

  it('updates a chat, bumping updatedAt and notifying the subscribers', () => {
    const listener = mockFn(jest.fn());
    const unsubscribe = ByokChatStore.subscribeByokChats(listener);
    const chat = ByokChatStore.createByokChat();
    listener.mockClear();

    ByokChatStore.updateByokChat({
      ...chat,
      status: 'ready',
    });

    const updatedChat = ByokChatStore.getByokChat(chat.id);
    if (!updatedChat) throw new Error('The chat disappeared from the store');
    expect(updatedChat.status).toBe('ready');
    expect(updatedChat.updatedAt >= chat.updatedAt).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('ignores updates for unknown chat ids', () => {
    const chat = ByokChatStore.createByokChat();
    const listener = mockFn(jest.fn());
    const unsubscribe = ByokChatStore.subscribeByokChats(listener);

    ByokChatStore.updateByokChat({
      ...chat,
      id: 'byok-never-created',
      status: 'ready',
    });

    expect(listener).not.toHaveBeenCalled();
    expect(ByokChatStore.getByokChat('byok-never-created')).toBe(null);
    expect(ByokChatStore.getByokChat(chat.id)).not.toBe(null);

    unsubscribe();
  });

  it('archives a chat: it disappears from the list and from get', () => {
    const chat = ByokChatStore.createByokChat();
    expect(ByokChatStore.listByokChats()).toContainEqual(
      expect.objectContaining({ id: chat.id })
    );

    ByokChatStore.archiveByokChat(chat.id);

    expect(ByokChatStore.listByokChats().map(c => c.id)).not.toContain(chat.id);
    expect(ByokChatStore.getByokChat(chat.id)).toBe(null);
  });

  it('ignores updates after a chat was archived (guards the suspend-on-archive path)', () => {
    const listener = mockFn(jest.fn());
    const unsubscribe = ByokChatStore.subscribeByokChats(listener);
    const chat = ByokChatStore.createByokChat();
    ByokChatStore.archiveByokChat(chat.id);
    listener.mockClear();

    // An orchestrator that was suspended but still had one update in
    // flight must not resurrect the archived chat.
    chat.status = 'ready';
    ByokChatStore.updateByokChat(chat);

    expect(ByokChatStore.getByokChat(chat.id)).toBe(null);
    expect(listener).not.toHaveBeenCalled();

    unsubscribe();
  });

  it('supports subscribing and unsubscribing', () => {
    const listener = mockFn(jest.fn());
    const unsubscribe = ByokChatStore.subscribeByokChats(listener);

    ByokChatStore.createByokChat();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    ByokChatStore.createByokChat();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('documents the v1 session-only persistence decision', () => {
    expect(ByokChatStore.BYOK_CHAT_PERSISTENCE_ENABLED).toBe(false);
  });
});

function mockFn(fn: any): any {
  return fn;
}
