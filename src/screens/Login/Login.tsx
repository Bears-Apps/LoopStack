import { useNavigate } from 'react-router-dom';
import { LogoMark } from '@/components/Wordmark/Wordmark';
import { Button } from '@/components/Button/Button';
import styles from './Login.module.css';

export function Login() {
  const navigate = useNavigate();

  return (
    <div className={styles.screen}>
      <div className={styles.hero}>
        <LogoMark className={styles.mark} />
        <h1 className={styles.wordmark}>
          <span className={styles.loop}>Loop</span>
          <span className={styles.stack}>Stack</span>
        </h1>
        <p className={styles.tagline}>
          UNDERSTAND<span className={styles.dot}>.</span> ADAPT<span className={styles.dot}>.</span>{' '}
          IMPROVE<span className={styles.dot}>.</span>
        </p>
      </div>

      <div className={styles.body}>
        <h2 className={styles.title}>Metabolic intelligence for Type&nbsp;1.</h2>
        <p className={styles.lede}>
          LoopStack learns from your CGM, meals, Loop settings, and activity — then quietly nudges
          you toward more time in range.
        </p>
      </div>

      <div className={styles.footer}>
        <Button variant="primary" onClick={() => navigate('/app/trends')}>
          Start Stacking
        </Button>
        <p className={styles.legal}>
          By continuing you agree to LoopStack's{' '}
          <a href="#" className={styles.link}>
            Terms
          </a>{' '}
          and{' '}
          <a href="#" className={styles.link}>
            Privacy Policy
          </a>
          .
        </p>
      </div>
    </div>
  );
}
