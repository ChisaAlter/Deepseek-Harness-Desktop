/** Document drag-and-drop listeners owned by one mounted attachment view. */
import type { ComposerAttachmentsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

/**
 * Install one attachment view's file-drop listeners.
 * @param canAcceptDrop - whether this view accepts the dropped files.
 * @param onAddFiles - attachment intake callback.
 * @param dragDepth - the view's retained nested-drag counter.
 * @param setDragActive - publish whether a file drag is active.
 * @returns cleanup for exactly these listeners.
 */
export function installDocumentDropEvents(
  canAcceptDrop: ComposerAttachmentsProps['canAcceptDrop'],
  onAddFiles: ComposerAttachmentsProps['onAddFiles'],
  dragDepth: { current: number },
  setDragActive: (active: boolean) => void,
): () => void {
  const fileTransfer = (event: globalThis.DragEvent): DataTransfer | null => {
    const dataTransfer = event.dataTransfer
    if (dataTransfer === null || !dataTransfer.types.includes('Files')) return null
    return dataTransfer
  }
  const reset = (): void => {
    dragDepth.current = 0
    setDragActive(false)
  }
  const onDragEnter = (event: globalThis.DragEvent): void => {
    if (fileTransfer(event) === null) return
    event.preventDefault()
    dragDepth.current += 1
    setDragActive(true)
  }
  const onDragOver = (event: globalThis.DragEvent): void => {
    const dataTransfer = fileTransfer(event)
    if (dataTransfer === null) return
    event.preventDefault()
    dataTransfer.dropEffect = canAcceptDrop ? 'copy' : 'none'
  }
  const onDragLeave = (event: globalThis.DragEvent): void => {
    if (fileTransfer(event) === null) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragActive(false)
    const leftViewport = event.clientX <= 0 || event.clientY <= 0
      || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight
    if ((event.target === document.documentElement || event.target === document.body) && leftViewport) reset()
  }
  const onDrop = (event: globalThis.DragEvent): void => {
    const dataTransfer = fileTransfer(event)
    if (dataTransfer === null) return
    event.preventDefault()
    reset()
    if (!canAcceptDrop) return
    // A dropped folder arrives as a File stub whose bytes the transport
    // cannot read; the item's FileSystem entry is the only in-band
    // classifier, so entries without one pass through as files.
    const files: File[] = []
    const rejected: File[] = []
    // dataTransfer.files mirrors the file-kind items in order, but every
    // accessor mints a fresh File object — identity cannot match the two
    // lists, so the sweep skips one leading entry per item that produced a
    // File and only takes leftovers an unproductive items list would lose.
    let productive = 0
    for (const item of dataTransfer.items) {
      if (item.kind !== 'file') continue
      const file = item.getAsFile()
      if (file === null) continue
      productive += 1
      if (item.webkitGetAsEntry()?.isDirectory === true) rejected.push(file)
      else files.push(file)
    }
    for (let i = productive; i < dataTransfer.files.length; i += 1) {
      const file = dataTransfer.files[i]
      if (file !== undefined) files.push(file)
    }
    onAddFiles(files, rejected)
  }
  document.addEventListener('dragenter', onDragEnter)
  document.addEventListener('dragover', onDragOver)
  document.addEventListener('dragleave', onDragLeave)
  document.addEventListener('drop', onDrop)
  window.addEventListener('dragend', reset)
  return () => {
    document.removeEventListener('dragenter', onDragEnter)
    document.removeEventListener('dragover', onDragOver)
    document.removeEventListener('dragleave', onDragLeave)
    document.removeEventListener('drop', onDrop)
    window.removeEventListener('dragend', reset)
  }
}
