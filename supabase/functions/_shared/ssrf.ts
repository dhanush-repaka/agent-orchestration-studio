const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "metadata.google.internal",
  "metadata.google.com",
]);

function ipv4FromNumber(n: number): [number, number, number, number] | null {
  if (!Number.isFinite(n) || n < 0 || n > 0xffffffff) return null;
  const v = n >>> 0;
  return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
}

function parseIpv4(host: string): [number, number, number, number] | null {
  if (/^\d+$/.test(host)) return ipv4FromNumber(Number(host));
  if (/^0x[0-9a-f]+$/i.test(host)) return ipv4FromNumber(parseInt(host, 16));
  const dotted = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (dotted) {
    const parts = dotted.slice(1, 5).map((part) => {
      if (part.startsWith("0") && part.length > 1 && !part.startsWith("0x")) return parseInt(part, 8);
      return Number(part);
    });
    if (parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
      return parts as [number, number, number, number];
    }
  }
  return null;
}

function isPrivateIpv4(parts: [number, number, number, number]): boolean {
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "::1" || h === "::") return true;
  if (h.startsWith("fe80:") || h.startsWith("fe80::")) return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true;
  const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i) || h.match(/^::ffff:([0-9a-f:.]+)$/i);
  if (mapped) {
    const mappedHost = mapped[1];
    const ipv4 = parseIpv4(mappedHost);
    if (ipv4) return isPrivateIpv4(ipv4);
    if (mappedHost.includes(":")) {
      const hex = mappedHost.split(":");
      if (hex.length === 2) {
        const hi = parseInt(hex[0], 16);
        const lo = parseInt(hex[1], 16);
        if (Number.isFinite(hi) && Number.isFinite(lo)) {
          return isPrivateIpv4([(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255]);
        }
      }
    }
  }
  return false;
}

export function isBlockedHostname(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (!normalized) return true;
  if (BLOCKED_HOSTS.has(normalized) || normalized.endsWith(".localhost") || normalized.endsWith(".local")) return true;
  const ipv4 = parseIpv4(normalized);
  if (ipv4 && isPrivateIpv4(ipv4)) return true;
  if (normalized.includes(":") && isPrivateIpv6(normalized)) return true;
  return false;
}

export function hostnameAllowedForCredential(host: string, allowedHost: string): boolean {
  const target = host.trim().toLowerCase().replace(/\.$/, "");
  const allowed = allowedHost.trim().toLowerCase().replace(/\.$/, "");
  if (!target || !allowed) return false;
  return target === allowed || target.endsWith(`.${allowed}`);
}

export function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  const len = Math.max(left.length, right.length, 1);
  let diff = left.length ^ right.length;
  for (let i = 0; i < len; i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

export function serverAdoOrg(): string {
  let clean = (Deno.env.get("ADO_ORG") || "aiqenexus").trim();
  if (clean.includes("://")) {
    const afterDomain = clean.split("/").slice(3).filter(Boolean);
    clean = afterDomain[0] ?? "";
  }
  clean = clean.replace(/[^a-zA-Z0-9_-]/g, "");
  return clean || "aiqenexus";
}
