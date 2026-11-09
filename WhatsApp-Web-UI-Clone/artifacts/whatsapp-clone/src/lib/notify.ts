/**
 * Desktop notifications, tab-title badge, and the incoming-message chime.
 *
 * Imperative module rather than a hook: these are browser side effects with no
 * React state of their own, and keeping them here avoids threading a notifier
 * callback through the component tree.
 *
 * Everything degrades quietly. Notifications may be denied, the page may be
 * served over plain HTTP in a context that blocks them, and autoplay policy
 * can refuse audio until the user has interacted — none of that should break
 * messaging.
 */

const BASE_TITLE = 'WhatsApp Web Clone';

let audioContext: AudioContext | null = null;

// --- Permission -----------------------------------------------------------

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.permission;
}

/**
 * Ask for notification permission.
 *
 * Call this from a user gesture (signing in counts) — Chrome ignores or
 * penalises requests that arrive without one.
 */
export async function requestNotificationPermission(): Promise<void> {
  if (!notificationsSupported()) return;
  if (Notification.permission !== 'default') return;
  try {
    await Notification.requestPermission();
  } catch {
    // Older Safari uses the callback form and can throw; not worth polyfilling.
  }
}

// --- Tab title ------------------------------------------------------------

/** Mirrors WhatsApp Web: "(3) WhatsApp Web Clone" when messages are waiting. */
export function setTitleBadge(unreadTotal: number): void {
  if (typeof document === 'undefined') return;
  document.title = unreadTotal > 0 ? `(${unreadTotal}) ${BASE_TITLE}` : BASE_TITLE;
}

// --- Chime ----------------------------------------------------------------

/**
 * Two short notes, synthesised rather than loaded.
 *
 * Avoids shipping an audio asset and works offline. Autoplay policy blocks
 * this until the user has interacted with the page, which is why failures are
 * swallowed rather than surfaced.
 */
export function playChime(): void {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;

    audioContext ??= new Ctor();
    if (audioContext.state === 'suspended') void audioContext.resume();

    const now = audioContext.currentTime;
    for (const [index, frequency] of [988, 1319].entries()) {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;

      const start = now + index * 0.1;
      // Quick fade in and out; a raw start/stop on a sine clicks audibly.
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.09, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);

      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.18);
    }
  } catch {
    // No audio output, or blocked by autoplay policy.
  }
}

// --- Desktop notification -------------------------------------------------

interface MessageNotification {
  chatId: string;
  /** Chat name for a group, sender name for a direct chat. */
  title: string;
  body: string;
  /** Focuses this window and opens the chat when the notification is clicked. */
  onClick: () => void;
}

export function showMessageNotification({
  chatId,
  title,
  body,
  onClick,
}: MessageNotification): void {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;

  try {
    const notification = new Notification(title, {
      body,
      // Same tag per chat, so a burst of messages replaces rather than stacks.
      tag: `wa-clone:${chatId}`,
      renotify: true,
      icon: '/favicon.svg',
      silent: true, // playChime handles audio; this avoids a double sound.
    } as NotificationOptions);

    notification.onclick = () => {
      window.focus();
      onClick();
      notification.close();
    };

    // Some platforms leave notifications up indefinitely.
    window.setTimeout(() => notification.close(), 8000);
  } catch {
    // Constructor throws on platforms that require a service worker.
  }
}

/** One-line preview for a notification body. */
export function notificationBody(message: {
  content: string | null;
  message_type: string;
  file_name: string | null;
}): string {
  if (message.message_type === 'image') {
    return message.content || '\u{1F4F7} Photo';
  }
  if (message.message_type === 'document') {
    return message.file_name
      ? `\u{1F4C4} ${message.file_name}`
      : '\u{1F4C4} Document';
  }
  return message.content ?? '';
}
