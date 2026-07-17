#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, extname, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const sourceExtensions = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx"])
const ignoredDirectories = new Set(["node_modules", ".next", ".turbo", "dist", "coverage", "generated", "archive"])

function sourceFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory)) {
    if (ignoredDirectories.has(entry)) continue
    const absolute = resolve(directory, entry)
    if (statSync(absolute).isDirectory()) files.push(...sourceFiles(absolute))
    else if (sourceExtensions.has(extname(entry))) files.push(absolute)
  }
  return files
}

function areaFor(file) {
  const local = relative(root, file).split(sep)
  if (local[0] === "apps") return { kind: "app", name: local[1], section: local[2] }
  if (local[0] === "packages") return { kind: "package", name: local[1], section: local[2] }
  if (local[0] === "scripts") return { kind: "script", name: "scripts", section: local[1] }
  return { kind: "other", name: local[0], section: local[1] }
}

function importedFile(file, specifier) {
  if (!specifier.startsWith(".")) return null
  return resolve(dirname(file), specifier)
}

export function boundaryViolations(file, source) {
  const violations = []
  const importer = areaFor(file)
  const importPattern = /(?:from\s*|import\s*\(|require\s*\()\s*["']([^"']+)["']/g
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1]
    const targetPath = importedFile(file, specifier)
    const target = targetPath ? areaFor(targetPath) : null
    if ((importer.kind === "package" || importer.kind === "script") && target?.kind === "app") {
      violations.push(`${importer.kind}s must not import app internals: ${specifier}`)
    }
    if (importer.kind === "app" && target?.kind === "app" && target.name !== importer.name) {
      violations.push(`apps must not import another app's internals: ${specifier}`)
    }
    const uiFile = importer.kind === "app" && /^\s*["']use client["']/m.test(source)
    if (uiFile && (specifier === "@life-os/db" || specifier.startsWith("@life-os/db/") || specifier === "@prisma/client")) {
      violations.push(`UI modules must use an app domain/API boundary instead of ${specifier}`)
    }
  }
  return violations
}

const violations = []
for (const directory of ["apps", "packages", "scripts"]) {
  for (const file of sourceFiles(resolve(root, directory))) {
    for (const message of boundaryViolations(file, readFileSync(file, "utf8"))) {
      violations.push(`${relative(root, file)}: ${message}`)
    }
  }
}

if (violations.length) {
  console.error(`Dependency boundary violations (${violations.length}):\n${violations.map(item => `- ${item}`).join("\n")}`)
  process.exitCode = 1
} else {
  console.log("Dependency boundaries: ok")
}
