import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'

type StubProps = {
  frame: string
  title: string
  desc?: string
}

export function PageStub({ frame, title, desc }: StubProps) {
  return (
    <AppShell>
      <Topbar eyebrow={frame} title={title} />
      <main className="p-6 flex items-center justify-center flex-grow">
        <div className="glass-card p-12 text-center max-w-lg">
          <div className="eyebrow mb-3">{frame}</div>
          <h1 className="text-3xl font-bold mb-3">{title}</h1>
          <p className="text-muted">{desc ?? 'Frame en cours de construction. Reviens plus tard.'}</p>
        </div>
      </main>
    </AppShell>
  )
}
