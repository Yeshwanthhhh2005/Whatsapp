import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import {
  ArrowLeft,
  Info,
  Loader2,
  Mic,
  MoreVertical,
  Paperclip,
  Phone,
  Search,
  Send,
  Smile,
  Video,
  X,
} from 'lucide-react';

import { Avatar } from '@/components/Avatar';
import { MessageBubble } from '@/components/MessageBubble';
import { dayKey, formatDayDivider, formatPresence } from '@/lib/format';
import type { AnyMessage, Chat, UserMe } from '@/lib/types';
import type { SocketStatus } from '@/hooks/useChatSocket';
import { useDismiss } from '@/hooks/useDismiss';

const EMOJI = [
  '😀', '😂', '🥹', '😍', '😊', '✨', '❤️', '👍', '🙏', '🎉', '🌿', '☀️',
  '🥰', '🤍', '😅', '🙌', '🥖', '📚', '💛', '🌸', '🫶', '👀', '☕', '🌙',
];

interface Props {
  chat: Chat;
  me: UserMe;
  messages: AnyMessage[];
  typingNames: string[];
  socketStatus: SocketStatus;
  isDemo: boolean;
  mobile: boolean;
  loadingHistory: boolean;
  hasMoreHistory: boolean;
  onBack: () => void;
  onOpenInfo: () => void;
  onLoadOlder: () => void;
  onSendText: (text: string) => void;
  onSendFile: (file: File) => void;
  onEditMessage: (messageId: string, content: string) => void;
  onDeleteMessage: (messageId: string) => void;
  onTyping: (isTyping: boolean) => void;
  onNotify: (text: string) => void;
}

export function ChatPane({
  chat,
  me,
  messages,
  typingNames,
  socketStatus,
  isDemo,
  mobile,
  loadingHistory,
  hasMoreHistory,
  onBack,
  onOpenInfo,
  onLoadOlder,
  onSendText,
  onSendFile,
  onEditMessage,
  onDeleteMessage,
  onTyping,
  onNotify,
}: Props) {
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useDismiss(menuOpen, useCallback(() => setMenuOpen(false), []));
  useDismiss(emojiOpen, useCallback(() => setEmojiOpen(false), []));

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const typingStopTimer = useRef<number | null>(null);
  // Remembers scroll height across an older-page prepend.
  const restoreScroll = useRef<number | null>(null);

  const otherMember = useMemo(
    () => chat.members.find((member) => member.user.id !== me.id)?.user ?? null,
    [chat.members, me.id],
  );

  const visible = useMemo(() => {
    if (!search.trim()) return messages;
    const needle = search.trim().toLowerCase();
    return messages.filter((message) =>
      (message.content ?? '').toLowerCase().includes(needle),
    );
  }, [messages, search]);

  // Reset per-chat view state when switching conversations.
  useEffect(() => {
    setDraft('');
    setSearch('');
    setSearchOpen(false);
    setEmojiOpen(false);
  }, [chat.id]);

  // Stick to the bottom as messages arrive, unless the user has scrolled up
  // to read history.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    if (restoreScroll.current !== null) {
      // An older page was prepended: hold the viewport on the same message
      // instead of letting the content jump.
      list.scrollTop = list.scrollHeight - restoreScroll.current;
      restoreScroll.current = null;
      return;
    }

    const distanceFromBottom =
      list.scrollHeight - list.scrollTop - list.clientHeight;
    if (distanceFromBottom < 240) {
      list.scrollTop = list.scrollHeight;
    }
  }, [visible.length, chat.id]);

  // Jump to the bottom on first open of a chat.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [chat.id]);

  function handleScroll() {
    const list = listRef.current;
    if (!list || !hasMoreHistory || loadingHistory) return;
    if (list.scrollTop < 80) {
      restoreScroll.current = list.scrollHeight;
      onLoadOlder();
    }
  }

  function handleDraftChange(event: ChangeEvent<HTMLInputElement>) {
    setDraft(event.target.value);
    onTyping(true);
    if (typingStopTimer.current !== null) {
      window.clearTimeout(typingStopTimer.current);
    }
    // Idle for a moment counts as having stopped typing.
    typingStopTimer.current = window.setTimeout(() => onTyping(false), 2500);
  }

  function submit() {
    const text = draft.trim();
    if (!text) return;
    onSendText(text);
    setDraft('');
    setEmojiOpen(false);
    onTyping(false);
    if (typingStopTimer.current !== null) {
      window.clearTimeout(typingStopTimer.current);
      typingStopTimer.current = null;
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
    if (event.key === 'Escape') {
      setEmojiOpen(false);
    }
  }

  function pickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) onSendFile(file);
    // Clear so selecting the same file twice fires change again.
    event.target.value = '';
  }

  useEffect(
    () => () => {
      if (typingStopTimer.current !== null) {
        window.clearTimeout(typingStopTimer.current);
      }
    },
    [],
  );

  const subtitle = isDemo
    ? 'local demo conversation'
    : chat.is_group
      ? `${chat.members.length} members`
      : otherMember
        ? formatPresence(otherMember.is_online, otherMember.last_seen)
        : '';

  return (
    <section className="chat-pane">
      <div className="wallpaper" />

      <header className="chat-head">
        {mobile && (
          <button className="icon-btn" onClick={onBack} aria-label="Back to chats">
            <ArrowLeft size={21} />
          </button>
        )}
        <button
          onClick={onOpenInfo}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <Avatar
            name={chat.name}
            id={chat.is_group ? chat.id : (otherMember?.id ?? chat.id)}
            imageUrl={chat.is_group ? null : otherMember?.profile_image}
            size={40}
            online={!chat.is_group && Boolean(otherMember?.is_online)}
          />
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold">{chat.name}</div>
            <div className="chat-head-sub">
              {typingNames.length > 0 ? (
                <span className="typing-live">
                  {typingNames.length === 1
                    ? `${typingNames[0]} is typing…`
                    : `${typingNames.length} people are typing…`}
                </span>
              ) : (
                subtitle
              )}
            </div>
          </div>
        </button>

        <div className="flex items-center gap-1" data-menu-root>
          {searchOpen && (
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search messages"
              aria-label="Search messages in this chat"
              className="chat-head-search"
            />
          )}
          <button
            className="icon-btn"
            onClick={() => {
              setSearchOpen((open) => !open);
              if (searchOpen) setSearch('');
            }}
            aria-label={searchOpen ? 'Close search' : 'Search in chat'}
          >
            {searchOpen ? <X size={20} /> : <Search size={20} />}
          </button>
          <button
            className="icon-btn"
            onClick={() => onNotify('Calls are out of scope for this build')}
            aria-label="Video call"
          >
            <Video size={20} />
          </button>
          {!mobile && (
            <button
              className="icon-btn"
              onClick={() => onNotify('Calls are out of scope for this build')}
              aria-label="Voice call"
            >
              <Phone size={19} />
            </button>
          )}
          <div className="relative">
            <button
              className="icon-btn"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label="Conversation menu"
            >
              <MoreVertical size={21} />
            </button>
            {menuOpen && (
              <div className="menu-pop">
                <button
                  className="menu-item"
                  onClick={() => {
                    onOpenInfo();
                    setMenuOpen(false);
                  }}
                >
                  <Info size={16} />
                  {chat.is_group ? 'Group info' : 'Contact info'}
                </button>
                <button
                  className="menu-item"
                  onClick={() => {
                    setSearchOpen(true);
                    setMenuOpen(false);
                  }}
                >
                  <Search size={16} />
                  Search
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {!isDemo && socketStatus !== 'open' && socketStatus !== 'idle' && (
        <div className={`socket-banner ${socketStatus}`} role="status">
          {socketStatus === 'connecting' && 'Connecting…'}
          {socketStatus === 'closed' && 'Reconnecting…'}
          {socketStatus === 'rejected' &&
            'Live connection refused — try signing in again.'}
        </div>
      )}

      <div className="messages" ref={listRef} onScroll={handleScroll}>
        {loadingHistory && messages.length === 0 && (
          <div className="messages-loading">
            <Loader2 size={18} className="spin" />
            Loading messages…
          </div>
        )}

        {hasMoreHistory && messages.length > 0 && (
          <button className="load-older" onClick={onLoadOlder} disabled={loadingHistory}>
            {loadingHistory ? 'Loading…' : 'Load earlier messages'}
          </button>
        )}

        {!loadingHistory && messages.length === 0 && (
          <div className="messages-empty">
            <p>No messages yet.</p>
            <span>Say hello — it will arrive instantly.</span>
          </div>
        )}

        {visible.map((message, index) => {
          const previous = visible[index - 1];
          const isOwn = message.sender_id === me.id || message.sender_id === 'demo-self';
          const sameDay = previous && dayKey(previous.created_at) === dayKey(message.created_at);
          const grouped = Boolean(previous) && previous.sender_id === message.sender_id && sameDay;

          return (
            <div key={message.id} className="contents">
              {!sameDay && (
                <div className="day-pill">{formatDayDivider(message.created_at)}</div>
              )}
              <MessageBubble
                message={message}
                isOwn={isOwn}
                showSender={chat.is_group && !grouped}
                grouped={grouped}
                onEdit={onEditMessage}
                onDelete={onDeleteMessage}
                onNotify={onNotify}
              />
            </div>
          );
        })}

        {search.trim() && visible.length === 0 && (
          <div className="messages-empty">
            <p>No matches in this conversation.</p>
          </div>
        )}
      </div>

      {typingNames.length > 0 && (
        <div className="typing-row" aria-live="polite">
          <span className="typing-dots">
            <i />
            <i />
            <i />
          </span>
          {typingNames.join(', ')} {typingNames.length === 1 ? 'is' : 'are'} typing
        </div>
      )}

      <div className="composer" data-menu-root>
        <div className="relative">
          <button
            className="icon-btn"
            onClick={() => setEmojiOpen((open) => !open)}
            aria-label="Emoji"
          >
            <Smile size={23} />
          </button>
          {emojiOpen && (
            <div
              className="menu-pop"
              style={{ top: 'auto', bottom: 48, left: 0, right: 'auto', width: 250 }}
            >
              <div className="emoji-grid">
                {EMOJI.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => {
                      setDraft((current) => current + emoji);
                      inputRef.current?.focus();
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <button
          className="icon-btn"
          onClick={() => fileRef.current?.click()}
          aria-label="Attach a photo or document"
        >
          <Paperclip size={22} />
        </button>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/zip"
          onChange={pickFile}
        />

        <input
          ref={inputRef}
          value={draft}
          onChange={handleDraftChange}
          onKeyDown={handleKeyDown}
          placeholder="Type a message"
          aria-label="Type a message"
        />

        {draft.trim() ? (
          <button className="icon-btn" onClick={submit} aria-label="Send message">
            <Send size={21} className="text-[#54656f]" />
          </button>
        ) : (
          <button
            className="icon-btn"
            onClick={() => onNotify('Voice messages are out of scope for this build')}
            aria-label="Record voice message"
          >
            <Mic size={22} />
          </button>
        )}
      </div>
    </section>
  );
}
