/**
 * One WebSocket per open chat, with reconnect.
 *
 * The backend route is /ws/{chat_id}, but it fans messages out to every socket
 * belonging to every member of a chat -- not just sockets opened against that
 * chat. So this single connection also carries events for the user's *other*
 * conversations, which is what keeps unread badges in the sidebar live.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { chatSocketUrl } from '@/lib/api';
import type { ClientEvent, ServerEvent } from '@/lib/types';

/** Close codes the server uses to reject a handshake; retrying cannot help. */
const FATAL_CLOSE_CODES = new Set([4401, 4403, 4400]);

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 10_000;
const HEARTBEAT_MS = 25_000;

/**
 * Give up after this many attempts that never reached `open`.
 *
 * A handshake the server refuses outright surfaces in the browser as a plain
 * 1006 close with no code, which is indistinguishable from a network blip. The
 * backend closes with 4401/4403 after accepting so the real reason does come
 * through, but a proxy or an older build can still swallow it -- without a cap
 * that case retries forever against a token that will never work.
 */
const MAX_FAILED_HANDSHAKES = 5;

export type SocketStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'rejected';

interface Options {
  chatId: string | null;
  token: string | null;
  onEvent: (event: ServerEvent) => void;
}

export function useChatSocket({ chatId, token, onEvent }: Options) {
  const [status, setStatus] = useState<SocketStatus>('idle');
  const socketRef = useRef<WebSocket | null>(null);
  const attemptsRef = useRef(0);
  // Distinguishes "handshake never succeeded" from "connection dropped".
  const everOpenedRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);

  // Kept in a ref so a new handler identity does not tear down the socket.
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const send = useCallback((event: ClientEvent): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(event));
    return true;
  }, []);

  useEffect(() => {
    if (!chatId || !token) {
      setStatus('idle');
      return undefined;
    }

    let disposed = false;
    attemptsRef.current = 0;
    everOpenedRef.current = false;

    const clearTimers = () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (heartbeatTimerRef.current !== null) {
        window.clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }
    };

    const connect = () => {
      if (disposed) return;
      setStatus('connecting');

      const socket = new WebSocket(chatSocketUrl(chatId, token));
      socketRef.current = socket;

      socket.onopen = () => {
        if (disposed) return;
        attemptsRef.current = 0;
        everOpenedRef.current = true;
        setStatus('open');
        // Keeps idle proxies from dropping the connection.
        heartbeatTimerRef.current = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ event: 'ping', data: {} }));
          }
        }, HEARTBEAT_MS);
      };

      socket.onmessage = (raw) => {
        if (disposed) return;
        let frame: ServerEvent;
        try {
          frame = JSON.parse(raw.data as string) as ServerEvent;
        } catch {
          return;
        }
        if (frame.event === 'pong') return;
        onEventRef.current(frame);
      };

      socket.onerror = () => {
        // onclose always follows, so reconnect is handled there.
      };

      socket.onclose = (closeEvent) => {
        if (heartbeatTimerRef.current !== null) {
          window.clearInterval(heartbeatTimerRef.current);
          heartbeatTimerRef.current = null;
        }
        if (disposed) return;

        if (FATAL_CLOSE_CODES.has(closeEvent.code)) {
          // Bad or expired token, or not a member: reconnecting would just
          // be rejected again.
          setStatus('rejected');
          return;
        }

        attemptsRef.current += 1;

        // Never opened, and we have tried enough times: treat it as a refusal
        // rather than retrying forever against an un-coded rejection.
        if (
          !everOpenedRef.current &&
          attemptsRef.current >= MAX_FAILED_HANDSHAKES
        ) {
          setStatus('rejected');
          return;
        }

        setStatus('closed');
        const delay = Math.min(
          RECONNECT_BASE_MS * 2 ** (attemptsRef.current - 1),
          RECONNECT_MAX_MS,
        );
        reconnectTimerRef.current = window.setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      disposed = true;
      clearTimers();
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) {
        // Drop handlers before closing so the teardown does not trigger a
        // reconnect for a chat the user has already navigated away from.
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        if (
          socket.readyState === WebSocket.OPEN ||
          socket.readyState === WebSocket.CONNECTING
        ) {
          socket.close(1000, 'Switching chat');
        }
      }
      setStatus('idle');
    };
  }, [chatId, token]);

  return { status, send };
}
