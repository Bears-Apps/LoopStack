import type { UserProfile } from '@/data/types';
import styles from './Profile.module.css';

export function ProfileHeader({ profile }: { profile: UserProfile }) {
  const yearsSinceDx =
    new Date().getFullYear() - new Date(profile.diagnosedOn).getFullYear();

  return (
    <header className={styles.profileHeader}>
      <div className={styles.avatar} aria-hidden>
        <span>{profile.displayName.charAt(0)}</span>
      </div>
      <div className={styles.headerText}>
        <h1 className={styles.name}>{profile.displayName}</h1>
        <p className={styles.meta}>
          Type 1 · {yearsSinceDx} years
        </p>
      </div>
    </header>
  );
}
