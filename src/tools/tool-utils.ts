/**
 * Shared utilities for tool implementations.
 */

/**
 * Resolve the project path from context. Falls back to process.cwd().
 */
export function resolveProjectPath(context: any): string {
  return context?.directory ?? process.cwd()
}
