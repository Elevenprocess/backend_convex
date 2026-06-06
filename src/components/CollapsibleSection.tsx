import type { ReactNode } from 'react'
import { Icon } from './Icon'
import { useCollapsibleState } from '../lib/useCollapsibleState'

type CollapsibleSectionProps = {
  title: string
  storageKey: string
  defaultCollapsed?: boolean
  right?: ReactNode
  children: ReactNode
}

/**
 * Section repliable/dépliable réutilisable. Ne fournit pas le fond de carte
 * (laissé à l'appelant) ; en-tête cliquable avec chevron, état persistant.
 */
export function CollapsibleSection({
  title,
  storageKey,
  defaultCollapsed = false,
  right,
  children,
}: CollapsibleSectionProps) {
  const [collapsed, toggle] = useCollapsibleState(storageKey, defaultCollapsed)
  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 font-bold">
          <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={16} className="text-faint" />
          {title}
        </span>
        {right}
      </button>
      {!collapsed && <div className="mt-4">{children}</div>}
    </div>
  )
}
