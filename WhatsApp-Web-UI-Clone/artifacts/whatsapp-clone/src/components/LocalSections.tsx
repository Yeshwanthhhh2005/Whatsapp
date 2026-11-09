/**
 * Updates, Channels, Communities and Calls.
 *
 * These stay local mock UI: the backend deliberately scopes them out (status
 * updates, communities and calls are on its "do not build" list), so there is
 * nothing to connect them to. They are kept because they were already built
 * and removing them would be a visual regression. Chats is the live section.
 */

import { useState } from 'react';
import {
  CalendarClock,
  Camera,
  ChevronRight,
  CircleDashed,
  Forward,
  Megaphone,
  MoreVertical,
  Phone,
  PhoneCall,
  Plus,
  Radio,
  Search,
  Send,
  Users,
  X,
} from 'lucide-react';

export type SectionName = 'Updates' | 'Channels' | 'Communities' | 'Calls';

const STATUS_UPDATES = [
  { name: 'Priya Shah', initials: 'PS', color: '#bd8e74', time: '12 minutes ago', caption: 'A slow morning by the sea' },
  { name: 'Nina Patel', initials: 'NP', color: '#6b987f', time: '38 minutes ago', caption: 'Little things from today' },
  { name: 'Weekend wanderers', initials: 'WW', color: '#84976e', time: '1 hour ago', caption: 'On the trail already' },
  { name: 'Jules Rivera', initials: 'JR', color: '#817fa6', time: '2 hours ago', caption: 'Sunday in the city' },
];

const CHANNELS = [
  { name: 'The Daily', initials: 'TD', color: '#607b88', time: '10:42', preview: 'A quieter way to start the morning' },
  { name: 'Design Week', initials: 'DW', color: '#a67f73', time: '09:18', preview: 'Five ideas worth keeping' },
  { name: 'Garden Notes', initials: 'GN', color: '#779279', time: 'Yesterday', preview: 'The first seedlings are up' },
];

const COMMUNITIES = [
  { name: 'Design book club', initials: 'DB', color: '#aa906e', preview: 'Chapter 4 is our favourite so far' },
  { name: 'Weekend wanderers', initials: 'WW', color: '#84976e', preview: 'Next walk · Sunday morning' },
  { name: 'Sunday table', initials: 'ST', color: '#bc8a9a', preview: 'Lunch plans and good recipes' },
  { name: 'Flat 4B', initials: '4B', color: '#867b6d', preview: 'Neighbourhood updates' },
];

const CALLS = [
  { name: 'Maya Chen', initials: 'MC', color: '#b88776', time: 'Today, 11:16 AM', kind: 'Incoming voice call', missed: false },
  { name: 'Theo Martin', initials: 'TM', color: '#b29b66', time: 'Today, 9:42 AM', kind: 'Outgoing video call', missed: false },
  { name: 'Nina Patel', initials: 'NP', color: '#6b987f', time: 'Yesterday, 6:08 PM', kind: 'Missed voice call', missed: true },
];

interface Props {
  section: SectionName;
  notify: (text: string) => void;
}

export function LocalSectionSidebar({ section, notify }: Props) {
  const [focused, setFocused] = useState('');
  const [seen, setSeen] = useState<string[]>([]);

  const title = section === 'Updates' ? 'Status updates' : section;

  return (
    <aside className="side">
      <div className="topbar">
        <div>
          <div className="text-[18px] font-semibold">{title}</div>
          <div className="text-[11px] text-[#667781]">Local preview only</div>
        </div>
        <button
          className="icon-btn"
          aria-label={`${section} action`}
          onClick={() => notify(`${section} is not part of this build`)}
        >
          {section === 'Updates' ? (
            <Camera size={20} />
          ) : section === 'Calls' ? (
            <Phone size={20} />
          ) : section === 'Communities' ? (
            <Plus size={22} />
          ) : (
            <Search size={20} />
          )}
        </button>
      </div>

      <div className="section-side-list">
        {section === 'Updates' && (
          <>
            <div className="section-list-heading">RECENT UPDATES</div>
            {STATUS_UPDATES.map((item) => (
              <button
                key={item.name}
                className={`section-row ${focused === item.name ? 'section-row-active' : ''}`}
                onClick={() => {
                  setFocused(item.name);
                  setSeen((current) =>
                    current.includes(item.name) ? current : [...current, item.name],
                  );
                }}
              >
                <div
                  className={`section-avatar ${seen.includes(item.name) ? 'status-seen' : ''}`}
                  style={{ backgroundColor: item.color }}
                >
                  {item.initials}
                </div>
                <span className="section-row-copy">
                  <strong>{item.name}</strong>
                  <small>{item.time}</small>
                </span>
              </button>
            ))}
            <div className="section-side-note">
              Status updates disappear after 24 hours.
            </div>
          </>
        )}

        {section === 'Channels' &&
          CHANNELS.map((item) => (
            <button
              key={item.name}
              className={`section-row ${focused === item.name ? 'section-row-active' : ''}`}
              onClick={() => setFocused(item.name)}
            >
              <div
                className="section-avatar channel-avatar"
                style={{ backgroundColor: item.color }}
              >
                {item.initials}
              </div>
              <span className="section-row-copy">
                <strong>
                  {item.name}
                  <span className="verified-dot">✓</span>
                </strong>
                <small>{item.preview}</small>
              </span>
            </button>
          ))}

        {section === 'Communities' &&
          COMMUNITIES.map((item) => (
            <button
              key={item.name}
              className={`section-row ${focused === item.name ? 'section-row-active' : ''}`}
              onClick={() => setFocused(item.name)}
            >
              <div
                className="section-avatar community-avatar"
                style={{ backgroundColor: item.color }}
              >
                {item.initials}
              </div>
              <span className="section-row-copy">
                <strong>{item.name}</strong>
                <small>{item.preview}</small>
              </span>
            </button>
          ))}

        {section === 'Calls' && (
          <>
            <div className="calls-actions">
              <button onClick={() => notify('Calls are not part of this build')}>
                <Phone size={18} />
                <span>New call</span>
              </button>
              <button onClick={() => notify('Calls are not part of this build')}>
                <CalendarClock size={18} />
                <span>Schedule</span>
              </button>
            </div>
            <div className="section-list-heading">RECENT</div>
            {CALLS.map((item) => (
              <button
                key={item.name}
                className="section-row"
                onClick={() => notify('Calls are not part of this build')}
              >
                <div className="section-avatar" style={{ backgroundColor: item.color }}>
                  {item.initials}
                </div>
                <span className="section-row-copy">
                  <strong>{item.name}</strong>
                  <small>{item.time}</small>
                </span>
                <span className={`call-direction ${item.missed ? 'missed' : ''}`}>
                  <Phone size={15} />
                </span>
              </button>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}

export function LocalSectionWorkspace({ section, notify }: Props) {
  const [focused, setFocused] = useState('');

  if (section === 'Updates') {
    const item = STATUS_UPDATES.find((candidate) => candidate.name === focused);
    return (
      <section className="section-workspace">
        <header className="section-main-header">
          <div>
            <div className="section-eyebrow">LOCAL PREVIEW</div>
            <h1>Updates</h1>
          </div>
        </header>
        {item ? (
          <div className="status-viewer">
            <div className="status-progress">
              <i />
            </div>
            <div className="status-viewer-author">
              <div className="section-avatar" style={{ backgroundColor: item.color }}>
                {item.initials}
              </div>
              <div>
                <strong>{item.name}</strong>
                <small>{item.time}</small>
              </div>
              <button aria-label="Close status" onClick={() => setFocused('')}>
                <X size={19} />
              </button>
            </div>
            <div
              className="status-art"
              style={{ background: `linear-gradient(145deg, ${item.color}, #273c36)` }}
            >
              <p>{item.caption}</p>
              <span>YOUR DAY, IN MOMENTS</span>
            </div>
            <div className="status-reply">
              <input placeholder={`Reply to ${item.name}…`} readOnly />
              <button onClick={() => notify('Status replies are not part of this build')}>
                <Send size={19} />
              </button>
            </div>
          </div>
        ) : (
          <div className="section-empty">
            <div className="section-hero-icon updates-hero">
              <CircleDashed size={37} />
            </div>
            <h2>Share everyday moments</h2>
            <p>
              Status updates are out of scope for this build. Pick one to see the
              viewer.
            </p>
            <div className="status-card-grid">
              {STATUS_UPDATES.slice(0, 3).map((candidate) => (
                <button
                  key={candidate.name}
                  className="status-preview-card"
                  onClick={() => setFocused(candidate.name)}
                  style={{ background: `linear-gradient(160deg, ${candidate.color}, #34443f)` }}
                >
                  <div className="status-preview-avatar">{candidate.initials}</div>
                  <strong>{candidate.name}</strong>
                  <small>{candidate.time}</small>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    );
  }

  if (section === 'Channels') {
    return (
      <section className="section-workspace">
        <header className="section-main-header">
          <div>
            <div className="section-eyebrow">LOCAL PREVIEW</div>
            <h1>Channels</h1>
          </div>
        </header>
        <div className="channel-feed">
          <div className="section-feed-intro">
            <div className="section-hero-icon channel-hero">
              <Radio size={32} />
            </div>
            <h2>Updates from channels</h2>
            <p>Channels are out of scope for this build.</p>
          </div>
          {CHANNELS.map((item, index) => (
            <article className="channel-post" key={item.name}>
              <div className="channel-post-head">
                <div className="section-avatar" style={{ backgroundColor: item.color }}>
                  {item.initials}
                </div>
                <div>
                  <strong>
                    {item.name}
                    <span className="verified-dot">✓</span>
                  </strong>
                  <small>{index === 0 ? 'Today, 10:42 AM' : item.time}</small>
                </div>
                <button aria-label={`More from ${item.name}`} onClick={() => notify('Not part of this build')}>
                  <MoreVertical size={18} />
                </button>
              </div>
              <p>{item.preview}.</p>
              <div className="channel-post-actions">
                <button onClick={() => notify('Not part of this build')}>♡ <span>React</span></button>
                <button onClick={() => notify('Not part of this build')}>
                  <Forward size={15} />
                  Share
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  }

  if (section === 'Communities') {
    const item = COMMUNITIES.find((candidate) => candidate.name === focused);
    return (
      <section className="section-workspace">
        <header className="section-main-header">
          <div>
            <div className="section-eyebrow">LOCAL PREVIEW</div>
            <h1>Communities</h1>
          </div>
        </header>
        {item ? (
          <div className="community-detail">
            <div className="community-cover">
              <div className="community-cover-avatar">{item.initials}</div>
            </div>
            <h2>{item.name}</h2>
            <p>{item.preview}</p>
            <div className="community-announcement">
              <div className="announcement-icon">
                <Megaphone size={20} />
              </div>
              <div>
                <strong>Announcements</strong>
                <small>Community announcements and updates</small>
              </div>
              <ChevronRight size={17} />
            </div>
          </div>
        ) : (
          <div className="section-empty">
            <div className="section-hero-icon community-hero">
              <Users size={35} />
            </div>
            <h2>Communities</h2>
            <p>Communities are out of scope for this build.</p>
            <div className="community-card-grid">
              {COMMUNITIES.slice(0, 3).map((candidate) => (
                <button
                  key={candidate.name}
                  onClick={() => setFocused(candidate.name)}
                  className="community-preview-card"
                >
                  <div
                    className="community-preview-cover"
                    style={{ background: `linear-gradient(135deg,${candidate.color},#485950)` }}
                  >
                    <span>{candidate.initials}</span>
                  </div>
                  <strong>{candidate.name}</strong>
                  <small>{candidate.preview}</small>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="section-workspace">
      <header className="section-main-header">
        <div>
          <div className="section-eyebrow">LOCAL PREVIEW</div>
          <h1>Calls</h1>
        </div>
      </header>
      <div className="calls-workspace">
        <div className="calls-welcome">
          <div className="section-hero-icon calls-hero">
            <PhoneCall size={32} />
          </div>
          <h2>Calls are out of scope</h2>
          <p>
            Voice and video calling is on the backend&rsquo;s explicit
            do-not-build list, so this section stays a local preview.
          </p>
        </div>
      </div>
    </section>
  );
}
