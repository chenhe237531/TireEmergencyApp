#!/usr/bin/env node
// 小蚂蚁轮胎救援 · 发布版本工具（issue #11）
//
// 用法：
//   node scripts/release.mjs validate [--records <目录>] [--version-properties <文件>] [--manifest <manifest.json>]
//   node scripts/release.mjs new --version-name <语义化版本> [--version-code <正整数>] --service-commit <commit> [--records <目录>] [--date <YYYY-MM-DD>]
//   node scripts/release.mjs check-version (--version-code <正整数> | --manifest <manifest.json>) [--version-name <语义化版本>] [--records <目录>]
//
// 子命令：
//   validate      校验 release/records 全部记录（schema、唯一性、versionCode 单调递增）与 android/version.properties
//   new           生成新的发布记录骨架（--version-code 省略时自动取历史最大 + 1）
//   check-version 校验候选 versionCode（或 service 仓 manifest.json 中的 versionCode）必须大于历史最大值
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  checkCandidateVersion,
  maxVersionCode,
  nextVersionCode,
  parseManifest,
  parseProperties,
  readRecordDir,
  validateRecordFields,
  validateRecordSet,
  validateVersionProperties,
} from './lib/records.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_RECORDS_DIR = path.join(ROOT, 'release', 'records')
const DEFAULT_VERSION_PROPERTIES = path.join(ROOT, 'android', 'version.properties')

const USAGE = `用法：
  node scripts/release.mjs validate [--records <目录>] [--version-properties <文件>] [--manifest <manifest.json>]
  node scripts/release.mjs new --version-name <语义化版本> [--version-code <正整数>] --service-commit <commit> [--records <目录>] [--date <YYYY-MM-DD>]
  node scripts/release.mjs check-version (--version-code <正整数> | --manifest <manifest.json>) [--version-name <语义化版本>] [--records <目录>]`

function usage() {
  console.error(USAGE)
  process.exit(2)
}

function fail(errors) {
  console.error('[FAIL] 校验未通过：')
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}

function parseArgs(argv) {
  const opts = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) usage()
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      opts[key] = next
      i += 1
    } else {
      opts[key] = true
    }
  }
  return opts
}

// 读取并全量校验记录目录，返回 { records, errors }
function loadRecords(recordsDir) {
  const errors = []
  const { entries, errors: readErrors } = readRecordDir(recordsDir)
  errors.push(...readErrors)
  for (const { name, record } of entries) {
    for (const error of validateRecordFields(record)) errors.push(`${name}: ${error}`)
  }
  const records = entries.map((entry) => entry.record)
  errors.push(...validateRecordSet(records))
  return { records, errors }
}

function cmdValidate(opts) {
  const recordsDir = opts.records ?? DEFAULT_RECORDS_DIR
  const versionPropsPath = opts['version-properties'] ?? DEFAULT_VERSION_PROPERTIES
  const { records, errors } = loadRecords(recordsDir)
  if (!existsSync(versionPropsPath)) {
    errors.push(`缺少 ${versionPropsPath}`)
  } else {
    const props = parseProperties(readFileSync(versionPropsPath, 'utf8'))
    errors.push(...validateVersionProperties(props, records))
  }
  if (opts.manifest) {
    if (!existsSync(opts.manifest)) {
      errors.push(`找不到 manifest：${opts.manifest}`)
    } else {
      try {
        const manifest = parseManifest(JSON.parse(readFileSync(opts.manifest, 'utf8')))
        errors.push(...checkCandidateVersion(records, manifest.versionCode, manifest.versionName))
      } catch (err) {
        errors.push(`manifest 解析失败：${err.message}`)
      }
    }
  }
  if (errors.length) fail(errors)
  const parts = [
    `发布记录校验通过：${records.length} 条记录，历史最大 versionCode ${maxVersionCode(records)}`,
    `version.properties 校验通过（${versionPropsPath}）`,
  ]
  if (opts.manifest) parts.push('manifest.json versionCode 大于历史最大值')
  console.log(`[OK] ${parts.join('；')}`)
}

function cmdNew(opts) {
  const versionName = opts['version-name']
  const serviceCommit = opts['service-commit']
  if (typeof versionName !== 'string' || typeof serviceCommit !== 'string') usage()
  const recordsDir = opts.records ?? DEFAULT_RECORDS_DIR
  const { records, errors } = loadRecords(recordsDir)
  if (errors.length) fail(errors)
  const versionCode = opts['version-code'] !== undefined ? Number(opts['version-code']) : nextVersionCode(records)
  const date = typeof opts.date === 'string' ? opts.date : new Date().toISOString().slice(0, 10)
  const record = {
    versionName,
    versionCode,
    date,
    serviceCommit,
    signingSha1: '',
    signingSha256: '',
    apkSha256: '',
    downloadUrl: '',
    notes: '',
  }
  const fieldErrors = validateRecordFields(record)
  if (fieldErrors.length) fail(fieldErrors)
  const candidateErrors = checkCandidateVersion(records, versionCode, versionName)
  if (candidateErrors.length) fail(candidateErrors)
  mkdirSync(recordsDir, { recursive: true })
  const file = path.join(recordsDir, `v${versionName}.json`)
  if (existsSync(file)) fail([`${file} 已存在`])
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`)
  console.log(`[OK] 已生成发布记录骨架：${file}`)
  console.log('后续步骤：构建 APK 后补齐 signingSha1 / signingSha256 / apkSha256 / downloadUrl / notes，再执行 node scripts/release.mjs validate。')
}

function cmdCheckVersion(opts) {
  const recordsDir = opts.records ?? DEFAULT_RECORDS_DIR
  const { records, errors } = loadRecords(recordsDir)
  if (errors.length) fail(errors)
  let candidateCode
  let candidateName = typeof opts['version-name'] === 'string' ? opts['version-name'] : undefined
  if (opts['version-code'] !== undefined) {
    candidateCode = Number(opts['version-code'])
  } else if (typeof opts.manifest === 'string') {
    if (!existsSync(opts.manifest)) fail([`找不到 manifest：${opts.manifest}`])
    try {
      const manifest = parseManifest(JSON.parse(readFileSync(opts.manifest, 'utf8')))
      candidateCode = manifest.versionCode
      candidateName = candidateName ?? manifest.versionName
    } catch (err) {
      fail([`manifest 解析失败：${err.message}`])
    }
  } else {
    usage()
  }
  const candidateErrors = checkCandidateVersion(records, candidateCode, candidateName)
  if (candidateErrors.length) fail(candidateErrors)
  console.log(`[OK] 候选 versionCode ${candidateCode} 大于历史最大 versionCode ${maxVersionCode(records)}`)
}

const [subcommand, ...rest] = process.argv.slice(2)
switch (subcommand) {
  case 'validate':
    cmdValidate(parseArgs(rest))
    break
  case 'new':
    cmdNew(parseArgs(rest))
    break
  case 'check-version':
    cmdCheckVersion(parseArgs(rest))
    break
  default:
    usage()
}
