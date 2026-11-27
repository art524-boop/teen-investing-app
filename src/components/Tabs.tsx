import { NavLink } from 'react-router-dom'
import { useFamily } from '../lib/familyData'

// Icon paths copied from reference/prototype-v6.html
const IC: Record<string, string> = {
  home: 'M3 11l9-7 9 7v9h-6v-6H9v6H3z',
  approve: 'M4 4h16v16H4zM4 14h5l1 2h4l1-2h5',
  plan: 'M4 7h10M18 7h2M4 17h4M12 17h8M18 7a2 2 0 1 1-4 0a2 2 0 1 1 4 0M12 17a2 2 0 1 1-4 0a2 2 0 1 1 4 0',
  garden: 'M12 21V11M12 11c0-4 3-7 8-7 0 5-3 7-8 7zM12 15c0-3-2-5-7-5 0 4 2 5 7 5z',
  tasks: 'M10 6h10M10 12h10M10 18h10M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17',
  journey: 'M4 4v16h16M8 15l3-4 3 2 5-6',
}

interface Item { to: string; label: string; icon: string; badge?: number; badgeLabel?: string; end?: boolean }

function TabBar({ items, label }: { items: Item[]; label: string }) {
  return (
    <nav className={`tabs n${items.length}`} aria-label={label}>
      {items.map((it) => (
        <NavLink key={it.to} to={it.to} end={it.end}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={IC[it.icon]} />
          </svg>
          {it.label}
          {it.badge ? <span className="dot" aria-label={it.badgeLabel}>{it.badge}</span> : null}
        </NavLink>
      ))}
    </nav>
  )
}

export function ParentTabs() {
  const { pendingCount } = useFamily()
  return (
    <TabBar label="Parent sections" items={[
      { to: '/parent', label: 'Home', icon: 'home', end: true },
      { to: '/parent/approvals', label: 'Approvals', icon: 'approve', badge: pendingCount, badgeLabel: `${pendingCount} waiting` },
      { to: '/parent/family', label: 'Family', icon: 'plan' },
    ]} />
  )
}

export function TeenTabs() {
  const { newDecisions } = useFamily()
  return (
    <TabBar label="Teen sections" items={[
      { to: '/teen', label: 'Garden', icon: 'garden', end: true },
      { to: '/teen/tasks', label: 'Tasks', icon: 'tasks', badge: newDecisions, badgeLabel: `${newDecisions} new` },
      { to: '/teen/credits', label: 'Credits', icon: 'journey' },
    ]} />
  )
}
