import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

type EmptyStateProps = {
  icon?: IconName
  title: string
  description?: string
  primaryAction?: { label: string; onClick: () => void; icon?: IconName }
  secondaryAction?: { label: string; onClick: () => void }
  children?: ReactNode
}

export function EmptyState({ icon = 'users', title, description, primaryAction, secondaryAction, children }: EmptyStateProps) {
  return (
    <div className="text-center max-w-md mx-auto">
      <div className="w-32 h-32 rounded-full bg-white/60 backdrop-blur-md flex items-center justify-center mx-auto mb-6 border border-white/80 shadow-lg">
        <Icon name={icon} size={56} strokeWidth={1.5} className="text-faint" />
      </div>
      <h2 className="text-2xl font-bold mb-2">{title}</h2>
      {description && <p className="text-muted mb-6">{description}</p>}
      {(primaryAction || secondaryAction) && (
        <div className="flex justify-center gap-3">
          {secondaryAction && (
            <button onClick={secondaryAction.onClick} className="btn-secondary px-5 py-3 rounded-[14px] text-sm">
              {secondaryAction.label}
            </button>
          )}
          {primaryAction && (
            <button onClick={primaryAction.onClick} className="btn-primary px-5 py-3 rounded-[14px] text-sm flex items-center gap-2">
              {primaryAction.icon && <Icon name={primaryAction.icon} size={14} />}
              {primaryAction.label}
            </button>
          )}
        </div>
      )}
      {children}
    </div>
  )
}
