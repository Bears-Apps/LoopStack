import { AppHeader } from '@/components/AppHeader/AppHeader';
import styles from './ScreenStub.module.css';

type Props = {
  title: string;
  phase: string;
  blurb: string;
};

export function ScreenStub({ title, phase, blurb }: Props) {
  return (
    <>
      <AppHeader title={title} />
      <main className="screen">
        <div className={styles.stub}>
          <span className={styles.phaseTag}>{phase}</span>
          <h1 className={styles.stubTitle}>{title}</h1>
          <p className={styles.stubBlurb}>{blurb}</p>
        </div>
      </main>
    </>
  );
}
