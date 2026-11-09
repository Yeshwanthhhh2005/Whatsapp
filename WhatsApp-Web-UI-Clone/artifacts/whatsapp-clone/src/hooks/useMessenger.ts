/**
 * All chat state in one place: conversations, message history, typing,
 * presence, and the socket events that keep them current.
 *
 * Demo conversations (see lib/mockChats.ts) live in the same structures but
 * never touch the network, so the UI renders live and demo chats identically.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { parseTimestamp } from '@/lib/format';
import { createDemoChats, DEMO_SELF_ID, isDemoChat } from '@/lib/mockChats';
import {
  notificationBody,
  playChime,
  showMessageNotification,
} from '@/lib/notify';
import type {
  AnyMessage,
  Chat,
  ChatType,
  Message,
  MessageType,
  PendingMessage,
  ServerEvent,
  UserMe,
} from '@/lib/types';
import { isPending } from '@/lib/types';
import { useChatSocket } from '@/hooks/useChatSocket';

const PAGE_SIZE = 50;
/** How long a typing indicator survives without a refresh. */
const TYPING_TTL_MS = 4000;

interface TypingEntry {
  name: string;
  expiresAt: number;
}

type MessageMap = Record<string, AnyMessage[]>;
type CursorMap = Record<string, { hasMore: boolean; nextCursor: string | null }>;
type TypingMap = Record<string, Record<string, TypingEntry>>;

function ascending(a: AnyMessage, b: AnyMessage): number {
  const left = parseTimestamp(a.created_at)?.getTime() ?? 0;
  const right = parseTimestamp(b.created_at)?.getTime() ?? 0;
  if (left !== right) return left - right;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function activityTime(chat: Chat): number {
  return parseTimestamp(chat.last_message_at ?? chat.created_at)?.getTime() ?? 0;
}

export function useMessenger(user: UserMe, token: string | null) {
  const [liveChats, setLiveChats] = useState<Chat[]>([]);
  const [demoChats, setDemoChats] = useState<Chat[]>(() => createDemoChats(user));
  const [messages, setMessages] = useState<MessageMap>({});
  const [cursors, setCursors] = useState<CursorMap>({});
  const [typing, setTyping] = useState<TypingMap>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Demo histories are seeded once, on first open, from the fixture.
  const seededDemo = useRef(new Set<string>());
  const typingSentAt = useRef(0);
  // Late-bound: the socket handler needs these, but they are declared
  // further down. Refs keep the dependency one-way.
  const markReadRef = useRef<((chatId: string) => void) | null>(null);
  const selectChatRef = useRef<((chatId: string | null) => void) | null>(null);
  const chatsRef = useRef<Chat[]>([]);

  const allChats = useMemo(
    () =>
      [
        ...[...liveChats].sort((a, b) => activityTime(b) - activityTime(a)),
        ...demoChats,
      ],
    [liveChats, demoChats],
  );

  useEffect(() => {
    chatsRef.current = allChats;
  }, [allChats]);

  const selectedChat = useMemo(
    () => allChats.find((chat) => chat.id === selectedId) ?? null,
    [allChats, selectedId],
  );

  const isDemoSelected = selectedChat ? isDemoChat(selectedChat) : false;

  // ---------------------------------------------------------------------
  // Chat list
  // ---------------------------------------------------------------------

  const refreshChats = useCallback(async () => {
    try {
      setLiveChats(await api.listChats());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load chats.');
    } finally {
      setLoadingChats(false);
    }
  }, []);

  useEffect(() => {
    void refreshChats();
  }, [refreshChats]);

  const patchChat = useCallback(
    (chatId: string, patch: Partial<Chat>) => {
      const apply = (list: Chat[]) =>
        list.map((chat) => (chat.id === chatId ? { ...chat, ...patch } : chat));
      if (chatId.startsWith('demo-')) setDemoChats(apply);
      else setLiveChats(apply);
    },
    [],
  );

  // ---------------------------------------------------------------------
  // Message bookkeeping
  // ---------------------------------------------------------------------

  const upsertMessage = useCallback((incoming: Message) => {
    setMessages((current) => {
      const existing = current[incoming.chat_id] ?? [];

      // Reconcile the optimistic bubble this message confirms, matched by the
      // client_id we sent with it. Without this the sender briefly sees the
      // message twice.
      const pendingIndex = incoming.client_id
        ? existing.findIndex(
            (message) => isPending(message) && message.id === incoming.client_id,
          )
        : -1;

      let next: AnyMessage[];
      if (pendingIndex >= 0) {
        next = [...existing];
        next[pendingIndex] = incoming;
      } else {
        const index = existing.findIndex((message) => message.id === incoming.id);
        if (index >= 0) {
          next = [...existing];
          next[index] = incoming;
        } else {
          next = [...existing, incoming];
        }
      }

      return { ...current, [incoming.chat_id]: next.sort(ascending) };
    });
  }, []);

  const removePending = useCallback((chatId: string, clientId: string) => {
    setMessages((current) => {
      const existing = current[chatId];
      if (!existing) return current;
      return {
        ...current,
        [chatId]: existing.filter((message) => message.id !== clientId),
      };
    });
  }, []);

  const markPendingFailed = useCallback((chatId: string, clientId: string) => {
    setMessages((current) => {
      const existing = current[chatId];
      if (!existing) return current;
      return {
        ...current,
        [chatId]: existing.map((message) =>
          message.id === clientId && isPending(message)
            ? { ...message, failed: true }
            : message,
        ),
      };
    });
  }, []);

  // ---------------------------------------------------------------------
  // Socket
  // ---------------------------------------------------------------------

  const handleEvent = useCallback(
    (frame: ServerEvent) => {
      switch (frame.event) {
        case 'message': {
          const { message, chat_id: chatId } = frame.data;
          upsertMessage(message);

          const isMine = message.sender_id === user.id;
          const isOpen = chatId === selectedId;
          setLiveChats((current) =>
            current.map((chat) =>
              chat.id === chatId
                ? {
                    ...chat,
                    last_message: message,
                    last_message_at: message.created_at,
                    // Only an open chat in a *visible* tab counts as read.
                    // Open-but-backgrounded still earns a badge, or a message
                    // that arrived while you were away would vanish silently.
                    unread_count:
                      isMine || (isOpen && !document.hidden)
                        ? 0
                        : chat.unread_count + 1,
                  }
                : chat,
            ),
          );

          // A message in a chat we have never seen (someone started a new
          // conversation with us) is not in the list yet.
          setLiveChats((current) => {
            if (current.some((chat) => chat.id === chatId)) return current;
            void refreshChats();
            return current;
          });

          if (!isMine) {
            if (isOpen && !document.hidden) {
              // The recipient is looking right at it. Without this the server
              // never learns it was read -- only opening a chat sent a
              // receipt -- so the sender's ticks would stay grey while the
              // message sits visible on screen.
              markReadRef.current?.(chatId);
            } else {
              // Not the open chat, or the tab is in the background: this is
              // the case that deserves a notification.
              playChime();
              const chat = chatsRef.current.find(
                (candidate) => candidate.id === chatId,
              );
              showMessageNotification({
                chatId,
                title: chat?.is_group
                  ? `${message.sender?.name ?? 'Someone'} · ${chat.name}`
                  : (message.sender?.name ?? chat?.name ?? 'New message'),
                body: notificationBody(message),
                onClick: () => selectChatRef.current?.(chatId),
              });
            }
          }
          break;
        }

        case 'message_updated': {
          upsertMessage(frame.data.message);
          patchChatLastMessage(frame.data.chat_id, frame.data.message);
          break;
        }

        case 'message_deleted': {
          const { chat_id: chatId, message_id: messageId } = frame.data;
          setMessages((current) => {
            const existing = current[chatId];
            if (!existing) return current;
            return {
              ...current,
              [chatId]: existing.map((message) =>
                message.id === messageId
                  ? {
                      ...message,
                      is_deleted: true,
                      content: null,
                      file_url: null,
                      file_name: null,
                    }
                  : message,
              ),
            };
          });
          break;
        }

        case 'typing': {
          const { chat_id: chatId, user_id: userId, name, is_typing } = frame.data;
          if (userId === user.id) return;
          setTyping((current) => {
            const forChat = { ...(current[chatId] ?? {}) };
            if (is_typing) {
              forChat[userId] = { name, expiresAt: Date.now() + TYPING_TTL_MS };
            } else {
              delete forChat[userId];
            }
            return { ...current, [chatId]: forChat };
          });
          break;
        }

        case 'message_read': {
          const { chat_id: chatId, message_ids: ids } = frame.data;
          const idSet = new Set(ids);
          setMessages((current) => {
            const existing = current[chatId];
            if (!existing) return current;
            return {
              ...current,
              [chatId]: existing.map((message) =>
                idSet.has(message.id)
                  ? { ...message, status: 'read' as const, is_read: true }
                  : message,
              ),
            };
          });
          break;
        }

        case 'presence': {
          const { user_id: userId, is_online, last_seen } = frame.data;
          const updateMembers = (list: Chat[]) =>
            list.map((chat) => {
              if (!chat.members.some((member) => member.user.id === userId)) {
                return chat;
              }
              return {
                ...chat,
                members: chat.members.map((member) =>
                  member.user.id === userId
                    ? {
                        ...member,
                        user: { ...member.user, is_online, last_seen },
                      }
                    : member,
                ),
              };
            });
          setLiveChats(updateMembers);
          break;
        }

        case 'error': {
          setError(frame.data.detail);
          break;
        }

        default:
          break;
      }
    },
    // patchChatLastMessage is defined below and stable; declared via closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedId, upsertMessage, refreshChats, user.id],
  );

  function patchChatLastMessage(chatId: string, message: Message) {
    setLiveChats((current) =>
      current.map((chat) =>
        chat.id === chatId && chat.last_message?.id === message.id
          ? { ...chat, last_message: message }
          : chat,
      ),
    );
  }

  // Demo chats have no server to connect to, so no socket is opened for them.
  const socketChatId = selectedChat && !isDemoSelected ? selectedChat.id : null;
  const { status: socketStatus, send } = useChatSocket({
    chatId: socketChatId,
    token,
    onEvent: handleEvent,
  });

  // Expire stale typing indicators; a sender that closes its tab mid-type
  // never sends typing_stop.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setTyping((current) => {
        let changed = false;
        const next: TypingMap = {};
        for (const [chatId, entries] of Object.entries(current)) {
          const kept: Record<string, TypingEntry> = {};
          for (const [userId, entry] of Object.entries(entries)) {
            if (entry.expiresAt > now) kept[userId] = entry;
            else changed = true;
          }
          next[chatId] = kept;
        }
        return changed ? next : current;
      });
    }, 1500);
    return () => window.clearInterval(timer);
  }, []);

  // ---------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------

  const loadHistory = useCallback(
    async (chatId: string) => {
      setLoadingHistory(true);
      try {
        const page = await api.listMessages(chatId, { limit: PAGE_SIZE });
        setMessages((current) => ({
          ...current,
          // The API returns newest-first; the UI renders oldest-first.
          [chatId]: [...page.items].sort(ascending),
        }));
        setCursors((current) => ({
          ...current,
          [chatId]: { hasMore: page.has_more, nextCursor: page.next_cursor },
        }));
        setError(null);
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : 'Could not load messages.',
        );
      } finally {
        setLoadingHistory(false);
      }
    },
    [],
  );

  const loadOlder = useCallback(
    async (chatId: string) => {
      const cursor = cursors[chatId];
      if (!cursor?.hasMore || !cursor.nextCursor) return;
      try {
        const page = await api.listMessages(chatId, {
          limit: PAGE_SIZE,
          before: cursor.nextCursor,
        });
        setMessages((current) => {
          const existing = current[chatId] ?? [];
          const known = new Set(existing.map((message) => message.id));
          const merged = [
            ...page.items.filter((message) => !known.has(message.id)),
            ...existing,
          ];
          return { ...current, [chatId]: merged.sort(ascending) };
        });
        setCursors((current) => ({
          ...current,
          [chatId]: { hasMore: page.has_more, nextCursor: page.next_cursor },
        }));
      } catch {
        // Keep what is already shown; the user can scroll and retry.
      }
    },
    [cursors],
  );

  const markRead = useCallback(
    (chatId: string) => {
      if (chatId.startsWith('demo-')) {
        patchChat(chatId, { unread_count: 0 });
        return;
      }
      patchChat(chatId, { unread_count: 0 });
      // Prefer the socket (the server broadcasts the receipt either way), and
      // fall back to REST when it is not connected yet.
      if (!send({ event: 'message_read', data: {} })) {
        void api.markRead(chatId).catch(() => undefined);
      }
    },
    [patchChat, send],
  );

  const selectChat = useCallback(
    (chatId: string | null) => {
      setSelectedId(chatId);
      if (!chatId) return;

      if (chatId.startsWith('demo-')) {
        if (!seededDemo.current.has(chatId)) {
          seededDemo.current.add(chatId);
          const chat = demoChats.find((candidate) => candidate.id === chatId);
          const seed = chat ? collectDemoMessages(chat) : [];
          setMessages((current) => ({ ...current, [chatId]: seed }));
        }
        patchChat(chatId, { unread_count: 0 });
        return;
      }

      void loadHistory(chatId).then(() => markRead(chatId));
    },
    [demoChats, loadHistory, markRead, patchChat],
  );

  // ---------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------

  const appendDemoMessage = useCallback(
    (chatId: string, partial: Partial<Message> & { message_type: MessageType }) => {
      const message: Message = {
        id: `demo-local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        chat_id: chatId,
        sender_id: DEMO_SELF_ID,
        sender: user,
        content: null,
        file_url: null,
        file_name: null,
        file_size: null,
        status: 'read',
        is_read: true,
        is_deleted: false,
        created_at: new Date().toISOString(),
        edited_at: null,
        ...partial,
      };
      setMessages((current) => ({
        ...current,
        [chatId]: [...(current[chatId] ?? []), message],
      }));
      patchChat(chatId, {
        last_message: message,
        last_message_at: message.created_at,
      });
    },
    [patchChat, user],
  );

  const sendMessage = useCallback(
    async (payload: {
      content?: string | null;
      message_type?: MessageType;
      file_url?: string | null;
      file_name?: string | null;
      file_size?: number | null;
    }) => {
      const chat = selectedChat;
      if (!chat) return;

      if (isDemoChat(chat)) {
        appendDemoMessage(chat.id, {
          message_type: payload.message_type ?? 'text',
          content: payload.content ?? null,
          file_url: payload.file_url ?? null,
          file_name: payload.file_name ?? null,
          file_size: payload.file_size ?? null,
        });
        return;
      }

      const clientId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const optimistic: PendingMessage = {
        pending: true,
        id: clientId,
        chat_id: chat.id,
        sender_id: user.id,
        sender: user,
        content: payload.content ?? null,
        message_type: payload.message_type ?? 'text',
        file_url: payload.file_url ?? null,
        file_name: payload.file_name ?? null,
        file_size: payload.file_size ?? null,
        status: 'sent',
        is_read: false,
        is_deleted: false,
        created_at: new Date().toISOString(),
        edited_at: null,
      };

      setMessages((current) => ({
        ...current,
        [chat.id]: [...(current[chat.id] ?? []), optimistic],
      }));

      const body = { ...payload, client_id: clientId };

      // Over the socket when it is open, so the round trip is one hop; the
      // broadcast that comes back replaces the optimistic bubble.
      if (send({ event: 'message', data: body })) return;

      try {
        const saved = await api.sendMessage(chat.id, body);
        // The socket may also deliver this; upsert is keyed on client_id and
        // then id, so either order converges on one bubble.
        removePending(chat.id, clientId);
        upsertMessage(saved);
        patchChat(chat.id, {
          last_message: saved,
          last_message_at: saved.created_at,
        });
      } catch (cause) {
        markPendingFailed(chat.id, clientId);
        setError(
          cause instanceof Error ? cause.message : 'Message could not be sent.',
        );
      }
    },
    [
      selectedChat,
      appendDemoMessage,
      send,
      user,
      removePending,
      upsertMessage,
      patchChat,
      markPendingFailed,
    ],
  );

  const sendFile = useCallback(
    async (file: File, caption?: string) => {
      const chat = selectedChat;
      if (!chat) return;

      if (isDemoChat(chat)) {
        appendDemoMessage(chat.id, {
          message_type: file.type.startsWith('image/') ? 'image' : 'document',
          content: caption?.trim() || null,
          file_name: file.name,
          file_size: file.size,
          file_url: `demo://${file.name}`,
        });
        return;
      }

      try {
        const stored = await api.upload(file);
        await sendMessage({
          message_type: stored.message_type,
          file_url: stored.url,
          file_name: stored.file_name,
          file_size: stored.file_size,
          content: caption?.trim() || null,
        });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Upload failed.');
      }
    },
    [selectedChat, appendDemoMessage, sendMessage],
  );

  const editMessage = useCallback(
    async (messageId: string, content: string) => {
      const chat = selectedChat;
      if (!chat) return;
      if (isDemoChat(chat) || messageId.startsWith('demo-')) {
        setMessages((current) => ({
          ...current,
          [chat.id]: (current[chat.id] ?? []).map((message) =>
            message.id === messageId
              ? { ...message, content, edited_at: new Date().toISOString() }
              : message,
          ),
        }));
        return;
      }
      try {
        upsertMessage(await api.editMessage(messageId, content));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not edit.');
      }
    },
    [selectedChat, upsertMessage],
  );

  const deleteMessage = useCallback(
    async (messageId: string) => {
      const chat = selectedChat;
      if (!chat) return;
      if (isDemoChat(chat) || messageId.startsWith('demo-')) {
        setMessages((current) => ({
          ...current,
          [chat.id]: (current[chat.id] ?? []).filter(
            (message) => message.id !== messageId,
          ),
        }));
        return;
      }
      try {
        upsertMessage(await api.deleteMessage(messageId));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not delete.');
      }
    },
    [selectedChat, upsertMessage],
  );

  // ---------------------------------------------------------------------
  // Typing
  // ---------------------------------------------------------------------

  const notifyTyping = useCallback(
    (isTyping: boolean) => {
      if (!selectedChat || isDemoSelected) return;
      const now = Date.now();
      // Refresh at most every 2s rather than on every keystroke.
      if (isTyping && now - typingSentAt.current < 2000) return;
      typingSentAt.current = isTyping ? now : 0;
      send({ event: isTyping ? 'typing_start' : 'typing_stop', data: {} });
    },
    [selectedChat, isDemoSelected, send],
  );

  // ---------------------------------------------------------------------
  // Creating chats
  // ---------------------------------------------------------------------

  const createChat = useCallback(
    async (payload: { type: ChatType; member_ids: string[]; name?: string }) => {
      try {
        const chat = await api.createChat(payload);
        setLiveChats((current) =>
          current.some((candidate) => candidate.id === chat.id)
            ? current.map((candidate) =>
                candidate.id === chat.id ? chat : candidate,
              )
            : [chat, ...current],
        );
        selectChat(chat.id);
        setError(null);
        return chat;
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : 'Could not create the chat.',
        );
        return null;
      }
    },
    [selectChat],
  );

  useEffect(() => {
    markReadRef.current = markRead;
    selectChatRef.current = selectChat;
  }, [markRead, selectChat]);

  // Returning to the tab with a conversation open counts as reading it.
  useEffect(() => {
    const onVisible = () => {
      if (document.hidden || !selectedId || selectedId.startsWith('demo-')) return;
      markRead(selectedId);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [selectedId, markRead]);

  const selectedMessages = selectedId ? (messages[selectedId] ?? []) : [];
  const typingNames = selectedId
    ? Object.values(typing[selectedId] ?? {}).map((entry) => entry.name)
    : [];

  return {
    chats: allChats,
    liveChats,
    selectedChat,
    selectedId,
    selectedMessages,
    isDemoSelected,
    typingNames,
    socketStatus,
    loadingChats,
    loadingHistory,
    hasMoreHistory: selectedId ? (cursors[selectedId]?.hasMore ?? false) : false,
    error,
    clearError: () => setError(null),
    selectChat,
    sendMessage,
    sendFile,
    editMessage,
    deleteMessage,
    notifyTyping,
    createChat,
    loadOlder,
    refreshChats,
    markRead,
  };
}

/** A demo chat carries its seeded history on the fixture itself. */
function collectDemoMessages(chat: Chat): AnyMessage[] {
  if (isDemoChat(chat)) return [...chat.messages].sort(ascending);
  return chat.last_message ? [chat.last_message] : [];
}
