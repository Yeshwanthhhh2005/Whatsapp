/**
 * Mirrors the FastAPI response schemas in backend/app/schemas/.
 *
 * Hand-written rather than generated: the workspace already has an Orval
 * pipeline (lib/api-spec), but pointing it at the Python backend is a separate
 * job. If these drift, the backend's /openapi.json is the source of truth.
 */

export type MessageType = 'text' | 'image' | 'document';
export type MessageStatus = 'sent' | 'delivered' | 'read';
export type ChatType = 'direct' | 'group';

export interface UserPublic {
  id: string;
  name: string;
  profile_image: string | null;
  about: string | null;
  is_online: boolean;
  last_seen: string | null;
}

export interface UserMe extends UserPublic {
  email: string;
  created_at: string;
}

/**
 * A directory hit. Carries the email because two people can register the same
 * display name, and it is the only way to tell them apart when choosing who to
 * message. Chat members and message senders use plain UserPublic.
 */
export interface UserSearchResult extends UserPublic {
  email: string;
}

export interface Message {
  id: string;
  chat_id: string;
  sender_id: string;
  sender: UserPublic | null;
  content: string | null;
  message_type: MessageType;
  file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  status: MessageStatus;
  is_read: boolean;
  is_deleted: boolean;
  created_at: string;
  edited_at: string | null;
  client_id?: string | null;
}

export interface ChatMember {
  user: UserPublic;
  is_admin: boolean;
  joined_at: string;
}

export interface Chat {
  id: string;
  type: ChatType;
  is_group: boolean;
  name: string;
  members: ChatMember[];
  last_message: Message | null;
  last_message_at: string | null;
  unread_count: number;
  created_at: string;
}

export interface MessagePage {
  items: Message[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface UploadResult {
  url: string;
  file_name: string;
  content_type: string;
  file_size: number;
  message_type: MessageType;
}

export interface AuthResult {
  access_token: string;
  token_type: string;
  user: UserMe;
}

/** A message optimistically rendered before the server has confirmed it. */
export interface PendingMessage extends Message {
  pending: true;
  failed?: boolean;
}

export type AnyMessage = Message | PendingMessage;

export function isPending(message: AnyMessage): message is PendingMessage {
  return (message as PendingMessage).pending === true;
}

// --- WebSocket frames -----------------------------------------------------

export type ServerEvent =
  | { event: 'connected'; data: { user_id: string; chat_id: string } }
  | { event: 'message'; data: { chat_id: string; message: Message } }
  | { event: 'message_updated'; data: { chat_id: string; message: Message } }
  | { event: 'message_deleted'; data: { chat_id: string; message_id: string } }
  | {
      event: 'typing';
      data: { chat_id: string; user_id: string; name: string; is_typing: boolean };
    }
  | {
      event: 'message_read';
      data: {
        chat_id: string;
        reader_id: string;
        message_ids: string[];
        read_at: string;
      };
    }
  | {
      event: 'presence';
      data: { user_id: string; is_online: boolean; last_seen: string | null };
    }
  | { event: 'pong'; data: Record<string, never> }
  | { event: 'error'; data: { detail: string } };

export type ClientEvent =
  | {
      event: 'message';
      data: {
        content?: string | null;
        message_type?: MessageType;
        file_url?: string | null;
        file_name?: string | null;
        file_size?: number | null;
        client_id?: string;
      };
    }
  | { event: 'typing_start'; data: Record<string, never> }
  | { event: 'typing_stop'; data: Record<string, never> }
  | { event: 'message_read'; data: { up_to_message_id?: string } }
  | { event: 'ping'; data: Record<string, never> };
