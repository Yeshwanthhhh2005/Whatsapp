/**
 * Start a real conversation: search the live user directory, pick one person
 * for a direct chat or several for a group.
 */

import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Search, Users, X } from 'lucide-react';

import { api } from '@/lib/api';
import { colorFor, initialsOf } from '@/lib/format';
import type { ChatType, UserSearchResult } from '@/lib/types';

interface Props {
  mode: 'direct' | 'group';
  onClose: () => void;
  onCreate: (payload: {
    type: ChatType;
    member_ids: string[];
    name?: string;
  }) => Promise<unknown>;
}

export function NewChatDialog({ mode, onClose, onCreate }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [selected, setSelected] = useState<UserSearchResult[]>([]);
  const [groupName, setGroupName] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isGroup = mode === 'group';
  const trimmed = query.trim();

  // Debounced so typing does not fire a request per keystroke. The backend
  // requires at least 2 characters.
  useEffect(() => {
    if (trimmed.length < 2) {
      setResults([]);
      setSearching(false);
      return undefined;
    }

    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const found = await api.searchUsers(trimmed);
        if (!cancelled) {
          setResults(found);
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Search failed.');
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [trimmed]);

  const selectedIds = useMemo(
    () => new Set(selected.map((user) => user.id)),
    [selected],
  );

  function toggle(user: UserSearchResult) {
    if (isGroup) {
      setSelected((current) =>
        current.some((candidate) => candidate.id === user.id)
          ? current.filter((candidate) => candidate.id !== user.id)
          : [...current, user],
      );
    } else {
      setSelected([user]);
    }
  }

  const canSubmit = isGroup
    ? selected.length >= 1 && groupName.trim().length > 0
    : selected.length === 1;

  async function submit() {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await onCreate({
        type: isGroup ? 'group' : 'direct',
        member_ids: selected.map((user) => user.id),
        ...(isGroup ? { name: groupName.trim() } : {}),
      });
      if (created) onClose();
      else setError('Could not create the chat.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={isGroup ? 'New group' : 'New chat'}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {isGroup ? 'New group' : 'New chat'}
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={19} />
          </button>
        </div>

        {isGroup && (
          <label className="dialog-field">
            <span>Group name</span>
            <input
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
              placeholder="Studio people"
              maxLength={120}
            />
          </label>
        )}

        <p className="dialog-hint">
          Search by name, or paste someone&rsquo;s full email address. Both
          people need an account on this server.
        </p>

        <label className="dialog-search">
          <Search size={16} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search people"
            aria-label="Search people"
          />
          {searching && <Loader2 size={15} className="spin" />}
        </label>

        {selected.length > 0 && (
          <div className="dialog-chips">
            {selected.map((user) => (
              <button
                key={user.id}
                onClick={() => toggle(user)}
                className="dialog-chip"
                aria-label={`Remove ${user.name}`}
              >
                {user.name}
                <X size={13} />
              </button>
            ))}
          </div>
        )}

        <div className="dialog-results">
          {results.map((user) => (
            <button
              key={user.id}
              onClick={() => toggle(user)}
              className="dialog-result"
              aria-pressed={selectedIds.has(user.id)}
            >
              <span
                className="avatar"
                style={{ background: colorFor(user.id), width: 36, height: 36 }}
              >
                {initialsOf(user.name)}
              </span>
              <span className="dialog-result-copy">
                <strong>{user.name}</strong>
                {/* The email disambiguates two people with the same name --
                    picking the wrong one looks like chatting with yourself. */}
                <small>{user.email}</small>
              </span>
              {selectedIds.has(user.id) && (
                <Check size={17} className="text-[#00a884]" />
              )}
            </button>
          ))}

          {!searching && trimmed.length >= 2 && results.length === 0 && (
            <div className="dialog-empty">
              No one found. They may need to register first.
            </div>
          )}
          {trimmed.length > 0 && trimmed.length < 2 && (
            <div className="dialog-empty">Type at least two characters.</div>
          )}
        </div>

        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}

        <div className="dialog-actions">
          <button onClick={onClose} className="dialog-cancel">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit || busy}
            className="dialog-confirm"
          >
            {busy ? <Loader2 size={15} className="spin" /> : <Users size={15} />}
            {isGroup ? 'Create group' : 'Start chat'}
          </button>
        </div>
      </div>
    </div>
  );
}
