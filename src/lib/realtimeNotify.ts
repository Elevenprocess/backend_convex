/**
 * Décide si une notification temps réel doit être affichée à l'utilisateur
 * courant. Ciblage : si la notif porte un userId, on n'affiche que pour ce
 * destinataire. Sans userId (legacy broadcast) ou utilisateur courant inconnu,
 * on conserve le comportement historique (afficher).
 */
export function shouldSurfaceNotification(
  notificationUserId: string | undefined,
  currentUserId: string | null,
): boolean {
  if (!notificationUserId) return true
  if (!currentUserId) return true
  return notificationUserId === currentUserId
}
