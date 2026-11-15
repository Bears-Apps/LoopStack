import { NavLink } from 'react-router-dom';
import styles from './BottomNav.module.css';

type TabDef = {
  to: string;
  label: string;
  icon: React.ReactNode;
};

const leftTabs: TabDef[] = [
  {
    to: '/app/trends',
    label: 'Trends',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M3 17L9 11L13 15L21 7"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M15 7H21V13"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

const rightTabs: TabDef[] = [
  {
    to: '/app/insights',
    label: 'Insights',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 3V5"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
        <path
          d="M8 19H16"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
        <path
          d="M9.5 21H14.5"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
        <path
          d="M7 14C6 12.5 5.5 11.3 5.5 10C5.5 6.41015 8.41015 3.5 12 3.5C15.5899 3.5 18.5 6.41015 18.5 10C18.5 11.3 18 12.5 17 14C16 15.5 15.5 16.5 15.5 17.5H8.5C8.5 16.5 8 15.5 7 14Z"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    to: '/app/chat',
    label: 'Ask data',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-9l-5 3v-3H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
        <path d="M7 9h10M7 13h6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: '/app/profile',
    label: 'Profile',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="8.5" r="3.5" stroke="currentColor" strokeWidth="1.75" />
        <path
          d="M4 20C4 16 7.5 14 12 14C16.5 14 20 16 20 20"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
];

// Four labelled destinations, evenly spaced: the data views, the evidence
// chat and Profile. The meal tools that once sat here were removed.
export function BottomNav() {
  return (
    <nav className={styles.nav} aria-label="Primary">
      <div className={styles.inner}>
        {leftTabs.map((tab) => (
          <TabLink key={tab.to} tab={tab} />
        ))}
        {rightTabs.map((tab) => (
          <TabLink key={tab.to} tab={tab} />
        ))}
      </div>
    </nav>
  );
}

function TabLink({ tab }: { tab: TabDef }) {
  return (
    <NavLink
      to={tab.to}
      className={({ isActive }) => `${styles.tab} ${isActive ? styles.active : ''}`}
    >
      <span className={styles.icon}>{tab.icon}</span>
      <span className={styles.label}>{tab.label}</span>
    </NavLink>
  );
}
