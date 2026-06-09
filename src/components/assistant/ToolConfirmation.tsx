type WriteToolName = 'updateLeadStatus' | 'assignLead'

type Props = {
  toolName: WriteToolName
  input: Record<string, unknown>
  onConfirm: () => void
  onCancel: () => void
  pending?: boolean
  error?: string | null
}

function label(toolName: WriteToolName, input: Record<string, unknown>): string {
  if (toolName === 'updateLeadStatus') {
    return `Passer le lead ${String(input.leadId)} en statut « ${String(input.status)} » ?`
  }
  return `Assigner le lead ${String(input.leadId)} au commercial ${String(input.commercialId)} ?`
}

export function ToolConfirmation({ toolName, input, onConfirm, onCancel, pending, error }: Props) {
  return (
    <div className="assistant-confirm" role="group" aria-label="Confirmation d'action">
      <p className="assistant-confirm-text">{label(toolName, input)}</p>
      {error && <p className="assistant-confirm-error">{error}</p>}
      <div className="assistant-confirm-actions">
        <button type="button" onClick={onConfirm} disabled={pending}>
          {pending ? '…' : 'Confirmer'}
        </button>
        <button type="button" onClick={onCancel} disabled={pending}>
          Annuler
        </button>
      </div>
    </div>
  )
}
