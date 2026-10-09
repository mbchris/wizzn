/** YYYY-MM-DD of `at` in an IANA time zone; falls back to Europe/Berlin for unknown zones. */
export function localDate(at: Date, timeZone: string): string {
  const fmt = (tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
  try {
    return fmt(timeZone)
  } catch {
    return fmt('Europe/Berlin')
  }
}
