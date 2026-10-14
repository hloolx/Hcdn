/** ISO 3166-1 alpha-2 codes offered for region blocking (Asia-Pacific first). */
export const COUNTRY_CODES = [
  // Asia-Pacific
  "CN", "HK", "MO", "TW", "JP", "KR", "KP", "MN", "SG", "MY", "TH", "VN", "ID", "PH", "MM", "KH", "LA", "BN",
  "IN", "PK", "BD", "LK", "NP", "AU", "NZ", "PG", "FJ",
  // Americas
  "US", "CA", "MX", "BR", "AR", "CL", "CO", "PE", "VE",
  // Europe
  "GB", "IE", "FR", "DE", "NL", "BE", "CH", "AT", "IT", "ES", "PT", "SE", "NO", "FI", "DK", "PL", "CZ", "HU", "RO",
  "BG", "GR", "UA", "BY", "RU", "LT", "LV", "EE",
  // Middle East & Africa
  "TR", "IL", "SA", "AE", "QA", "IR", "IQ", "SY", "EG", "ZA", "NG", "KE", "MA", "DZ",
  // Central Asia
  "KZ", "UZ", "KG", "TJ", "TM", "AF",
] as const;

const cache = new Map<string, Intl.DisplayNames | null>();

export function countryName(code: string, locale: string): string {
  if (!cache.has(locale)) {
    try {
      cache.set(locale, new Intl.DisplayNames([locale], { type: "region" }));
    } catch {
      cache.set(locale, null);
    }
  }
  return cache.get(locale)?.of(code) ?? code;
}
