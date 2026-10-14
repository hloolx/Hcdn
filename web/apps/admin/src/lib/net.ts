// IP / CIDR / hostname validation used by forms (client-side hints; the API re-validates).

const V4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export function isIPv4(s: string): boolean {
  return V4.test(s);
}

export function isIPv6(s: string): boolean {
  if (!s.includes(":") || !/^[0-9a-fA-F:.]+$/.test(s)) return false;
  const dbl = s.split("::");
  if (dbl.length > 2) return false;
  const groups = (part: string) => (part === "" ? [] : part.split(":"));
  const head = groups(dbl[0] ?? "");
  const tail = dbl.length === 2 ? groups(dbl[1] ?? "") : [];
  const all = [...head, ...tail];
  let count = all.length;
  const last = all[all.length - 1];
  if (last && last.includes(".")) {
    if (!isIPv4(last)) return false;
    count += 1; // embedded IPv4 takes two groups
    all.pop();
  }
  if (!all.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return false;
  return dbl.length === 2 ? count < 8 : count === 8;
}

export function isIP(s: string): boolean {
  return isIPv4(s) || isIPv6(s);
}

/** IP or CIDR (v4 /0-32, v6 /0-128). */
export function isIPOrCidr(s: string): boolean {
  const [ip, bits, extra] = s.split("/");
  if (extra !== undefined || !ip) return false;
  if (bits === undefined) return isIP(ip);
  if (!/^\d{1,3}$/.test(bits)) return false;
  const n = Number(bits);
  if (isIPv4(ip)) return n <= 32;
  if (isIPv6(ip)) return n <= 128;
  return false;
}

export function isHostname(s: string): boolean {
  return /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(s);
}

export function isDnsLabel(s: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(s);
}

/** Map pin coordinates for a node region label (e.g. "日本 · 东京"). */
const CITY_COORDS: { match: RegExp; label: string; labelEn: string; lon: number; lat: number }[] = [
  { match: /东京|tokyo/i, label: "东京", labelEn: "Tokyo", lon: 139.69, lat: 35.69 },
  { match: /大阪|osaka/i, label: "大阪", labelEn: "Osaka", lon: 135.5, lat: 34.69 },
  { match: /洛杉矶|los angeles/i, label: "洛杉矶", labelEn: "Los Angeles", lon: -118.24, lat: 34.05 },
  { match: /圣何塞|san jose/i, label: "圣何塞", labelEn: "San Jose", lon: -121.89, lat: 37.34 },
  { match: /香港|hong kong/i, label: "香港", labelEn: "Hong Kong", lon: 114.17, lat: 22.32 },
  { match: /新加坡|singapore/i, label: "新加坡", labelEn: "Singapore", lon: 103.82, lat: 1.35 },
  { match: /首尔|seoul/i, label: "首尔", labelEn: "Seoul", lon: 126.98, lat: 37.57 },
  { match: /台北|taipei/i, label: "台北", labelEn: "Taipei", lon: 121.56, lat: 25.04 },
  { match: /悉尼|sydney/i, label: "悉尼", labelEn: "Sydney", lon: 151.21, lat: -33.87 },
  { match: /法兰克福|frankfurt/i, label: "法兰克福", labelEn: "Frankfurt", lon: 8.68, lat: 50.11 },
];

export function cityOf(region: string) {
  return CITY_COORDS.find((c) => c.match.test(region)) ?? null;
}
