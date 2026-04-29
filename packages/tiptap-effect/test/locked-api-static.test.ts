import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const here = dirname(fileURLToPath(import.meta.url))
const srcDir = join(here, "..", "src")

const sourceFiles = (dir: string): ReadonlyArray<string> =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(entry) ? [path] : []
  })

const allSource = (): string =>
  sourceFiles(srcDir)
    .map((path) => readFileSync(path, "utf8"))
    .join("\n")

describe("locked API static guards", () => {
  it("does not use React forceUpdate or random remount keys", () => {
    const source = allSource()
    expect(source).not.toContain("forceUpdate")
    expect(source).not.toMatch(/key=\{(?:Math\.random|Date\.now)\(/)
  })

  it("does not schedule editor destruction with setTimeout", () => {
    const source = allSource()
    expect(source).not.toMatch(/setTimeout\s*\([^)]*destroy/)
  })
})
