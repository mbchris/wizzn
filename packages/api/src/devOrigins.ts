import { networkInterfaces } from 'node:os'

/** Current private IPv4 addresses of this machine (Wi-Fi/Ethernet), e.g. ['192.168.180.60']. */
export function lanIPv4s(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i!.address)
    .filter((a) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a))
}

/** Dev only: origins of the Quasar dev servers (web :9000, admin :9100) reached via the LAN IP, e.g. from a phone. */
export function devLanOrigins(ports = [9000, 9100]): string[] {
  return lanIPv4s().flatMap((ip) => ports.map((p) => `http://${ip}:${p}`))
}
