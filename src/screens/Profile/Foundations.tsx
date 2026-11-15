import { Section } from '@/components/Section/Section';
import { CardSelect } from '@/components/CardSelect/CardSelect';
import type { AgeRange, TypicalRoutine, UserProfile } from '@/data/types';

const ageOptions: Array<{ value: AgeRange; label: string; hint?: string }> = [
  { value: '18-29', label: '18–29' },
  { value: '30-44', label: '30–44' },
  { value: '45-59', label: '45–59' },
  { value: '60+', label: '60+' },
];

const routineOptions: Array<{ value: TypicalRoutine; label: string; hint: string }> = [
  { value: 'regular_hours', label: 'Regular hours', hint: 'Sleep & meals at similar times daily' },
  { value: 'shift_work', label: 'Shift work', hint: 'Rotating or irregular sleep schedule' },
  { value: 'flexible', label: 'Flexible', hint: 'Weekdays steady, weekends shift' },
  { value: 'athlete', label: 'Athlete', hint: 'Training ≥4× / week shapes insulin needs' },
];

type Props = {
  profile: UserProfile;
  onChange: (next: Pick<UserProfile, 'ageRange' | 'typicalRoutine'>) => void;
};

export function Foundations({ profile, onChange }: Props) {
  return (
    <Section
      label="Foundations"
      title="About you"
      description="Slow-changing context. These set the confidence baseline for how aggressively LoopStack tunes suggestions."
    >
      <div>
        <div className="label" style={{ marginBottom: 8 }}>Age range</div>
        <CardSelect
          ariaLabel="Age range"
          options={ageOptions}
          value={profile.ageRange}
          onChange={(ageRange) =>
            onChange({ ageRange, typicalRoutine: profile.typicalRoutine })
          }
        />
      </div>

      <div>
        <div className="label" style={{ marginBottom: 8 }}>Typical routine</div>
        <CardSelect
          ariaLabel="Typical routine"
          options={routineOptions}
          value={profile.typicalRoutine}
          onChange={(typicalRoutine) =>
            onChange({ ageRange: profile.ageRange, typicalRoutine })
          }
        />
      </div>
    </Section>
  );
}
