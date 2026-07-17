/**
 * Shared hashline utilities.
 *
 * Content-hash computation shared between the hashline-edit tool
 * and the hashline-read-enhancer hook.
 */

const HASH_CHARS = "ZPMQVRWSNKTXJBYH"

export function computeLineHash(content: string): string {
  // FNV-1a 32-bit hash — much faster than SHA-256 for short strings
  let hash = 0x811c9dc5 // FNV offset basis
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) // FNV prime
  }
  // Convert to unsigned 32-bit
  hash = hash >>> 0
  const nibbles: string[] = []
  for (let i = 0; i < 4; i++) {
    const byte = (hash >>> (i * 8)) & 0xff
    nibbles.push(HASH_CHARS[(byte >> 4) & 0x0f])
    nibbles.push(HASH_CHARS[byte & 0x0f])
  }
  return nibbles.join("")
}
