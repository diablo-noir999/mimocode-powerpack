#!/usr/bin/env node
/**
 * jsonc-edit.mjs — add/update/remove the mimocode-powerpack entry in a
 * JSONC config file's "plugin" array, preserving all other config.
 *
 * Usage:
 *   bun scripts/jsonc-edit.mjs add <configFile> <pluginPath> '<optionsJson>'
 *   bun scripts/jsonc-edit.mjs remove <configFile> <pluginPath>
 *
 * Notes:
 * - Parses JSONC leniently: // and /* *\/ comments and trailing commas are
 *   stripped (only outside string literals). The file is written back as
 *   valid JSON with 2-space indent — comments are lost (documented tradeoff).
 * - add: creates the file if missing ($schema + plugin array), updates the
 *   existing entry (matched by plugin path) in place instead of duplicating.
 * - remove: deletes the matching entry; missing file / missing entry is a
 *   no-op success (idempotent).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"

const [action, configFile, pluginPath, optionsJson] = process.argv.slice(2)

if (!["add", "remove"].includes(action) || !configFile || !pluginPath) {
  console.error("Usage: jsonc-edit.mjs add|remove <configFile> <pluginPath> [optionsJson]")
  process.exit(2)
}

// --- JSONC -> JSON sanitizer (string-aware) ---

function stripJsonc(source) {
  let out = ""
  let i = 0
  let inString = false
  let inBlockComment = false
  while (i < source.length) {
    const ch = source[i]
    const next = source[i + 1]
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false
        i += 2
      } else {
        i++
      }
      continue
    }
    if (inString) {
      out += ch
      if (ch === "\\" && next !== undefined) {
        out += next
        i += 2
        continue
      }
      if (ch === '"') inString = false
      i++
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      i++
      continue
    }
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") {
        out += " "
        i++
      }
      continue
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true
      out += "  "
      i += 2
      continue
    }
    if (ch === ",") {
      // Drop trailing comma if followed (after whitespace and comments) by } or ]
      let j = i + 1
      while (j < source.length && (/\s/.test(source[j]) || source[j] === "/" && source[j + 1] === "/")) {
        if (source[j] === "/" && source[j + 1] === "/") {
          while (j < source.length && source[j] !== "\n") j++
        } else {
          j++
        }
      }
      if (source[j] === "}" || source[j] === "]") {
        i++
        continue
      }
      out += ch
      i++
      continue
    }
    out += ch
    i++
  }
  return out
}

// --- Main ---

function loadConfig(file) {
  if (!existsSync(file)) {
    return {
      $schema: "https://mimo.xiaomi.com/mimocode/config.json",
      plugin: [],
    }
  }
  const source = readFileSync(file, "utf-8")
  const cleaned = stripJsonc(source)
  try {
    return JSON.parse(cleaned)
  } catch (err) {
    console.error(`[powerpack] Failed to parse ${file}: ${err.message}`)
    console.error("[powerpack] Config was left untouched.")
    process.exit(1)
  }
}

function saveConfig(file, config) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(config, null, 2) + "\n")
}

function normalizePath(p) {
  // Strip trailing slashes so "path/" and "path" match the same entry
  return p.replace(/\/+$/, "")
}

// Fill `defaults` into `existing` only where keys are missing (deep merge).
// User-set values are preserved across re-installs.
function mergeOptions(existing, defaults) {
  if (existing === undefined || existing === null) return defaults
  if (typeof existing !== "object" || Array.isArray(existing) || typeof defaults !== "object" || Array.isArray(defaults)) {
    return existing
  }
  const out = { ...existing }
  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in out)) {
      out[key] = value
    } else if (typeof value === "object" && value !== null && typeof out[key] === "object" && out[key] !== null) {
      out[key] = mergeOptions(out[key], value)
    }
  }
  return out
}

if (action === "add") {
  if (!optionsJson) {
    console.error("[powerpack] add requires an options JSON argument")
    process.exit(2)
  }
  let options
  try {
    options = JSON.parse(optionsJson)
  } catch (err) {
    console.error(`[powerpack] Invalid options JSON: ${err.message}`)
    process.exit(2)
  }

  const config = loadConfig(configFile)
  if (!Array.isArray(config.plugin)) config.plugin = []

  const path = normalizePath(pluginPath)
  let found = false
  for (const entry of config.plugin) {
    if (Array.isArray(entry) && typeof entry[0] === "string" && normalizePath(entry[0]) === path) {
      const existing = entry[1] && typeof entry[1] === "object" && entry[1].powerpack
        ? entry[1].powerpack
        : undefined
      entry[1] = { powerpack: mergeOptions(existing, options) }
      found = true
      break
    }
  }
  if (!found) {
    config.plugin.push([pluginPath, { powerpack: options }])
  }

  saveConfig(configFile, config)
  console.log(found ? `[powerpack] Updated plugin entry for ${pluginPath} in ${configFile}` : `[powerpack] Added plugin entry for ${pluginPath} to ${configFile}`)
  process.exit(0)
}

if (action === "remove") {
  if (!existsSync(configFile)) {
    console.log(`[powerpack] Config ${configFile} does not exist — nothing to remove`)
    process.exit(0)
  }
  const config = loadConfig(configFile)
  if (!Array.isArray(config.plugin) || config.plugin.length === 0) {
    console.log(`[powerpack] No plugin entries in ${configFile} — nothing to remove`)
    process.exit(0)
  }

  const path = normalizePath(pluginPath)
  const before = config.plugin.length
  config.plugin = config.plugin.filter(
    (entry) => !(Array.isArray(entry) && typeof entry[0] === "string" && normalizePath(entry[0]) === path),
  )

  if (config.plugin.length === before) {
    console.log(`[powerpack] Plugin entry for ${pluginPath} not found in ${configFile} — nothing to remove`)
    process.exit(0)
  }

  saveConfig(configFile, config)
  console.log(`[powerpack] Removed plugin entry for ${pluginPath} from ${configFile}`)
  process.exit(0)
}