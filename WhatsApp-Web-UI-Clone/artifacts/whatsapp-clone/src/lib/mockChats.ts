/**
 * The original local demo conversations, kept alongside the live ones.
 *
 * These are shaped exactly like the API's `Chat` / `Message` types so the UI
 * renders both through one code path. They carry `demo: true`, which is what
 * tells the app to keep them local: no requests, no socket, no persistence.
 * Anything you type in a demo chat lives in React state until reload.
 *
 * Real conversations created through "New chat" are backed by the API and
 * appear above these.
 */

import type { Chat, Message, UserPublic } from './types';
import { colorFor, initialsOf } from './format';

export interface DemoChat extends Chat {
  demo: true;
  /** The full seeded history, loaded into state the first time it is opened. */
  messages: DemoMessage[];
}

export interface DemoMessage extends Message {
  demo: true;
}

/** Marks a demo message as sent by whoever is signed in. */
export const DEMO_SELF_ID = 'demo-self';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function demoUser(name: string, online = false): UserPublic {
  return {
    id: `demo-user-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name,
    profile_image: null,
    about: null,
    is_online: online,
    last_seen: new Date(Date.now() - 3 * HOUR).toISOString(),
  };
}

type Line = [
  text: string,
  minutesAgo: number,
  from: 'in' | 'out',
  kind?: 'image' | 'document',
];

interface Spec {
  name: string;
  group?: boolean;
  online?: boolean;
  unread?: number;
  lines: Line[];
}

const SPECS: Spec[] = [
  {
    name: 'Maya Chen',
    online: true,
    unread: 2,
    lines: [
      ['Hey! Are we still on for Saturday?', 1500, 'in'],
      ['Absolutely. I found a place near the canal that looks lovely.', 1480, 'out'],
      ['Send me the name?', 1470, 'in'],
      ['Little Fern Books — sending you the pin now \u{1F4CD}', 1465, 'out'],
      ['That little bookshop was perfect ✨', 35, 'in'],
    ],
  },
  {
    name: 'Studio people',
    group: true,
    unread: 5,
    lines: [
      ['Morning team — quick check-in before the review?', 1600, 'in'],
      ['I have the updated type studies ready', 1580, 'out'],
      ['Sharing the final boards now', 60, 'in', 'image'],
    ],
  },
  {
    name: 'Theo Martin',
    online: true,
    lines: [
      ['Did you get home okay?', 1700, 'in'],
      ['Yep, made it just before the rain!', 1690, 'out'],
      ['That was a close one haha', 1685, 'in'],
      ['Voice note · 0:18', 95, 'in'],
    ],
  },
  {
    name: 'Sunday table',
    group: true,
    lines: [
      ['Sunday lunch at ours, 1pm?', 1800, 'in'],
      ['Count us in!', 1790, 'out'],
      ['I’ll bring the focaccia \u{1F956}', 120, 'out'],
    ],
  },
  {
    name: 'Amara Okafor',
    online: true,
    unread: 1,
    lines: [
      ['You have to see the light in this room at 5pm', 1500, 'in', 'image'],
      ['Oh wow, it’s golden hour in there', 1490, 'out'],
      ['Another one from today', 160, 'in', 'image'],
    ],
  },
  {
    name: 'Dad',
    lines: [
      ['Can you send me that lentil recipe?', 4000, 'in'],
      ['Of course — the one with preserved lemon?', 3990, 'out'],
      ['Yes, that one. Your mum loved it.', 3980, 'in'],
      ['Thanks for the recipe!', 1450, 'in'],
    ],
  },
  {
    name: 'Design book club',
    group: true,
    unread: 3,
    lines: [
      ['Next meetup is Thursday at 7 \u{1F4DA}', 4100, 'in'],
      ['I’ll bring snacks', 4090, 'out'],
      ['Chapter 4 is my favourite so far', 1500, 'in'],
    ],
  },
  {
    name: 'Jules Rivera',
    lines: [
      ['I started a little itinerary for Lisbon', 5500, 'in'],
      ['You’re the best. I’ll add a few spots too', 5490, 'out'],
      ['trip-notes.pdf', 1520, 'in', 'document'],
    ],
  },
  {
    name: 'Nina Patel',
    online: true,
    lines: [
      ['How was the opening?', 4200, 'out'],
      ['A bit chaotic, but in a good way. I think you’d love the gallery.', 4190, 'in'],
      ['This made me think of you', 2900, 'in', 'image'],
    ],
  },
  {
    name: 'Flat 4B',
    group: true,
    lines: [
      ['Anyone seen a small parcel?', 2950, 'in'],
      ['It’s by the door, I brought it in', 2940, 'out'],
      ['Thank you!', 2930, 'in'],
    ],
  },
  {
    name: 'Eli Brooks',
    lines: [
      ['Coffee at the usual place?', 4300, 'in'],
      ['See you there!', 4290, 'out'],
    ],
  },
  {
    name: 'Mum \u{1F33B}',
    lines: [
      ['I planted the tulips you gave me', 4400, 'in'],
      ['Love you lots ❤️', 4390, 'out'],
    ],
  },
  {
    name: 'Weekend wanderers',
    group: true,
    lines: [
      ['Trail map is in the group info', 5800, 'in'],
      ['Weather looks promising for Sunday', 5790, 'in'],
    ],
  },
  {
    name: 'Rafi Hassan',
    lines: [
      ['That playlist is all over the place', 5900, 'out'],
      ['Haha exactly', 5890, 'in'],
    ],
  },
  {
    name: 'Lena Fischer',
    lines: [
      ['Dinner was wonderful', 7300, 'in'],
      ['So glad you came!', 7290, 'out'],
      ['Thank you for having us!', 7280, 'in'],
    ],
  },
  {
    name: 'Garden notes',
    group: true,
    lines: [
      ['The seedlings are up!', 8700, 'in'],
      ['Already? That’s brilliant', 8690, 'out'],
    ],
  },
  {
    name: 'Owen Price',
    lines: [
      ['Good chat earlier — sending notes', 10_100, 'in'],
      ['notes-from-call.pdf', 10_090, 'in', 'document'],
    ],
  },
  {
    name: 'Mina Laurent',
    lines: [
      ['\u{1F33F}', 11_500, 'in'],
      ['This is the energy I need', 11_490, 'out'],
    ],
  },
];

/**
 * Build the demo chats. Takes the signed-in user so their own bubbles are
 * attributed correctly and the avatar colours match the rest of the UI.
 */
export function createDemoChats(self: UserPublic): DemoChat[] {
  const now = Date.now();

  return SPECS.map((spec, chatIndex) => {
    const chatId = `demo-chat-${chatIndex + 1}`;
    const other = demoUser(spec.name, spec.online);

    const messages: DemoMessage[] = spec.lines.map((line, lineIndex) => {
      const [text, minutesAgo, from, kind] = line;
      const isOwn = from === 'out';
      const type = kind ?? 'text';
      return {
        demo: true,
        id: `${chatId}-m${lineIndex + 1}`,
        chat_id: chatId,
        sender_id: isOwn ? DEMO_SELF_ID : other.id,
        sender: isOwn ? self : other,
        content: type === 'document' ? null : text,
        message_type: type,
        file_url: type === 'text' ? null : `demo://${chatId}/${lineIndex}`,
        file_name: type === 'document' ? text : null,
        file_size: type === 'document' ? 248 * 1024 : null,
        // Demo chats show read ticks; nothing here round-trips a server.
        status: isOwn ? 'read' : 'sent',
        is_read: isOwn,
        is_deleted: false,
        created_at: new Date(now - minutesAgo * MINUTE).toISOString(),
        edited_at: null,
      };
    });

    const last = messages[messages.length - 1] ?? null;

    return {
      demo: true,
      messages,
      id: chatId,
      type: spec.group ? 'group' : 'direct',
      is_group: Boolean(spec.group),
      name: spec.name,
      members: spec.group
        ? [
            { user: self, is_admin: false, joined_at: new Date(now - 30 * DAY).toISOString() },
            { user: other, is_admin: true, joined_at: new Date(now - 30 * DAY).toISOString() },
            {
              user: demoUser('Nico Alvarez'),
              is_admin: false,
              joined_at: new Date(now - 30 * DAY).toISOString(),
            },
          ]
        : [
            { user: self, is_admin: false, joined_at: new Date(now - 30 * DAY).toISOString() },
            { user: other, is_admin: false, joined_at: new Date(now - 30 * DAY).toISOString() },
          ],
      last_message: last,
      last_message_at: last?.created_at ?? null,
      unread_count: spec.unread ?? 0,
      created_at: new Date(now - 40 * DAY).toISOString(),
    };
  });
}

export function isDemoChat(chat: Chat): chat is DemoChat {
  return (chat as DemoChat).demo === true;
}

export function demoAvatar(user: UserPublic) {
  return { initials: initialsOf(user.name), color: colorFor(user.id) };
}
