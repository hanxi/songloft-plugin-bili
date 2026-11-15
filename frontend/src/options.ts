export type Option = [string, string]
export const OPTION_PAGE_SIZE = 20
export function optionPage(options: Option[], query: string, page: number) {
  const needle = query.trim().toLocaleLowerCase()
  const filtered = [...new Map(options).entries()].filter(([, title]) =>
    title.toLocaleLowerCase().includes(needle),
  )
  const pages = Math.max(1, Math.ceil(filtered.length / OPTION_PAGE_SIZE))
  const index = Math.max(0, Math.min(page, pages - 1))
  return {
    items: filtered.slice(
      index * OPTION_PAGE_SIZE,
      (index + 1) * OPTION_PAGE_SIZE,
    ),
    page: index,
    pages,
    count: filtered.length,
  }
}
