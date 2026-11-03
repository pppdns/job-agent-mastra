import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

export const MAX_URL_LENGTH = 2048;

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

export type Resolver = (hostname: string) => Promise<string[]>;

const systemResolver: Resolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((r) => r.address);

// Non-public address space: loopback, private, link-local, CGNAT, multicast, reserved, docs.
const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".lan"];

/** True for any address outside public unicast space (IPv4-mapped IPv6 included). */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family !== 6) return true;
  const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return blocked.check(mapped[1], "ipv4");
  return blocked.check(address, "ipv6");
}

/**
 * Validates a URL before any provider is asked to fetch it: http(s) only, default
 * ports, no credentials, no local hostnames, and every DNS answer must be public.
 * Run it again on the provider-reported final URL to cover redirects.
 */
export async function checkUrl(raw: string, resolve: Resolver = systemResolver): Promise<UrlCheck> {
  if (raw.length > MAX_URL_LENGTH) return { ok: false, reason: "URL is too long" };
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "not a valid URL" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: `scheme ${url.protocol} is not allowed` };
  }
  if (url.username || url.password)
    return { ok: false, reason: "URLs with credentials are not allowed" };
  if (url.port && url.port !== "80" && url.port !== "443") {
    return { ok: false, reason: "only default ports are allowed" };
  }

  const host = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (host === "localhost" || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, reason: "local hostnames are not allowed" };
  }
  if (isIP(host)) {
    return isBlockedAddress(host)
      ? { ok: false, reason: "private or reserved addresses are not allowed" }
      : { ok: true, url };
  }
  if (!host.includes(".")) return { ok: false, reason: "hostname must be fully qualified" };

  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    return { ok: false, reason: "hostname does not resolve" };
  }
  if (addresses.length === 0) return { ok: false, reason: "hostname does not resolve" };
  if (addresses.some(isBlockedAddress)) {
    return { ok: false, reason: "hostname resolves to a private or reserved address" };
  }
  return { ok: true, url };
}
