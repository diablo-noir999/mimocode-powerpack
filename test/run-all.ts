/**
 * Comprehensive test runner for mimocode-powerpack
 * Runs all test files and reports results
 */

import { execSync } from "node:child_process"
import { readdirSync } from "node:fs"
import { join } from "node:path"

const testDir = join(import.meta.dir, ".")
const testFiles = readdirSync(testDir).filter(f => f.startsWith("test-") && f.endsWith(".ts"))

console.log(`\n🧪 Running ${testFiles.length} test suites...\n`)

const results: { name: string; passed: boolean; output: string }[] = []

for (const file of testFiles) {
  const name = file.replace("test-", "").replace(".ts", "")
  console.log(`\n${"=".repeat(60)}`)
  console.log(`Running: ${name}`)
  console.log(`${"=".repeat(60)}`)
  
  try {
    const output = execSync(`bun run ${join(testDir, file)}`, {
      encoding: "utf-8",
      timeout: 60000,
      stdio: ["pipe", "pipe", "pipe"],
    })
    console.log(output)
    results.push({ name, passed: true, output })
  } catch (err: any) {
    const output = err.stdout || err.stderr || err.message
    console.log(output)
    results.push({ name, passed: false, output })
  }
}

console.log(`\n${"=".repeat(60)}`)
console.log("SUMMARY")
console.log(`${"=".repeat(60)}`)

let totalPassed = 0
let totalFailed = 0

for (const r of results) {
  const status = r.passed ? "✅ PASS" : "❌ FAIL"
  console.log(`${status}  ${r.name}`)
  if (r.passed) totalPassed++
  else totalFailed++
}

console.log(`\n${totalPassed} passed, ${totalFailed} failed out of ${results.length} suites`)
process.exit(totalFailed > 0 ? 1 : 0)
