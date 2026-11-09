import { useCallback, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock3,
  Copy,
  FileText,
  Pencil,
  Trash2,
} from 'lucide-react';

import { formatFileSize, formatTime } from '@/lib/format';
import type { AnyMessage } from '@/lib/types';
import { isPending } from '@/lib/types';
import { useDismiss } from '@/hooks/useDismiss';

interface Props {
  message: AnyMessage;
  isOwn: boolean;
  /** Group chats label each incoming bubble with its sender. */
  showSender: boolean;
  /** True when the previous bubble came from the same person. */
  grouped: boolean;
  onEdit: (messageId: string, content: string) => void;
  onDelete: (messageId: string) => void;
  onNotify: (text: string) => void;
}

/**
 * Check marks: one tick for stored, two grey for delivered, two blue for read.
 * A clock means it has not reached the server yet.
 */
function StatusTicks({ message }: { message: AnyMessage }) {
  if (isPending(message)) {
    return message.failed ? (
      <AlertCircle size={13} className="text-red-500" aria-label="Failed to send" />
    ) : (
      <Clock3 size={12} aria-label="Sending" />
    );
  }
  if (message.status === 'read') {
    return <CheckCheck size={15} className="text-[#53bdeb]" aria-label="Read" />;
  }
  if (message.status === 'delivered') {
    return <CheckCheck size={15} aria-label="Delivered" />;
  }
  return <Check size={14} aria-label="Sent" />;
}

export function MessageBubble({
  message,
  isOwn,
  showSender,
  grouped,
  onEdit,
  onDelete,
  onNotify,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  useDismiss(menuOpen, useCallback(() => setMenuOpen(false), []));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content ?? '');

  const pending = isPending(message);
  const isImage = message.message_type === 'image' && message.file_url;
  const isDocument = message.message_type === 'document' && message.file_url;
  // Demo attachments have no real bytes behind them.
  const isPlaceholderFile = message.file_url?.startsWith('demo://') ?? false;

  function commitEdit() {
    const next = draft.trim();
    if (next && next !== message.content) onEdit(message.id, next);
    setEditing(false);
  }

  if (message.is_deleted) {
    return (
      <div className={`bubble ${isOwn ? 'out' : 'in'} ${grouped ? 'bubble-grouped' : ''}`}>
        <span className="bubble-deleted">
          <Trash2 size={13} />
          This message was deleted
        </span>
        <span className="bubble-time">{formatTime(message.created_at)}</span>
      </div>
    );
  }

  return (
    <div
      className={`bubble ${isOwn ? 'out' : 'in'} ${grouped ? 'bubble-grouped' : ''} ${
        pending && message.failed ? 'bubble-failed' : ''
      }`}
      data-menu-root
      onContextMenu={(event) => {
        if (pending) return;
        event.preventDefault();
        setMenuOpen(true);
      }}
    >
      {showSender && !isOwn && (
        <div className="bubble-sender">{message.sender?.name ?? 'Unknown'}</div>
      )}

      {isImage && (
        <a
          href={isPlaceholderFile ? undefined : message.file_url!}
          target="_blank"
          rel="noreferrer"
          className="bubble-image"
          onClick={(event) => {
            if (isPlaceholderFile) {
              event.preventDefault();
              onNotify('This demo photo has no file behind it');
            }
          }}
        >
          {isPlaceholderFile ? (
            <span className="bubble-image-placeholder">Photo</span>
          ) : (
            <img src={message.file_url!} alt={message.content ?? 'Shared photo'} />
          )}
        </a>
      )}

      {isDocument && (
        <a
          href={isPlaceholderFile ? undefined : message.file_url!}
          target="_blank"
          rel="noreferrer"
          download={message.file_name ?? undefined}
          className="bubble-doc"
          onClick={(event) => {
            if (isPlaceholderFile) {
              event.preventDefault();
              onNotify('This demo document has no file behind it');
            }
          }}
        >
          <span className="bubble-doc-icon">
            <FileText size={20} />
          </span>
          <span>
            <strong>{message.file_name ?? 'Document'}</strong>
            <small>{formatFileSize(message.file_size) || 'Document'}</small>
          </span>
        </a>
      )}

      {editing ? (
        <div className="bubble-edit">
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitEdit();
              if (event.key === 'Escape') setEditing(false);
            }}
            aria-label="Edit message"
          />
          <button onClick={commitEdit}>Save</button>
        </div>
      ) : (
        message.content && <span className="bubble-text">{message.content}</span>
      )}

      <span className="bubble-time">
        {message.edited_at && <em>edited</em>}
        {formatTime(message.created_at)}
        {isOwn && <StatusTicks message={message} />}
      </span>

      {menuOpen && (
        <div
          className="menu-pop"
          data-menu-root
          onClick={(event) => event.stopPropagation()}
        >
          {message.content && (
            <button
              className="menu-item"
              onClick={() => {
                void navigator.clipboard?.writeText(message.content!);
                onNotify('Message copied');
                setMenuOpen(false);
              }}
            >
              <Copy size={16} />
              Copy
            </button>
          )}
          {isOwn && message.message_type === 'text' && (
            <button
              className="menu-item"
              onClick={() => {
                setDraft(message.content ?? '');
                setEditing(true);
                setMenuOpen(false);
              }}
            >
              <Pencil size={16} />
              Edit
            </button>
          )}
          {isOwn && (
            <button
              className="menu-item text-red-600"
              onClick={() => {
                onDelete(message.id);
                setMenuOpen(false);
              }}
            >
              <Trash2 size={16} />
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
