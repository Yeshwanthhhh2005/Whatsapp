import { useEffect, useState } from 'react';
import {
  CircleDashed,
  Loader2,
  LockKeyhole,
  MessageCircle,
  MessageSquarePlus,
  PhoneCall,
  Radio,
  Settings,
  Users,
} from 'lucide-react';

import { AuthScreen } from '@/components/AuthScreen';
import { Avatar } from '@/components/Avatar';
import { ChatPane } from '@/components/ChatPane';
import { ChatSidebar } from '@/components/ChatSidebar';
import { ContactPanel } from '@/components/ContactPanel';
import {
  LocalSectionSidebar,
  LocalSectionWorkspace,
  type SectionName,
} from '@/components/LocalSections';
import { NewChatDialog } from '@/components/NewChatDialog';
import { ProfileDialog } from '@/components/ProfileDialog';
import { useAuth } from '@/context/AuthContext';
import { useMessenger } from '@/hooks/useMessenger';
import {
  requestNotificationPermission,
  setTitleBadge,
} from '@/lib/notify';
import type { UserMe } from '@/lib/types';

const MOBILE_BREAKPOINT = 680;
const DARK_KEY = 'wa-clone.dark';

type Section = 'Chats' | SectionName;

const NAV: { label: Section; icon: typeof MessageCircle }[] = [
  { label: 'Chats', icon: MessageCircle },
  { label: 'Updates', icon: CircleDashed },
  { label: 'Channels', icon: Radio },
  { label: 'Communities', icon: Users },
  { label: 'Calls', icon: PhoneCall },
];

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="boot-screen">
        <Loader2 size={26} className="spin" />
        <span>Restoring your session…</span>
      </div>
    );
  }

  if (!user) return <AuthScreen />;

  // Keyed on the user id so switching accounts rebuilds all chat state rather
  // than leaking the previous session's conversations into the new one.
  return <Messenger key={user.id} user={user} />;
}

function Messenger({ user }: { user: UserMe }) {
  const { token, logout } = useAuth();
  const messenger = useMessenger(user, token);

  const [section, setSection] = useState<Section>('Chats');
  const [infoOpen, setInfoOpen] = useState(false);
  const [dialog, setDialog] = useState<'direct' | 'group' | 'profile' | null>(null);
  const [toast, setToast] = useState('');
  const [mobile, setMobile] = useState(
    () => window.innerWidth <= MOBILE_BREAKPOINT,
  );
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem(DARK_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth <= MOBILE_BREAKPOINT);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Asked once, straight after sign-in. That click is the user gesture Chrome
  // wants before it will take the request seriously.
  useEffect(() => {
    void requestNotificationPermission();
  }, []);

  // "(3) WhatsApp Web Clone" in the tab, like WhatsApp Web. Demo chats are
  // excluded -- their unread counts are fixture data, not real waiting
  // messages, and would leave a badge that can never be cleared.
  const unreadTotal = messenger.liveChats.reduce(
    (total, chat) => total + chat.unread_count,
    0,
  );
  useEffect(() => {
    setTitleBadge(unreadTotal);
    return () => setTitleBadge(0);
  }, [unreadTotal]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem(DARK_KEY, dark ? '1' : '0');
    } catch {
      // Theme simply will not persist.
    }
  }, [dark]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Surface request/socket failures through the same toast as everything else.
  useEffect(() => {
    if (messenger.error) {
      setToast(messenger.error);
      messenger.clearError();
    }
  }, [messenger.error, messenger]);

  const { selectedChat } = messenger;
  const showChatPane = section === 'Chats' && selectedChat !== null;

  const frameClasses = [
    'app-frame',
    mobile && showChatPane ? 'mobile-chat' : '',
    mobile && section !== 'Chats' ? 'mobile-section' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="app-shell">
      <div className={frameClasses}>
        <nav className="app-rail" aria-label="Sections">
          <div className="rail-brand" aria-hidden="true">
            <MessageCircle size={25} strokeWidth={2.3} />
          </div>
          <div className="rail-rule" />
          <div className="rail-links">
            {NAV.map(({ label, icon: Icon }) => (
              <button
                key={label}
                title={label}
                aria-label={label}
                aria-current={section === label ? 'page' : undefined}
                onClick={() => {
                  setSection(label);
                  setInfoOpen(false);
                  if (label !== 'Chats') messenger.selectChat(null);
                }}
                className={`rail-link ${section === label ? 'rail-link-active' : ''}`}
              >
                <Icon size={22} />
                {label === 'Chats' &&
                  messenger.chats.some((chat) => chat.unread_count > 0) && <i />}
              </button>
            ))}
          </div>
          <div className="rail-bottom">
            <button
              className="rail-link"
              aria-label="Your profile"
              onClick={() => setDialog('profile')}
            >
              <Settings size={21} />
            </button>
            <button
              className="rail-user"
              onClick={() => setDialog('profile')}
              aria-label="Your profile"
            >
              <Avatar
                name={user.name}
                id={user.id}
                imageUrl={user.profile_image}
                size={30}
              />
            </button>
          </div>
        </nav>

        {section === 'Chats' ? (
          <ChatSidebar
            chats={messenger.chats}
            me={user}
            selectedId={messenger.selectedId}
            loading={messenger.loadingChats}
            dark={dark}
            onSelect={(chatId) => {
              messenger.selectChat(chatId);
              setInfoOpen(false);
            }}
            onNewChat={() => setDialog('direct')}
            onNewGroup={() => setDialog('group')}
            onToggleDark={() => setDark((value) => !value)}
            onOpenProfile={() => setDialog('profile')}
            onLogout={logout}
          />
        ) : (
          <LocalSectionSidebar section={section} notify={setToast} />
        )}

        <div className="main-area">
          {section !== 'Chats' ? (
            <LocalSectionWorkspace section={section} notify={setToast} />
          ) : selectedChat ? (
            <ChatPane
              chat={selectedChat}
              me={user}
              messages={messenger.selectedMessages}
              typingNames={messenger.typingNames}
              socketStatus={messenger.socketStatus}
              isDemo={messenger.isDemoSelected}
              mobile={mobile}
              loadingHistory={messenger.loadingHistory}
              hasMoreHistory={messenger.hasMoreHistory}
              onBack={() => messenger.selectChat(null)}
              onOpenInfo={() => setInfoOpen(true)}
              onLoadOlder={() => {
                if (messenger.selectedId) messenger.loadOlder(messenger.selectedId);
              }}
              onSendText={(text) => void messenger.sendMessage({ content: text })}
              onSendFile={(file) => void messenger.sendFile(file)}
              onEditMessage={(id, content) => void messenger.editMessage(id, content)}
              onDeleteMessage={(id) => void messenger.deleteMessage(id)}
              onTyping={messenger.notifyTyping}
              onNotify={setToast}
            />
          ) : (
            <EmptyState onNewChat={() => setDialog('direct')} />
          )}

          {infoOpen && selectedChat && (
            <ContactPanel
              chat={selectedChat}
              me={user}
              messages={messenger.selectedMessages}
              onClose={() => setInfoOpen(false)}
            />
          )}
        </div>
      </div>

      {toast && <div className="toast-note">{toast}</div>}

      {(dialog === 'direct' || dialog === 'group') && (
        <NewChatDialog
          mode={dialog}
          onClose={() => setDialog(null)}
          onCreate={async (payload) => {
            const chat = await messenger.createChat(payload);
            if (chat) setSection('Chats');
            return chat;
          }}
        />
      )}

      {dialog === 'profile' && <ProfileDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

function EmptyState({ onNewChat }: { onNewChat: () => void }) {
  return (
    <div className="empty-main">
      <div className="empty-art">
        <div className="empty-art-blob" />
        <div className="empty-art-card">
          <div className="empty-art-inner">
            <MessageSquarePlus size={46} strokeWidth={1.2} />
          </div>
          <div className="empty-art-dot">
            <CircleDashed size={24} />
          </div>
        </div>
      </div>
      <h1>Pick up where you left off</h1>
      <p>
        Choose a conversation on the left, or start a new one with someone who
        has an account on this server.
      </p>
      <button className="primary-action" onClick={onNewChat}>
        <MessageSquarePlus size={17} />
        New chat
      </button>
      <div className="empty-footnote">
        <LockKeyhole size={13} />
        Messages are stored in PostgreSQL and delivered over WebSockets
      </div>
    </div>
  );
}
