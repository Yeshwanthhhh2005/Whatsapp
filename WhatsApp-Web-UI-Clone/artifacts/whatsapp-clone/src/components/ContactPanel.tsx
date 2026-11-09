import { useMemo } from 'react';
import { Image as ImageIcon, LockKeyhole, Users, X } from 'lucide-react';

import { Avatar } from '@/components/Avatar';
import { formatFileSize, formatPresence } from '@/lib/format';
import { isDemoChat } from '@/lib/mockChats';
import type { AnyMessage, Chat, UserMe } from '@/lib/types';

interface Props {
  chat: Chat;
  me: UserMe;
  messages: AnyMessage[];
  onClose: () => void;
}

export function ContactPanel({ chat, me, messages, onClose }: Props) {
  const other = chat.members.find((member) => member.user.id !== me.id)?.user ?? null;

  const attachments = useMemo(
    () =>
      messages.filter(
        (message) => !message.is_deleted && message.file_url && !message.file_url.startsWith('demo://'),
      ),
    [messages],
  );

  return (
    <aside className="side-panel">
      <div className="panel-title">
        <button className="icon-btn" onClick={onClose} aria-label="Close info">
          <X size={20} />
        </button>
        <span>{chat.is_group ? 'Group info' : 'Contact info'}</span>
      </div>

      <div className="panel-hero">
        <Avatar
          name={chat.name}
          id={chat.is_group ? chat.id : (other?.id ?? chat.id)}
          imageUrl={chat.is_group ? null : other?.profile_image}
          size={88}
        />
        <div className="panel-hero-name">{chat.name}</div>
        <div className="panel-hero-sub">
          {chat.is_group
            ? `Group · ${chat.members.length} participants`
            : other
              ? formatPresence(other.is_online, other.last_seen)
              : ''}
        </div>
        {isDemoChat(chat) && (
          <div className="panel-demo-note">
            A local demo conversation. Nothing here is stored on the server.
          </div>
        )}
      </div>

      {!chat.is_group && other?.about && (
        <div className="panel-section">
          <div className="text-[14px] leading-6">{other.about}</div>
          <div className="mt-2 text-[11px] text-[#667781]">ABOUT</div>
        </div>
      )}

      <div className="panel-section">
        <div className="panel-section-head">
          <Users size={16} />
          {chat.members.length} {chat.members.length === 1 ? 'member' : 'members'}
        </div>
        <ul className="panel-members">
          {chat.members.map((member) => (
            <li key={member.user.id}>
              <Avatar
                name={member.user.name}
                id={member.user.id}
                imageUrl={member.user.profile_image}
                size={34}
                online={member.user.is_online}
              />
              <span>
                <strong>
                  {member.user.id === me.id ? 'You' : member.user.name}
                </strong>
                <small>
                  {member.is_admin
                    ? 'Admin'
                    : member.user.is_online
                      ? 'online'
                      : 'offline'}
                </small>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="panel-section">
        <div className="panel-section-head">
          <ImageIcon size={16} />
          Shared files
          <span className="ml-auto text-xs text-[#667781]">
            {attachments.length}
          </span>
        </div>
        {attachments.length === 0 ? (
          <p className="panel-empty">Nothing shared yet.</p>
        ) : (
          <ul className="panel-files">
            {attachments.map((message) => (
              <li key={message.id}>
                <a href={message.file_url!} target="_blank" rel="noreferrer">
                  {message.message_type === 'image' ? (
                    <img src={message.file_url!} alt="" />
                  ) : (
                    <span className="panel-file-doc">
                      {message.file_name ?? 'Document'}
                    </span>
                  )}
                </a>
                <small>{formatFileSize(message.file_size)}</small>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="panel-section">
        <div className="flex items-start gap-3">
          <LockKeyhole size={18} className="mt-0.5 text-[#667781]" />
          <div className="text-sm">
            Transport security
            <div className="mt-1 text-xs leading-5 text-[#667781]">
              Messages travel over HTTPS/WSS in production and are stored in
              PostgreSQL. There is no end-to-end encryption in this build.
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
