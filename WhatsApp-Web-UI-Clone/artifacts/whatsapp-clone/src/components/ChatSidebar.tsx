import { useCallback, useMemo, useState } from 'react';
import {
  Loader2,
  LockKeyhole,
  LogOut,
  MessageSquarePlus,
  Moon,
  MoreVertical,
  Search,
  Sun,
  Users,
} from 'lucide-react';

import { Avatar } from '@/components/Avatar';
import { formatListTimestamp, previewOf } from '@/lib/format';
import { isDemoChat } from '@/lib/mockChats';
import { useDismiss } from '@/hooks/useDismiss';
import type { Chat, UserMe } from '@/lib/types';

const FILTERS = ['All', 'Unread', 'Groups', 'Demo'] as const;
type Filter = (typeof FILTERS)[number];

interface Props {
  chats: Chat[];
  me: UserMe;
  selectedId: string | null;
  loading: boolean;
  dark: boolean;
  onSelect: (chatId: string) => void;
  onNewChat: () => void;
  onNewGroup: () => void;
  onToggleDark: () => void;
  onOpenProfile: () => void;
  onLogout: () => void;
}

export function ChatSidebar({
  chats,
  me,
  selectedId,
  loading,
  dark,
  onSelect,
  onNewChat,
  onNewGroup,
  onToggleDark,
  onOpenProfile,
  onLogout,
}: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('All');
  const [menuOpen, setMenuOpen] = useState(false);
  useDismiss(menuOpen, useCallback(() => setMenuOpen(false), []));

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return chats.filter((chat) => {
      const demo = isDemoChat(chat);
      // "All" means all *real* conversations. The demo fixtures are kept, but
      // behind their own chip, so a live chat list shows only people you
      // actually have a conversation with.
      const matchesFilter =
        (filter === 'All' && !demo) ||
        (filter === 'Unread' && !demo && chat.unread_count > 0) ||
        (filter === 'Groups' && !demo && chat.is_group) ||
        (filter === 'Demo' && demo);
      if (!matchesFilter) return false;
      if (!needle) return true;
      return (
        chat.name.toLowerCase().includes(needle) ||
        previewOf(chat.last_message).toLowerCase().includes(needle)
      );
    });
  }, [chats, filter, query]);

  const liveChats = chats.filter((chat) => !isDemoChat(chat));
  // Demo fixtures carry fixture unread counts that can never be cleared,
  // so they must not feed the badge.
  const unreadTotal = liveChats.filter((chat) => chat.unread_count > 0).length;
  const liveCount = liveChats.length;

  return (
    <aside className="side">
      <div className="topbar">
        <button className="topbar-me" onClick={onOpenProfile}>
          <Avatar
            name={me.name}
            id={me.id}
            imageUrl={me.profile_image}
            size={38}
          />
          <span className="truncate text-[15px] font-semibold">{me.name}</span>
        </button>
        <div className="flex items-center gap-1" data-menu-root>
          <button className="icon-btn" onClick={onNewChat} aria-label="New chat">
            <MessageSquarePlus size={21} />
          </button>
          {/* Always visible, not tucked into the overflow menu: signing out and
              back in as someone else is the main way to try the app with two
              accounts, so it should be one click away. */}
          <button
            className="icon-btn signout-btn"
            onClick={onLogout}
            aria-label={`Sign out of ${me.name}`}
            title={`Sign out (${me.name})`}
          >
            <LogOut size={20} />
          </button>
          <div className="relative">
            <button
              className="icon-btn"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label="More options"
            >
              <MoreVertical size={21} />
            </button>
            {menuOpen && (
              <div className="menu-pop" style={{ top: 42 }}>
                <button
                  className="menu-item"
                  onClick={() => {
                    onNewGroup();
                    setMenuOpen(false);
                  }}
                >
                  <Users size={17} />
                  New group
                </button>
                <button
                  className="menu-item"
                  onClick={() => {
                    onToggleDark();
                    setMenuOpen(false);
                  }}
                >
                  {dark ? <Sun size={17} /> : <Moon size={17} />}
                  {dark ? 'Light' : 'Dark'} theme
                </button>
                <button
                  className="menu-item text-red-600"
                  onClick={() => {
                    setMenuOpen(false);
                    onLogout();
                  }}
                >
                  <LogOut size={17} />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="px-[14px] pb-2 pt-3">
        <label className="side-search">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your conversations"
            aria-label="Search conversations"
          />
        </label>
      </div>

      <div className="filter-row">
        {FILTERS.map((option) => (
          <button
            key={option}
            onClick={() => setFilter(option)}
            className={`filter-pill ${filter === option ? 'selected' : ''}`}
          >
            {option}
            {option === 'Unread' && unreadTotal > 0 && (
              <span className="ml-1 text-[11px]">{unreadTotal}</span>
            )}
          </button>
        ))}
      </div>

      <div className="chat-list">
        {loading && liveCount === 0 && (
          <div className="list-note">
            <Loader2 size={15} className="spin" />
            Loading your chats…
          </div>
        )}

        {visible.map((chat) => {
          const demo = isDemoChat(chat);
          const other = chat.members.find((member) => member.user.id !== me.id)?.user;
          return (
            <button
              key={chat.id}
              onClick={() => onSelect(chat.id)}
              className={`chat-row ${chat.id === selectedId ? 'active' : ''}`}
              aria-current={chat.id === selectedId ? 'true' : undefined}
            >
              <Avatar
                name={chat.name}
                id={chat.is_group ? chat.id : (other?.id ?? chat.id)}
                imageUrl={chat.is_group ? null : other?.profile_image}
                online={!chat.is_group && Boolean(other?.is_online)}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="name">
                    {chat.name}
                    {demo && <span className="demo-tag">demo</span>}
                  </div>
                  <span
                    className={`shrink-0 text-[11px] ${
                      chat.unread_count ? 'font-semibold text-[#18a56a]' : 'text-[#667781]'
                    }`}
                  >
                    {formatListTimestamp(chat.last_message_at ?? chat.created_at)}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <div className="row-preview">
                    {chat.is_group && chat.last_message?.sender
                      ? `${
                          chat.last_message.sender_id === me.id
                            ? 'You'
                            : chat.last_message.sender.name.split(' ')[0]
                        }: ${previewOf(chat.last_message)}`
                      : previewOf(chat.last_message)}
                  </div>
                  {chat.unread_count > 0 && (
                    <span className="unread-badge">{chat.unread_count}</span>
                  )}
                </div>
              </div>
            </button>
          );
        })}

        {!loading && visible.length === 0 && (
          <div className="px-8 py-12 text-center text-sm text-[#667781]">
            <Search size={24} className="mx-auto mb-3 opacity-50" />
            {filter === 'All' && !query.trim() ? (
              <>
                No conversations yet.
                <br />
                Use <strong>New chat</strong> to find someone.
              </>
            ) : (
              'No conversations found'
            )}
          </div>
        )}
      </div>

      <div className="side-footer">
        <LockKeyhole size={13} />
        {liveCount === 0
          ? 'Start a chat to message someone for real'
          : `${liveCount} live conversation${liveCount === 1 ? '' : 's'}`}
      </div>
    </aside>
  );
}
