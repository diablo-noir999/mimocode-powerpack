/**
 * Code Review Server
 *
 * Adapted from dev/plannotator/packages/server/review.ts.
 * Provides diff viewer, annotation, and git-staging APIs.
 * Serves pre-built HTML assets for the browser-based review UI.
 *
 * Data stored in .powerpack/review/ directory.
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync } from "node:fs"
import { join, basename, resolve, relative } from "node:path"
import { $ } from "bun"

// --- Security: In-memory rate limiter ---

interface RateLimitEntry { count: number; resetAt: number }

const rateLimitMap = new Map<string, RateLimitEntry>()
const RATE_LIMIT_WINDOW_MS = 60_000 // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 30 // max POSTs per window per IP

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return false
  }
  entry.count++
  return entry.count > RATE_LIMIT_MAX_REQUESTS
}

// --- Security: File path validation ---

function isPathWithinWorkspace(filePath: string, workspace: string): boolean {
  // Resolve both paths to absolute and check containment
  // Uses resolve() to normalize and resolve relative paths
  const resolvedFile = resolve(workspace, filePath)
  const resolvedWorkspace = resolve(workspace)
  // Check if the resolved file path starts with the workspace path
  return resolvedFile === resolvedWorkspace || resolvedFile.startsWith(resolvedWorkspace + "/") || resolvedFile.startsWith(resolvedWorkspace + "\\")
}

// --- Types ---

export interface ReviewSession {
  id: string
  rawPatch: string
  gitRef: string
  diffType: string
  error?: string
  annotations: ReviewAnnotation[]
  feedback: string
  approved: boolean
  stagedFiles: Set<string>
  createdAt: number
  workspace: string
}

export interface ReviewAnnotation {
  id: string
  filePath: string
  lineNumber?: number
  side?: "left" | "right"
  text: string
  type: "comment" | "suggestion" | "issue"
  createdAt: number
}

export interface ReviewServerOptions {
  port?: number
  dataDir?: string
  htmlContent: string
  onReady?: (url: string, port: number) => void
}

export interface ReviewServerResult {
  port: number
  url: string
  stop: () => void
}

// --- Session Store ---

const sessions = new Map<string, ReviewSession>()

function getDataDir(dataDir?: string): string {
  const dir = dataDir ?? join(process.cwd(), ".powerpack", "review")
  mkdirSync(dir, { recursive: true })
  return dir
}

function saveSession(session: ReviewSession): void {
  const dir = getDataDir()
  const sessionDir = join(dir, session.id)
  mkdirSync(sessionDir, { recursive: true })
  writeFileSync(join(sessionDir, "session.json"), JSON.stringify({
    ...session,
    stagedFiles: Array.from(session.stagedFiles),
  }, null, 2))
}

function loadSession(id: string): ReviewSession | null {
  // SECURITY: Validate session ID format to prevent path traversal
  // Session IDs should only contain alphanumeric characters, hyphens, and underscores
  if (!/^review-\d+-[a-z0-9]+$/.test(id)) {
    return null // Invalid session ID format
  }
  const dir = getDataDir()
  const sessionFile = join(dir, id, "session.json")
  if (!existsSync(sessionFile)) return null
  try {
    const data = JSON.parse(readFileSync(sessionFile, "utf-8"))
    data.stagedFiles = new Set(data.stagedFiles ?? [])
    return data
  } catch {
    return null
  }
}

function listSessions(): string[] {
  const dir = getDataDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(name => {
    try {
      return existsSync(join(dir, name, "session.json"))
    } catch {
      return false
    }
  })
}

// --- Git Diff Helpers ---

async function runGitDiff(cwd: string, ref?: string): Promise<{ patch: string; error?: string }> {
  try {
    const result = await $`git diff ${ref ?? "HEAD"}`.cwd(cwd).text()
    return { patch: result }
  } catch (err) {
    return { patch: "", error: err instanceof Error ? err.message : String(err) }
  }
}

async function runGitDiffUnstaged(cwd: string): Promise<{ patch: string; error?: string }> {
  try {
    const result = await $`git diff`.cwd(cwd).text()
    return { patch: result }
  } catch (err) {
    return { patch: "", error: err instanceof Error ? err.message : String(err) }
  }
}

async function runGitDiffStaged(cwd: string): Promise<{ patch: string; error?: string }> {
  try {
    const result = await $`git diff --cached`.cwd(cwd).text()
    return { patch: result }
  } catch (err) {
    return { patch: "", error: err instanceof Error ? err.message : String(err) }
  }
}

async function runGitStatus(cwd: string): Promise<string> {
  try {
    return await $`git status --porcelain`.cwd(cwd).text()
  } catch {
    return ""
  }
}

async function stageFileInGit(cwd: string, filePath: string): Promise<{ ok: boolean; error?: string }> {
  // SECURITY: Validate file path is within cwd to prevent path traversal
  if (!isPathWithinWorkspace(filePath, cwd)) {
    return { ok: false, error: "File path outside workspace" }
  }
  try {
    await $`git add ${filePath}`.cwd(cwd).text()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function unstageFileInGit(cwd: string, filePath: string): Promise<{ ok: boolean; error?: string }> {
  // SECURITY: Validate file path is within cwd to prevent path traversal
  if (!isPathWithinWorkspace(filePath, cwd)) {
    return { ok: false, error: "File path outside workspace" }
  }
  try {
    await $`git reset HEAD ${filePath}`.cwd(cwd).text()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function getGitDiffFiles(cwd: string, ref?: string): Promise<string[]> {
  try {
    const result = await $`git diff --name-only ${ref ?? "HEAD"}`.cwd(cwd).text()
    return result.split("\n").filter(Boolean)
  } catch {
    return []
  }
}

async function getFileContentAtRef(cwd: string, filePath: string, ref?: string): Promise<string | null> {
  try {
    return await $`git show ${ref ?? "HEAD"}:${filePath}`.cwd(cwd).text()
  } catch {
    return null
  }
}

async function getWorkingTreeFileContent(cwd: string, filePath: string): Promise<string | null> {
  // SECURITY: Validate file path is within cwd to prevent path traversal
  if (!isPathWithinWorkspace(filePath, cwd)) return null
  try {
    return await $`cat ${filePath}`.cwd(cwd).text()
  } catch {
    return null
  }
}

// --- Diff Parsing ---

interface DiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  content: string
}

interface DiffFile {
  path: string
  oldPath?: string
  status: "added" | "deleted" | "modified" | "renamed"
  hunks: DiffHunk[]
  oldContent?: string
  newContent?: string
}

function parsePatch(patch: string): DiffFile[] {
  const files: DiffFile[] = []
  const fileSections = patch.split(/^diff --git /m).filter(Boolean)

  for (const section of fileSections) {
    const lines = section.split("\n")
    if (lines.length === 0) continue

    // Parse file paths from first line: "a/path b/path"
    const pathMatch = lines[0].match(/^a\/(.+?) b\/(.+)$/)
    if (!pathMatch) continue

    const [, oldPath, newPath] = pathMatch
    let status: DiffFile["status"] = "modified"
    let path = newPath

    if (lines[1]?.startsWith("new file")) {
      status = "added"
    } else if (lines[1]?.startsWith("deleted file")) {
      status = "deleted"
      path = oldPath
    } else if (lines[1]?.startsWith("rename from")) {
      status = "renamed"
    }

    const hunks: DiffHunk[] = []
    let currentHunk: DiffHunk | null = null

    for (let i = 1; i < lines.length; i++) {
      const hunkMatch = lines[i].match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
      if (hunkMatch) {
        if (currentHunk) hunks.push(currentHunk)
        currentHunk = {
          oldStart: parseInt(hunkMatch[1]),
          oldLines: parseInt(hunkMatch[2] ?? "1"),
          newStart: parseInt(hunkMatch[3]),
          newLines: parseInt(hunkMatch[4] ?? "1"),
          content: "",
        }
      } else if (currentHunk) {
        currentHunk.content += lines[i] + "\n"
      }
    }
    if (currentHunk) hunks.push(currentHunk)

    files.push({ path, oldPath: oldPath !== newPath ? oldPath : undefined, status, hunks })
  }

  return files
}

// --- HTML Serving ---

function loadReviewHtml(): string {
  const candidates = [
    join(import.meta.dir, "ui", "index.html"),
    join(process.cwd(), "src", "review", "ui", "index.html"),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, "utf-8")
    }
  }
  return getDefaultHtml()
}

function getDefaultHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MiMoCode Review</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #c9d1d9; }
    .header { padding: 16px 24px; border-bottom: 1px solid #30363d; display: flex; justify-content: space-between; align-items: center; }
    .header h1 { font-size: 20px; font-weight: 600; }
    .actions { display: flex; gap: 8px; }
    .btn { padding: 8px 16px; border-radius: 6px; border: 1px solid #30363d; cursor: pointer; font-size: 14px; font-weight: 500; }
    .btn-primary { background: #238636; color: white; border-color: #238636; }
    .btn-primary:hover { background: #2ea043; }
    .btn-danger { background: #da3633; color: white; border-color: #da3633; }
    .btn-danger:hover { background: #f85149; }
    .btn-secondary { background: #21262d; color: #c9d1d9; }
    .btn-secondary:hover { background: #30363d; }
    .container { max-width: 1200px; margin: 0 auto; padding: 24px; }
    .file-section { margin-bottom: 24px; border: 1px solid #30363d; border-radius: 6px; overflow: hidden; }
    .file-header { padding: 12px 16px; background: #161b22; border-bottom: 1px solid #30363d; display: flex; justify-content: space-between; align-items: center; }
    .file-path { font-family: monospace; font-size: 14px; color: #58a6ff; }
    .file-status { font-size: 12px; padding: 2px 8px; border-radius: 12px; font-weight: 500; }
    .file-status.added { background: #238636; color: white; }
    .file-status.deleted { background: #da3633; color: white; }
    .file-status.modified { background: #9e6a03; color: white; }
    .diff-table { width: 100%; border-collapse: collapse; font-family: monospace; font-size: 13px; }
    .diff-table td { padding: 0 12px; white-space: pre; vertical-align: top; }
    .diff-table .line-no { width: 50px; text-align: right; color: #484f58; user-select: none; }
    .diff-table .line-content { width: 100%; }
    .diff-line.added { background: #12261e; }
    .diff-line.removed { background: #2d1215; }
    .diff-line.added .line-content { color: #3fb950; }
    .diff-line.removed .line-content { color: #f85149; }
    .diff-line.context .line-content { color: #8b949e; }
    .annotation-btn { background: none; border: none; color: #484f58; cursor: pointer; font-size: 14px; padding: 0 4px; }
    .annotation-btn:hover { color: #58a6ff; }
    .annotation-form { padding: 12px 16px; background: #161b22; border-top: 1px solid #30363d; display: none; }
    .annotation-form.active { display: block; }
    .annotation-form textarea { width: 100%; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; padding: 8px; font-size: 14px; resize: vertical; min-height: 60px; }
    .annotation-form .form-actions { display: flex; gap: 8px; margin-top: 8px; justify-content: flex-end; }
    .annotation-badge { background: #1f6feb; color: white; font-size: 11px; padding: 1px 6px; border-radius: 10px; margin-left: 8px; }
    .empty-state { text-align: center; padding: 60px 24px; color: #8b949e; }
    .empty-state h2 { margin-bottom: 12px; }
    .staging-toggle { cursor: pointer; }
    .staging-toggle.staged { color: #3fb950; }
    .panel { margin-bottom: 24px; }
    .panel-header { padding: 12px 16px; background: #161b22; border: 1px solid #30363d; border-radius: 6px 6px 0 0; font-weight: 600; }
    .panel-body { border: 1px solid #30363d; border-top: none; border-radius: 0 0 6px 6px; padding: 16px; }
    .annotations-list { list-style: none; }
    .annotations-list li { padding: 8px 12px; border-bottom: 1px solid #21262d; display: flex; gap: 12px; }
    .annotations-list li:last-child { border-bottom: none; }
    .annotation-file { color: #58a6ff; font-family: monospace; font-size: 13px; }
    .annotation-text { flex: 1; }
    .review-complete { padding: 24px; text-align: center; }
    .review-complete h2 { color: #3fb950; margin-bottom: 8px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>MiMoCode Review</h1>
    <div class="actions" id="actions">
      <button class="btn btn-primary" onclick="submitApproval(true)">Approve</button>
      <button class="btn btn-danger" onclick="submitApproval(false)">Request Changes</button>
    </div>
  </div>
  <div class="container" id="content">
    <div class="empty-state">Loading review...</div>
  </div>
  <script>
    let reviewData = null;
    let annotations = [];

    async function init() {
      try {
        const res = await fetch('/api/diff');
        reviewData = await res.json();
        if (reviewData.error) {
          document.getElementById('content').innerHTML = '<div class="empty-state"><h2>Error</h2><p>' + escapeHtml(reviewData.error) + '</p></div>';
          return;
        }
        renderDiff(reviewData);
      } catch (err) {
        document.getElementById('content').innerHTML = '<div class="empty-state"><h2>Failed to load review</h2><p>' + escapeHtml(err.message) + '</p></div>';
      }
    }

    function renderDiff(data) {
      const container = document.getElementById('content');
      if (!data.files || data.files.length === 0) {
        container.innerHTML = '<div class="empty-state"><h2>No changes</h2><p>There are no changes to review.</p></div>';
        return;
      }

      let html = '';
      for (const file of data.files) {
        html += renderFile(file);
      }
      container.innerHTML = html;
    }

    function renderFile(file) {
      const statusClass = file.status;
      let diffHtml = '';
      let lineNo = 0;

      for (const hunk of file.hunks) {
        const lines = hunk.content.split('\\n').filter(l => l.length > 0 || true);
        for (const line of lines) {
          lineNo++;
          let className = 'context';
          let prefix = ' ';
          let oldLineNo = hunk.oldStart + lineNo - 1;
          let newLineNo = hunk.newStart + lineNo - 1;

          if (line.startsWith('+')) {
            className = 'added';
            prefix = '+';
          } else if (line.startsWith('-')) {
            className = 'removed';
            prefix = '-';
          }

          const displayLine = line.slice(1) || ' ';
          diffHtml += '<tr class="diff-line ' + className + '" data-file="' + file.path + '" data-line="' + lineNo + '">'
            + '<td class="line-no">' + (className === 'removed' ? oldLineNo : (className === 'added' ? '' : oldLineNo)) + '</td>'
            + '<td class="line-no">' + (className === 'added' ? newLineNo : (className === 'removed' ? '' : newLineNo)) + '</td>'
            + '<td class="line-content">' + escapeHtml(prefix + displayLine) + '</td>'
            + '<td><button class="annotation-btn" onclick="toggleAnnotation(this, \\'' + file.path + '\\', ' + lineNo + ')" title="Add comment">+</button></td>'
            + '</tr>';
        }
        lineNo = 0;
      }

      return '<div class="file-section">'
        + '<div class="file-header">'
        + '<span class="file-path">' + escapeHtml(file.path) + '</span>'
        + '<span class="file-status ' + statusClass + '">' + statusClass + '</span>'
        + '</div>'
        + '<table class="diff-table"><tbody>' + diffHtml + '</tbody></table>'
        + '<div class="annotation-form" id="form-' + file.path.replace(/[^a-zA-Z0-9]/g, '-') + '">'
        + '<textarea placeholder="Leave a comment..."></textarea>'
        + '<div class="form-actions">'
        + '<button class="btn btn-secondary" onclick="closeAnnotation(this)">Cancel</button>'
        + '<button class="btn btn-primary" onclick="submitAnnotation(this, \\'' + file.path + '\\')">Comment</button>'
        + '</div></div>'
        + '</div>';
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function toggleAnnotation(btn, filePath, lineNo) {
      const form = btn.closest('.file-section').querySelector('.annotation-form');
      form.classList.toggle('active');
      if (form.classList.contains('active')) {
        form.querySelector('textarea').focus();
        form.dataset.filePath = filePath;
        form.dataset.lineNo = lineNo;
      }
    }

    function closeAnnotation(btn) {
      btn.closest('.annotation-form').classList.remove('active');
    }

    async function submitAnnotation(btn, filePath) {
      const form = btn.closest('.annotation-form');
      const text = form.querySelector('textarea').value.trim();
      if (!text) return;

      try {
        await fetch('/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'annotation',
            filePath,
            lineNumber: parseInt(form.dataset.lineNo),
            text,
          }),
        });
        form.classList.remove('active');
        form.querySelector('textarea').value = '';
        // Show annotation badge
        const badge = document.createElement('span');
        badge.className = 'annotation-badge';
        badge.textContent = text.slice(0, 30) + (text.length > 30 ? '...' : '');
        const header = document.querySelector('.file-header');
        if (header) header.appendChild(badge);
      } catch (err) {
        alert('Failed to submit annotation: ' + err.message);
      }
    }

    async function submitApproval(approved) {
      let feedback = '';
      if (!approved) {
        feedback = prompt('Please describe the changes requested:');
        if (feedback === null) return;
      }

      try {
        await fetch('/api/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approved, feedback }),
        });
        document.getElementById('content').innerHTML = '<div class="review-complete">'
          + '<h2>' + (approved ? 'Review Approved' : 'Changes Requested') + '</h2>'
          + '<p>' + (approved ? 'The review has been approved.' : 'Feedback has been sent to the agent.') + '</p>'
          + '</div>';
        document.getElementById('actions').innerHTML = '<span style="color: #8b949e;">Review complete</span>';
      } catch (err) {
        alert('Failed to submit: ' + err.message);
      }
    }

    init();
  </script>
</body>
</html>`
}

// --- Server ---

const MAX_RETRIES = 5
const RETRY_DELAY_MS = 500

export async function startReviewServer(
  options: ReviewServerOptions
): Promise<ReviewServerResult> {
  const { port: requestedPort, dataDir, htmlContent, onReady } = options

  let server: ReturnType<typeof Bun.serve> | null = null
  let port = requestedPort ?? 5174

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      server = Bun.serve({
        port,
        idleTimeout: 0,

        async fetch(req) {
          const url = new URL(req.url)

          // API: Get diff data for active review session
          if (url.pathname === "/api/diff" && req.method === "GET") {
            const sessionId = url.searchParams.get("session")
            if (!sessionId) {
              return Response.json({ error: "Missing session parameter" }, { status: 400 })
            }
            // SECURITY: Validate session ID format before use
            if (!/^review-\d+-[a-z0-9]+$/.test(sessionId)) {
              return Response.json({ error: "Invalid session ID format" }, { status: 400 })
            }
            const session = sessions.get(sessionId) ?? loadSession(sessionId)
            if (!session) {
              return Response.json({ error: "Session not found" }, { status: 404 })
            }
            return Response.json({
              rawPatch: session.rawPatch,
              gitRef: session.gitRef,
              diffType: session.diffType,
              error: session.error,
              files: parsePatch(session.rawPatch),
              annotations: session.annotations,
              stagedFiles: Array.from(session.stagedFiles),
              workspace: session.workspace,
            })
          }

          // API: Submit feedback/annotation
          if (url.pathname === "/api/feedback" && req.method === "POST") {
            // SECURITY: Rate limit POST endpoints to prevent abuse
            const clientIp = req.headers.get("x-forwarded-for") ?? "local"
            if (isRateLimited(clientIp)) {
              return Response.json({ error: "Rate limit exceeded" }, { status: 429 })
            }
            try {
              const body = (await req.json()) as {
                session?: string
                type?: string
                filePath?: string
                lineNumber?: number
                text?: string
                feedback?: string
              }
              const sessionId = body.session
              if (!sessionId) {
                return Response.json({ error: "Missing session" }, { status: 400 })
              }
              const session = sessions.get(sessionId) ?? loadSession(sessionId)
              if (!session) {
                return Response.json({ error: "Session not found" }, { status: 404 })
              }

              if (body.type === "annotation" && body.filePath && body.text) {
                session.annotations.push({
                  id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                  filePath: body.filePath,
                  lineNumber: body.lineNumber,
                  text: body.text,
                  type: "comment",
                  createdAt: Date.now(),
                })
              } else if (body.feedback) {
                session.feedback = body.feedback
              }

              saveSession(session)
              return Response.json({ ok: true })
            } catch {
              return Response.json({ error: "Invalid request" }, { status: 400 })
            }
          }

          // API: Approve/deny review
          if (url.pathname === "/api/approve" && req.method === "POST") {
            // SECURITY: Rate limit POST endpoints to prevent abuse
            const clientIp = req.headers.get("x-forwarded-for") ?? "local"
            if (isRateLimited(clientIp)) {
              return Response.json({ error: "Rate limit exceeded" }, { status: 429 })
            }
            try {
              const body = (await req.json()) as {
                session?: string
                approved: boolean
                feedback?: string
              }
              const sessionId = body.session
              if (!sessionId) {
                return Response.json({ error: "Missing session" }, { status: 400 })
              }
              const session = sessions.get(sessionId) ?? loadSession(sessionId)
              if (!session) {
                return Response.json({ error: "Session not found" }, { status: 404 })
              }

              session.approved = body.approved
              session.feedback = body.feedback ?? session.feedback
              saveSession(session)
              return Response.json({ ok: true })
            } catch {
              return Response.json({ error: "Invalid request" }, { status: 400 })
            }
          }

          // API: Stage/unstage files
          if (url.pathname === "/api/git-add" && req.method === "POST") {
            // SECURITY: Rate limit POST endpoints to prevent abuse
            const clientIp = req.headers.get("x-forwarded-for") ?? "local"
            if (isRateLimited(clientIp)) {
              return Response.json({ error: "Rate limit exceeded" }, { status: 429 })
            }
            try {
              const body = (await req.json()) as {
                session?: string
                filePath: string
                undo?: boolean
              }
              const sessionId = body.session
              if (!sessionId) {
                return Response.json({ error: "Missing session" }, { status: 400 })
              }
              const session = sessions.get(sessionId) ?? loadSession(sessionId)
              if (!session) {
                return Response.json({ error: "Session not found" }, { status: 404 })
              }

              // SECURITY: Validate filePath is within the session's workspace to prevent path traversal
              if (!isPathWithinWorkspace(body.filePath, session.workspace)) {
                return Response.json({ error: "File path is outside workspace" }, { status: 403 })
              }

              let result: { ok: boolean; error?: string }
              if (body.undo) {
                result = await unstageFileInGit(session.workspace, body.filePath)
                session.stagedFiles.delete(body.filePath)
              } else {
                result = await stageFileInGit(session.workspace, body.filePath)
                session.stagedFiles.add(body.filePath)
              }

              saveSession(session)
              return Response.json(result)
            } catch {
              // SECURITY: Don't expose internal error details to client
              return Response.json({ error: "Failed to stage file" }, { status: 500 })
            }
          }

          // API: Get annotation drafts
          if (url.pathname === "/api/draft" && req.method === "GET") {
            const sessionId = url.searchParams.get("session")
            if (!sessionId) {
              return Response.json({ annotations: [] })
            }
            const session = sessions.get(sessionId) ?? loadSession(sessionId)
            return Response.json({ annotations: session?.annotations ?? [] })
          }

          // Favicon
          if (url.pathname === "/favicon.svg") {
            return new Response(
              '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🔍</text></svg>',
              { headers: { "Content-Type": "image/svg+xml" } }
            )
          }

          // Serve HTML for all other routes (SPA fallback)
          // SECURITY: Add security headers to all HTML responses
          return new Response(htmlContent, {
            headers: {
              "Content-Type": "text/html",
              "X-Content-Type-Options": "nosniff",
              "X-Frame-Options": "DENY",
              "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'",
              "Referrer-Policy": "no-referrer",
            },
          })
        },

        error(err) {
          // SECURITY: Log error details server-side only, return generic message
          console.error("[review-server] Error:", err)
          return new Response(
            "Internal Server Error",
            { status: 500, headers: { "Content-Type": "text/plain" } }
          )
        },
      })

      break // Success
    } catch (err: unknown) {
      const isAddressInUse = err instanceof Error && err.message.includes("EADDRINUSE")
      if (isAddressInUse && attempt < MAX_RETRIES) {
        port++
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
        continue
      }
      throw err
    }
  }

  if (!server) {
    throw new Error("Failed to start review server")
  }

  const actualPort = server.port!
  const serverUrl = `http://localhost:${actualPort}`

  if (onReady) {
    onReady(serverUrl, actualPort)
  }

  return {
    port: actualPort,
    url: serverUrl,
    stop: () => server?.stop(),
  }
}

// --- Session Management ---

export function createReviewSession(
  workspace: string,
  rawPatch: string,
  gitRef: string,
  diffType: string = "uncommitted",
  error?: string
): ReviewSession {
  const id = `review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const session: ReviewSession = {
    id,
    rawPatch,
    gitRef,
    diffType,
    error,
    annotations: [],
    feedback: "",
    approved: false,
    stagedFiles: new Set(),
    createdAt: Date.now(),
    workspace,
  }
  sessions.set(id, session)
  saveSession(session)
  return session
}

export function getReviewSession(id: string): ReviewSession | null {
  return sessions.get(id) ?? loadSession(id)
}

export function getSessionAnnotations(id: string): ReviewAnnotation[] {
  const session = getReviewSession(id)
  return session?.annotations ?? []
}

// --- Git Helpers Export ---

export {
  runGitDiff,
  runGitDiffUnstaged,
  runGitDiffStaged,
  runGitStatus,
  getGitDiffFiles,
  parsePatch,
  loadReviewHtml,
}
