/** Deduplicate reads without serializing independent resources. */
export function createReadCache() {
  const pending = new Map<string, Promise<void>>()
  return (name: string, read: () => Promise<void>): Promise<void> => {
    const existing = pending.get(name)
    if (existing) return existing
    const task = Promise.resolve()
      .then(read)
      .finally(() => pending.delete(name))
    pending.set(name, task)
    return task
  }
}
export function coverSource(value: string): string {
  if (!value) return ''
  const source = value.startsWith('//') ? 'https:' + value : value
  return /^https?:\/\//i.test(source) ? source.replace(/^http:/i, 'https:') : ''
}
