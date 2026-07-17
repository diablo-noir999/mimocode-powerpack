/**
 * Shared utilities for team module.
 *
 * Used by both mailbox and tasklist for filesystem operations.
 */

import { mkdir } from "node:fs/promises"

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
}
