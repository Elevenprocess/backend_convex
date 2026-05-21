type BlobSpec = {
  size: number
  color: string
  opacity: number
  position: string // tailwind classes for placement
}

type BlobsProps = {
  blobs: BlobSpec[]
}

export function Blobs({ blobs }: BlobsProps) {
  return (
    <>
      {blobs.map((b, i) => (
        <div
          key={i}
          className={`blob ${b.position}`}
          style={{
            width: b.size,
            height: b.size,
            backgroundColor: b.color,
            opacity: b.opacity,
          }}
        />
      ))}
      <div className="glass-overlay" />
    </>
  )
}

export const BLOB_PRESETS: Record<string, BlobSpec[]> = {
  setter: [
    { size: 420, color: '#4A6FE3', opacity: 0.16, position: 'top-10 left-1/4' },
    { size: 320, color: '#6B7C8C', opacity: 0.14, position: 'bottom-20 right-1/3' },
  ],
  commercial: [
    { size: 420, color: '#3525A8', opacity: 0.14, position: '-top-10 right-10' },
    { size: 320, color: '#4A6FE3', opacity: 0.16, position: 'bottom-10 left-1/4' },
  ],
  admin: [
    { size: 480, color: '#6B7C8C', opacity: 0.16, position: 'top-0 left-1/2 -translate-x-1/2' },
    { size: 380, color: '#4A6FE3', opacity: 0.14, position: 'bottom-20 right-10' },
  ],
  login: [
    { size: 480, color: '#4A6FE3', opacity: 0.18, position: '-top-20 -left-20' },
    { size: 320, color: '#3525A8', opacity: 0.15, position: 'bottom-10 right-40' },
    { size: 400, color: '#6B7C8C', opacity: 0.22, position: 'top-40 right-10' },
  ],
  default: [
    { size: 420, color: '#4A6FE3', opacity: 0.14, position: 'top-10 left-10' },
    { size: 320, color: '#5AB3FF', opacity: 0.12, position: 'bottom-20 right-20' },
    { size: 280, color: '#6B7C8C', opacity: 0.14, position: 'top-1/2 right-1/4' },
  ],
}
