import type { Cert } from "@hcdn/api/types";
import type { StatusTone } from "@hcdn/ui/blocks/status";
import { daysUntil } from "@hcdn/ui/lib/format";

/** Does a certificate name (possibly wildcard) cover a host? */
export function certCovers(names: string[], host: string): boolean {
  return names.some((n) => {
    if (n === host) return true;
    if (n.startsWith("*.")) {
      const suffix = n.slice(1); // ".example.com"
      return host.endsWith(suffix) && !host.slice(0, -suffix.length).includes(".") && host.length > suffix.length;
    }
    return false;
  });
}

export function uncovered(cert: Pick<Cert, "domains">, hosts: string[]) {
  return hosts.filter((h) => !certCovers(cert.domains, h));
}

/** Remaining validity, with a tone for the "剩余 N 天" label. */
export function certExpiry(cert: Pick<Cert, "notAfter">): { days: number; tone: StatusTone } {
  const days = daysUntil(cert.notAfter) ?? 0;
  return { days, tone: days < 0 ? "danger" : days <= 7 ? "danger" : days <= 30 ? "warning" : "success" };
}
