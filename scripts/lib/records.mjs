// 发布记录核心校验逻辑（issue #11）。
// 纯函数、零依赖，供 scripts/release.mjs（CLI）与 scripts/tests/records.test.mjs（自测）共用。
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const COMMIT_RE = /^[0-9a-f]{7,40}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const HEX_RE = /^[0-9a-f]+$/
const URL_RE = /^https?:\/\//

export const RECORD_FIELDS = [
  'versionName',
  'versionCode',
  'date',
  'serviceCommit',
  'signingSha1',
  'signingSha256',
  'apkSha256',
  'downloadUrl',
  'notes',
]
const REQUIRED_FIELDS = ['versionName', 'versionCode', 'date', 'serviceCommit']

function isBlank(value) {
  return value === undefined || value === null || value === ''
}

function isCalendarDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function normalizeFingerprint(value) {
  return String(value).replace(/:/g, '').toLowerCase()
}

// 校验单条记录的字段 schema，返回错误信息数组（空数组表示通过）
export function validateRecordFields(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return ['记录必须是 JSON 对象']
  }
  const errors = []
  const label = typeof record.versionName === 'string' && record.versionName ? `v${record.versionName}` : '(缺少 versionName)'
  for (const field of REQUIRED_FIELDS) {
    if (isBlank(record[field])) errors.push(`${label}: 缺少必填字段 ${field}`)
  }
  if (!isBlank(record.versionName) && (typeof record.versionName !== 'string' || !SEMVER_RE.test(record.versionName))) {
    errors.push(`${label}: versionName "${record.versionName}" 不是语义化版本（如 1.2.0）`)
  }
  if (!isBlank(record.versionCode) && (typeof record.versionCode !== 'number' || !Number.isInteger(record.versionCode) || record.versionCode < 1)) {
    errors.push(`${label}: versionCode 必须为正整数，当前为 ${JSON.stringify(record.versionCode)}`)
  }
  if (!isBlank(record.serviceCommit) && (typeof record.serviceCommit !== 'string' || !COMMIT_RE.test(record.serviceCommit))) {
    errors.push(`${label}: serviceCommit "${record.serviceCommit}" 不是 7-40 位十六进制 commit`)
  }
  if (!isBlank(record.date)) {
    if (typeof record.date !== 'string' || !DATE_RE.test(record.date) || !isCalendarDate(record.date)) {
      errors.push(`${label}: date "${record.date}" 不是合法的 YYYY-MM-DD 日期`)
    }
  }
  if (!isBlank(record.signingSha1)) {
    const fingerprint = normalizeFingerprint(record.signingSha1)
    if (fingerprint.length !== 40 || !HEX_RE.test(fingerprint)) {
      errors.push(`${label}: signingSha1 不是 40 位十六进制指纹`)
    }
  }
  if (!isBlank(record.signingSha256)) {
    const fingerprint = normalizeFingerprint(record.signingSha256)
    if (fingerprint.length !== 64 || !HEX_RE.test(fingerprint)) {
      errors.push(`${label}: signingSha256 不是 64 位十六进制指纹`)
    }
  }
  if (!isBlank(record.apkSha256)) {
    const checksum = normalizeFingerprint(record.apkSha256)
    if (checksum.length !== 64 || !HEX_RE.test(checksum)) {
      errors.push(`${label}: apkSha256 不是 64 位十六进制校验和`)
    }
  }
  if (!isBlank(record.downloadUrl) && (typeof record.downloadUrl !== 'string' || !URL_RE.test(record.downloadUrl))) {
    errors.push(`${label}: downloadUrl "${record.downloadUrl}" 必须以 http:// 或 https:// 开头`)
  }
  for (const key of Object.keys(record)) {
    if (!RECORD_FIELDS.includes(key)) errors.push(`${label}: 存在未知字段 ${key}`)
  }
  return errors
}

// 校验记录集合：versionCode / versionName 唯一，且按发布日期 versionCode 单调递增
export function validateRecordSet(records) {
  const errors = []
  const byCode = new Map()
  const byName = new Map()
  for (const record of records) {
    if (typeof record?.versionCode === 'number' && Number.isInteger(record.versionCode)) {
      const previous = byCode.get(record.versionCode)
      if (previous) {
        errors.push(`versionCode ${record.versionCode} 重复：v${previous} 与 v${record.versionName}`)
      } else {
        byCode.set(record.versionCode, record.versionName)
      }
    }
    if (typeof record?.versionName === 'string' && record.versionName) {
      const previous = byName.get(record.versionName)
      if (previous) {
        errors.push(`versionName ${record.versionName} 重复（versionCode ${previous} 与 ${record.versionCode}）`)
      } else {
        byName.set(record.versionName, record.versionCode)
      }
    }
  }
  for (const record of records) {
    if (typeof record?.date !== 'string' || !DATE_RE.test(record.date)) continue
    for (const previous of records) {
      if (previous === record) continue
      if (typeof previous?.date !== 'string' || !DATE_RE.test(previous.date)) continue
      if (previous.date < record.date && previous.versionCode >= record.versionCode) {
        errors.push(`versionCode 必须单调递增：v${record.versionName}(${record.versionCode}) 发布日期晚于 v${previous.versionName}(${previous.versionCode})，versionCode 却未超过它`)
      }
    }
  }
  return [...new Set(errors)]
}

// 读取记录目录，返回 { entries: [{ name, record }], errors }
// 校验 JSON 可解析、文件名必须为 v<versionName>.json
export function readRecordDir(dir) {
  const entries = []
  const errors = []
  let names
  try {
    names = readdirSync(dir)
  } catch (err) {
    return { entries, errors: [`无法读取发布记录目录 ${dir}：${err.message}`] }
  }
  for (const name of names.filter((item) => item.endsWith('.json')).sort()) {
    const file = path.join(dir, name)
    let record
    try {
      record = JSON.parse(readFileSync(file, 'utf8'))
    } catch (err) {
      errors.push(`${name}: JSON 解析失败：${err.message}`)
      continue
    }
    const expected = record && typeof record === 'object' && !Array.isArray(record) && typeof record.versionName === 'string' ? `v${record.versionName}.json` : null
    if (name !== expected) {
      errors.push(`${name}: 文件名必须为 v<versionName>.json（与记录中 versionName 一致${expected ? `，应为 ${expected}` : ''}）`)
    }
    entries.push({ name, record })
  }
  return { entries, errors }
}

export function maxVersionCode(records) {
  return records.reduce((max, record) => (
    typeof record?.versionCode === 'number' && Number.isInteger(record.versionCode) ? Math.max(max, record.versionCode) : max
  ), 0)
}

export function nextVersionCode(records) {
  return maxVersionCode(records) + 1
}

// 校验候选新版本：versionCode 必须大于历史最大值；versionName 不得与历史重复
export function checkCandidateVersion(records, candidateCode, candidateName) {
  const errors = []
  if (typeof candidateCode !== 'number' || !Number.isInteger(candidateCode) || candidateCode < 1) {
    errors.push(`候选 versionCode 必须为正整数，当前为 ${JSON.stringify(candidateCode)}`)
    return errors
  }
  const max = maxVersionCode(records)
  if (candidateCode <= max) {
    errors.push(`候选 versionCode ${candidateCode} 必须大于历史最大 versionCode ${max}`)
  }
  if (candidateName !== undefined && candidateName !== '') {
    if (typeof candidateName !== 'string' || !SEMVER_RE.test(candidateName)) {
      errors.push(`候选 versionName "${candidateName}" 不是语义化版本`)
    } else if (records.some((record) => record?.versionName === candidateName)) {
      errors.push(`versionName ${candidateName} 已存在于发布记录`)
    }
  }
  return errors
}

// 解析 key=value 属性文件（# 或 ! 开头为注释），用于 android/version.properties 与 signing.properties
export function parseProperties(content) {
  const props = {}
  for (const line of String(content).split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    props[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return props
}

// 校验 android/version.properties 与历史记录的一致性
export function validateVersionProperties(props, records) {
  const errors = []
  const code = props.VERSION_CODE
  if (code === undefined) {
    errors.push('android/version.properties 缺少 VERSION_CODE')
  } else if (!/^\d+$/.test(String(code)) || Number(code) < 1) {
    errors.push(`android/version.properties VERSION_CODE 必须为正整数，当前为 ${JSON.stringify(code)}`)
  }
  const name = props.VERSION_NAME
  if (name === undefined) {
    errors.push('android/version.properties 缺少 VERSION_NAME')
  } else if (typeof name !== 'string' || !SEMVER_RE.test(name)) {
    errors.push(`android/version.properties VERSION_NAME "${name}" 不是语义化版本`)
  }
  const max = maxVersionCode(records)
  if (/^\d+$/.test(String(code)) && Number(code) < max) {
    errors.push(`android/version.properties VERSION_CODE ${code} 低于已发布最大 versionCode ${max}`)
  }
  return errors
}

// 从 service 仓 manifest.json 提取版本信息（uni-app 的 versionCode 为字符串，做归一）
export function parseManifest(manifest) {
  const code = Number(manifest?.versionCode)
  if (!Number.isInteger(code) || code < 1) {
    throw new Error(`manifest.json versionCode "${manifest?.versionCode}" 不是正整数`)
  }
  return {
    versionCode: code,
    versionName: typeof manifest?.versionName === 'string' ? manifest.versionName : undefined,
  }
}
