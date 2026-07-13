type MockBannerProps = {
  reason?: string
}

export function MockBanner({ reason }: MockBannerProps) {
  return (
    <div className="mx-8 mt-4 px-4 py-3 rounded-[14px] border border-cuivre/30 bg-cuivre-tint/40 flex items-start gap-3 text-xs text-cuivre flex-shrink-0">
      <div className="w-5 h-5 rounded-full bg-cuivre text-white flex items-center justify-center text-[10px] font-bold shrink-0">i</div>
      <div className="leading-relaxed pt-0.5">
        <strong className="font-bold">Données mockées</strong>
        {reason ? ` — ${reason}` : ' — backend en cours de développement, les chiffres affichés sont fictifs.'}
      </div>
    </div>
  )
}
