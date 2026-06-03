import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FileDropzone } from './FileDropzone'

function makeFile(name = 'a.pdf', type = 'application/pdf') {
  return new File(['x'], name, { type })
}

describe('FileDropzone', () => {
  it('affiche le titre et le sous-titre au repos', () => {
    render(<FileDropzone id="z" title="Déposer un fichier" subtitle="PDF, etc." onFiles={vi.fn()} />)
    expect(screen.getByText('Déposer un fichier')).toBeTruthy()
    expect(screen.getByText('PDF, etc.')).toBeTruthy()
  })

  it('appelle onFiles avec les fichiers déposés', () => {
    const onFiles = vi.fn()
    const { container } = render(<FileDropzone id="z" title="T" subtitle="S" onFiles={onFiles} />)
    const label = container.querySelector('label')!
    const file = makeFile()
    fireEvent.drop(label, { dataTransfer: { files: [file] } })
    expect(onFiles).toHaveBeenCalledTimes(1)
    expect(onFiles.mock.calls[0][0]).toEqual([file])
  })

  it('montre « Déposez ici » au survol puis revient au repos', () => {
    const { container } = render(<FileDropzone id="z" title="T" subtitle="Sous-titre repos" onFiles={vi.fn()} />)
    const label = container.querySelector('label')!
    fireEvent.dragEnter(label, { dataTransfer: { files: [] } })
    expect(screen.getByText('Déposez ici')).toBeTruthy()
    fireEvent.dragLeave(label, { dataTransfer: { files: [] } })
    expect(screen.getByText('Sous-titre repos')).toBeTruthy()
  })

  it('en upload : affiche le spinner et ignore le drop', () => {
    const onFiles = vi.fn()
    const { container } = render(<FileDropzone id="z" title="T" subtitle="S" uploading onFiles={onFiles} />)
    expect(screen.getByText(/Upload en cours/i)).toBeTruthy()
    const label = container.querySelector('label')!
    fireEvent.drop(label, { dataTransfer: { files: [makeFile()] } })
    expect(onFiles).not.toHaveBeenCalled()
  })

  it("onChange de l'input transmet un File[]", () => {
    const onFiles = vi.fn()
    const { container } = render(<FileDropzone id="z" title="T" subtitle="S" onFiles={onFiles} />)
    const input = container.querySelector('input[type=file]') as HTMLInputElement
    const file = makeFile('b.png', 'image/png')
    fireEvent.change(input, { target: { files: [file] } })
    expect(onFiles).toHaveBeenCalledWith([file])
  })
})
