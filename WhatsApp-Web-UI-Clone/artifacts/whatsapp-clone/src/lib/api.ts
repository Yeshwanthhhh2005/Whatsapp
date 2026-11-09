/**
 * Typed client for the FastAPI backend, plus token storage.
 *
 * Requests go to relative paths by default and the Vite dev server proxies
 * /api, /ws and /uploads to the backend (see vite.config.ts), so there is no
 * CORS preflight in development and WebSocket URLs are same-origin. Set
 * VITE_API_URL to talk to a backend on another origin instead.
 */

import type {
  AuthResult,
  Chat,
  ChatType,
  Message,
  MessagePage,
  MessageType,
  UploadResult,
  UserMe,
  UserSearchResult,
} from './types';

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

const TOKEN_KEY = 'wa-clone.token';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// --- Token storage --------------------------------------------------------
//
// sessionStorage, NOT localStorage. localStorage is shared by every tab and
// window of a browser profile, so signing in as a second account in a second
// window silently replaced the first -- both windows ended up as the same
// person. sessionStorage is scoped to a single tab, so each tab holds its own
// session and two accounts can be signed in side by side in one browser.
//
// The cost is that closing the tab ends the session. A refresh keeps it,
// because sessionStorage survives reloads within the same tab.
//
// Neither is the right answer for production -- any script on the origin can
// read both, so an httpOnly cookie belongs there. The brief specified
// bearer-token auth, and swapping the mechanism means changing only these two
// functions.

function tokenStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    // Private browsing or blocked site data.
    return null;
  }
}

export function getToken(): string | null {
  try {
    return tokenStore()?.getItem(TOKEN_KEY) ?? null;
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    const store = tokenStore();
    if (!store) return;
    if (token) store.setItem(TOKEN_KEY, token);
    else store.removeItem(TOKEN_KEY);
    // Clear any token left behind by the previous localStorage-based build,
    // or it would be picked up again by older code paths.
    window.localStorage?.removeItem(TOKEN_KEY);
  } catch {
    // Session simply will not persist.
  }
}

/** Called when any request comes back 401, so the app can drop to the login screen. */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

// --- Core request ---------------------------------------------------------

async function request<T>(
  path: string,
  init: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const { auth = true, headers, ...rest } = init;
  const merged = new Headers(headers);

  if (auth) {
    const token = getToken();
    if (token) merged.set('Authorization', `Bearer ${token}`);
  }
  if (rest.body !== undefined && !(rest.body instanceof FormData)) {
    merged.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_BASE}${path}`, { ...rest, headers: merged });

  if (response.status === 401 && auth) {
    setToken(null);
    onUnauthorized?.();
  }

  if (!response.ok) {
    throw new ApiError(response.status, await readErrorDetail(response));
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** FastAPI returns `detail` as a string, or as a list for validation errors. */
async function readErrorDetail(response: Response): Promise<string> {
  try {
    const body = await response.json();
    const detail = body?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0];
      const field = Array.isArray(first?.loc) ? first.loc.at(-1) : null;
      const msg = first?.msg ?? 'Invalid input';
      return field ? `${field}: ${msg}` : String(msg);
    }
  } catch {
    // Fall through to a generic message.
  }
  return `Request failed (${response.status})`;
}

// --- Auth -----------------------------------------------------------------

export const api = {
  register(name: string, email: string, password: string): Promise<AuthResult> {
    return request<AuthResult>('/api/auth/register', {
      method: 'POST',
      auth: false,
      body: JSON.stringify({ name, email, password }),
    });
  },

  login(email: string, password: string): Promise<AuthResult> {
    return request<AuthResult>('/api/auth/login', {
      method: 'POST',
      auth: false,
      body: JSON.stringify({ email, password }),
    });
  },

  me(): Promise<UserMe> {
    return request<UserMe>('/api/auth/me');
  },

  updateMe(patch: {
    name?: string;
    about?: string | null;
    profile_image?: string | null;
  }): Promise<UserMe> {
    return request<UserMe>('/api/users/me', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  searchUsers(query: string): Promise<UserSearchResult[]> {
    return request<UserSearchResult[]>(
      `/api/users/search?q=${encodeURIComponent(query)}`,
    );
  },

  // --- Chats --------------------------------------------------------------

  listChats(): Promise<Chat[]> {
    return request<Chat[]>('/api/chats');
  },

  getChat(chatId: string): Promise<Chat> {
    return request<Chat>(`/api/chats/${chatId}`);
  },

  createChat(payload: {
    type: ChatType;
    member_ids: string[];
    name?: string;
  }): Promise<Chat> {
    return request<Chat>('/api/chats', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // --- Messages -----------------------------------------------------------

  listMessages(
    chatId: string,
    options: { limit?: number; before?: string } = {},
  ): Promise<MessagePage> {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', String(options.limit));
    if (options.before) params.set('before', options.before);
    const query = params.toString();
    return request<MessagePage>(
      `/api/chats/${chatId}/messages${query ? `?${query}` : ''}`,
    );
  },

  sendMessage(
    chatId: string,
    payload: {
      content?: string | null;
      message_type?: MessageType;
      file_url?: string | null;
      file_name?: string | null;
      file_size?: number | null;
      client_id?: string;
    },
  ): Promise<Message> {
    return request<Message>(`/api/chats/${chatId}/messages`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  editMessage(messageId: string, content: string): Promise<Message> {
    return request<Message>(`/api/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    });
  },

  deleteMessage(messageId: string): Promise<Message> {
    return request<Message>(`/api/messages/${messageId}`, { method: 'DELETE' });
  },

  markRead(chatId: string, upToMessageId?: string) {
    return request<{
      chat_id: string;
      read_at: string;
      message_ids: string[];
    }>(`/api/chats/${chatId}/read`, {
      method: 'POST',
      body: JSON.stringify(
        upToMessageId ? { up_to_message_id: upToMessageId } : {},
      ),
    });
  },

  // --- Upload -------------------------------------------------------------

  upload(file: File): Promise<UploadResult> {
    const form = new FormData();
    form.append('file', file);
    return request<UploadResult>('/api/upload', { method: 'POST', body: form });
  },
};

/** Absolute ws:// URL for a chat socket, carrying the token as a query param. */
export function chatSocketUrl(chatId: string, token: string): string {
  const base = API_BASE || window.location.origin;
  const url = new URL(`${base}/ws/${chatId}`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('token', token);
  return url.toString();
}
