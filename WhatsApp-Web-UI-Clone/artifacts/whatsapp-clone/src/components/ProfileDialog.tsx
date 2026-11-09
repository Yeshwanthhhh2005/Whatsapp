import { useState } from 'react';
import { Loader2, LogOut, X } from 'lucide-react';

import { Avatar } from '@/components/Avatar';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';

export function ProfileDialog({ onClose }: { onClose: () => void }) {
  const { user, updateUser, logout } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [about, setAbout] = useState(user?.about ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      updateUser(
        await api.updateMe({ name: name.trim(), about: about.trim() || null }),
      );
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save.');
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
        aria-label="Your profile"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Your profile</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={19} />
          </button>
        </div>

        <div className="profile-hero">
          <Avatar name={user.name} id={user.id} imageUrl={user.profile_image} size={76} />
          <div>
            <strong>{user.email}</strong>
            <small>Signed in</small>
          </div>
        </div>

        <label className="dialog-field">
          <span>Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
          />
        </label>

        <label className="dialog-field">
          <span>About</span>
          <input
            value={about}
            onChange={(event) => setAbout(event.target.value)}
            maxLength={160}
            placeholder="Available for a little bit of everything."
          />
        </label>

        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}

        <div className="dialog-actions">
          <button
            onClick={() => {
              onClose();
              logout();
            }}
            className="profile-signout"
          >
            <LogOut size={16} />
            Sign out
          </button>
          <button onClick={onClose} className="dialog-cancel">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy || !name.trim()}
            className="dialog-confirm"
          >
            {busy && <Loader2 size={15} className="spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
