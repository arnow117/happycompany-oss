import { Link } from 'react-router-dom';

interface LinkedSkillChipProps {
  skillName: string;
}

const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 10px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-accent-active)',
  background: 'var(--color-accent-dim)',
  textDecoration: 'none',
  fontSize: 'var(--text-sm)',
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'background 0.15s, border-color 0.15s',
};

export function LinkedSkillChip({ skillName }: LinkedSkillChipProps) {
  return (
    <Link
      to={`/skills-marketplace?skill=${encodeURIComponent(skillName)}`}
      style={chipStyle}
      title={`在技能市场中查看 ${skillName}`}
    >
      {skillName}
    </Link>
  );
}
