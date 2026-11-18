#!/usr/bin/env node
/**
 * 版本一致性检查（CI 用，无第三方依赖）。
 *
 * 三处版本号必须对得上，否则会出现「设置页显示 3.0.1、装上去还是 3.0.0」或者
 * 「versionCode 没加，系统不让覆盖安装」这类线上事故：
 *   1. frontend/package.json        → version
 *   2. frontend/android/app/build.gradle → versionName
 *   3. 同上                          → versionCode（必须是递增的正整数）
 *
 * 用法：
 *   node scripts/check-version.mjs            # 只校验三处一致
 *   node scripts/check-version.mjs v3.0.1     # 打 tag 时额外校验 tag 与版本号一致
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fail = (message) => {
  console.error(`✗ ${message}`)
  process.exit(1)
}

const pkg = JSON.parse(readFileSync(resolve(root, 'frontend/package.json'), 'utf-8'))
const gradlePath = resolve(root, 'frontend/android/app/build.gradle')
const gradle = readFileSync(gradlePath, 'utf-8')

const version = String(pkg.version ?? '').trim()
const nameMatch = /versionName\s+"([^"]*)"/.exec(gradle)
const codeMatch = /versionCode\s+(\d+)/.exec(gradle)

if (!version) fail('frontend/package.json 里没有 version')
if (!nameMatch) fail('frontend/android/app/build.gradle 里没有 versionName')
if (!codeMatch) fail('frontend/android/app/build.gradle 里没有 versionCode')

const versionName = nameMatch[1].trim()
const versionCode = Number(codeMatch[1])

if (versionName !== version) {
  fail(`版本号不一致：package.json = ${version}，build.gradle versionName = ${versionName}\n  修法：把两处改成同一个版本号（app 内显示的是 package.json）`)
}
if (!Number.isInteger(versionCode) || versionCode <= 0) {
  fail(`versionCode 非法：${codeMatch[1]}（必须是正整数，且每次发版必须 +1，否则手机不允许覆盖安装）`)
}

const tag = process.argv[2]
if (tag) {
  const tagVersion = tag.replace(/^v/i, '')
  if (tagVersion !== version) {
    fail(`tag ${tag} 与版本号 ${version} 不一致\n  修法：先升版本号再打 tag，或把 tag 改成 v${version}`)
  }
}

console.log(`✓ 版本一致：v${version} / versionName ${versionName} / versionCode ${versionCode}${tag ? ` / tag ${tag}` : ''}`)
