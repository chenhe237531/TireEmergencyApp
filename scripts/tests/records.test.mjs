// scripts/release.mjs 及其核心逻辑的最小自测（node:test，零依赖）。
// 覆盖：记录 schema 校验、versionCode 单调递增（合法/非法 fixture）、
// 记录目录读取、候选版本门槛、version.properties 与 manifest 一致性。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
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
} from '../lib/records.mjs'

const validFull = {
  versionName: '1.2.0',
  versionCode: 120,
  date: '2026-10-23',
  serviceCommit: 'a1b2c3d',
  signingSha1: 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:aa:bb:cc:dd',
  signingSha256: 'ab:'.repeat(32).slice(0, -1),
  apkSha256: 'b'.repeat(64),
  downloadUrl: 'https://downloads.example.com/android/tire-1.2.0.apk',
  notes: '修复定位偶发失败',
}

const validSkeleton = {
  versionName: '1.0.0',
  versionCode: 100,
  date: '2026-10-01',
  serviceCommit: 'abc1234',
  signingSha1: '',
  signingSha256: '',
  apkSha256: '',
  downloadUrl: '',
  notes: '',
}

test('schema：完整合法记录通过', () => {
  assert.deepEqual(validateRecordFields(validFull), [])
})

test('schema：生成的骨架记录通过（可选字段允许为空）', () => {
  assert.deepEqual(validateRecordFields(validSkeleton), [])
})

test('schema：缺少必填字段被拒绝', () => {
  const errors = validateRecordFields({ versionName: '1.0.0' })
  assert.ok(errors.some((error) => error.includes('versionCode')))
  assert.ok(errors.some((error) => error.includes('serviceCommit')))
  assert.ok(errors.some((error) => error.includes('date')))
})

test('schema：versionName 非语义化版本被拒绝', () => {
  assert.ok(validateRecordFields({ ...validFull, versionName: '1.0' }).length > 0)
  assert.ok(validateRecordFields({ ...validFull, versionName: 120 }).length > 0)
})

test('schema：versionCode 非正整数被拒绝（字符串 / 0 / 负数 / 小数）', () => {
  assert.ok(validateRecordFields({ ...validFull, versionCode: '120' }).length > 0)
  assert.ok(validateRecordFields({ ...validFull, versionCode: 0 }).length > 0)
  assert.ok(validateRecordFields({ ...validFull, versionCode: -5 }).length > 0)
  assert.ok(validateRecordFields({ ...validFull, versionCode: 1.5 }).length > 0)
})

test('schema：versionCode 合法边界通过（1）', () => {
  assert.deepEqual(validateRecordFields({ ...validFull, versionCode: 1 }), [])
})

test('schema：serviceCommit 非十六进制或过短被拒绝', () => {
  assert.ok(validateRecordFields({ ...validFull, serviceCommit: 'xyz123' }).length > 0)
  assert.ok(validateRecordFields({ ...validFull, serviceCommit: 'ab12' }).length > 0)
  assert.ok(validateRecordFields({ ...validFull, serviceCommit: 'a'.repeat(41) }).length > 0)
})

test('schema：日期格式与真实日期校验', () => {
  assert.ok(validateRecordFields({ ...validFull, date: '2026/10/23' }).length > 0)
  assert.ok(validateRecordFields({ ...validFull, date: '2026-02-30' }).length > 0)
  assert.deepEqual(validateRecordFields({ ...validFull, date: '2024-02-29' }), [])
})

test('schema：指纹与校验和位数校验', () => {
  assert.ok(validateRecordFields({ ...validFull, apkSha256: 'xyz' }).length > 0)
  assert.ok(validateRecordFields({ ...validFull, signingSha1: 'a'.repeat(39) }).length > 0)
  assert.ok(validateRecordFields({ ...validFull, signingSha256: 'a'.repeat(63) }).length > 0)
})

test('schema：冒号分隔的 keytool 指纹格式通过', () => {
  assert.deepEqual(validateRecordFields({ ...validFull, signingSha1: 'ab:'.repeat(20).slice(0, -1) }), [])
})

test('schema：downloadUrl 必须 http(s)', () => {
  assert.ok(validateRecordFields({ ...validFull, downloadUrl: 'ftp://x/a.apk' }).length > 0)
})

test('schema：未知字段被拒绝', () => {
  assert.ok(validateRecordFields({ ...validFull, extra: 1 }).length > 0)
})

test('集合：versionCode 重复被拒绝', () => {
  const errors = validateRecordSet([
    validSkeleton,
    { ...validFull, versionName: '1.1.0', versionCode: 100 },
  ])
  assert.ok(errors.some((error) => error.includes('versionCode 100 重复')))
})

test('集合：versionName 重复被拒绝', () => {
  const errors = validateRecordSet([
    validSkeleton,
    { ...validSkeleton, versionCode: 101 },
  ])
  assert.ok(errors.some((error) => error.includes('versionName 1.0.0 重复')))
})

test('集合：versionCode 按日期单调递增通过', () => {
  const errors = validateRecordSet([
    validSkeleton,
    { ...validFull, versionName: '1.1.0', versionCode: 110, date: '2026-10-15' },
  ])
  assert.deepEqual(errors, [])
})

test('集合：更晚发布但 versionCode 未超过历史被拒绝', () => {
  const errors = validateRecordSet([
    validSkeleton,
    { ...validFull, versionName: '1.1.0', versionCode: 99, date: '2026-10-15' },
  ])
  assert.ok(errors.some((error) => error.includes('单调递增')))
})

test('集合：同日多条记录不触发单调递增误报', () => {
  const errors = validateRecordSet([
    validSkeleton,
    { ...validFull, versionName: '1.0.1', versionCode: 101, date: '2026-10-01' },
  ])
  assert.deepEqual(errors, [])
})

test('maxVersionCode / nextVersionCode', () => {
  assert.equal(maxVersionCode([]), 0)
  assert.equal(nextVersionCode([]), 1)
  assert.equal(nextVersionCode([{ versionCode: 100 }, { versionCode: 105 }]), 106)
})

test('checkCandidateVersion：合法与非法 versionCode fixture', () => {
  const records = [validSkeleton]
  assert.deepEqual(checkCandidateVersion(records, 101), [])
  assert.deepEqual(checkCandidateVersion(records, 101, '1.1.0'), [])
  assert.ok(checkCandidateVersion(records, 100).length > 0) // 等于历史最大：拒绝
  assert.ok(checkCandidateVersion(records, 99).length > 0) // 小于历史最大：拒绝
  assert.ok(checkCandidateVersion(records, '101').length > 0) // 非整数：拒绝
  assert.ok(checkCandidateVersion(records, 101, '1.0.0').length > 0) // versionName 重复：拒绝
  assert.ok(checkCandidateVersion(records, 101, '1.0').length > 0) // 非语义化版本：拒绝
})

test('readRecordDir：合法目录读取（.gitkeep 等非 JSON 文件被忽略）', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tire-records-'))
  writeFileSync(path.join(dir, 'v1.0.0.json'), JSON.stringify(validSkeleton))
  writeFileSync(path.join(dir, 'v1.1.0.json'), JSON.stringify({ ...validFull, versionName: '1.1.0', versionCode: 110, date: '2026-10-15' }))
  writeFileSync(path.join(dir, '.gitkeep'), '')
  const { entries, errors } = readRecordDir(dir)
  assert.deepEqual(errors, [])
  assert.equal(entries.length, 2)
  assert.equal(entries[0].name, 'v1.0.0.json')
})

test('readRecordDir：文件名与 versionName 不一致被拒绝', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tire-records-'))
  writeFileSync(path.join(dir, 'v2.0.0.json'), JSON.stringify(validSkeleton))
  const { errors } = readRecordDir(dir)
  assert.ok(errors.some((error) => error.includes('文件名')))
})

test('readRecordDir：非法 JSON 被拒绝', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tire-records-'))
  writeFileSync(path.join(dir, 'v1.0.0.json'), '{oops')
  const { errors } = readRecordDir(dir)
  assert.ok(errors.some((error) => error.includes('JSON 解析失败')))
})

test('readRecordDir：目录不存在时报错', () => {
  const { entries, errors } = readRecordDir(path.join(tmpdir(), 'no-such-dir'))
  assert.equal(entries.length, 0)
  assert.ok(errors.length > 0)
})

test('parseProperties：注释、空行与键值解析', () => {
  const props = parseProperties('# 注释\n! 也是注释\nVERSION_CODE=100\n\nVERSION_NAME=1.0.0\n')
  assert.equal(props.VERSION_CODE, '100')
  assert.equal(props.VERSION_NAME, '1.0.0')
  assert.equal(props.NOTE, undefined)
})

test('validateVersionProperties：合法与非法 fixture', () => {
  const records = [validSkeleton]
  assert.deepEqual(validateVersionProperties({ VERSION_CODE: '100', VERSION_NAME: '1.0.0' }, records), [])
  assert.deepEqual(validateVersionProperties({ VERSION_CODE: '101', VERSION_NAME: '1.0.1' }, records), [])
  assert.ok(validateVersionProperties({ VERSION_CODE: '99', VERSION_NAME: '0.9.0' }, records).length > 0) // 低于历史最大
  assert.ok(validateVersionProperties({ VERSION_NAME: '1.0.0' }, records).length > 0) // 缺 VERSION_CODE
  assert.ok(validateVersionProperties({ VERSION_CODE: 'abc', VERSION_NAME: '1.0.0' }, records).length > 0)
  assert.ok(validateVersionProperties({ VERSION_CODE: '100' }, records).length > 0) // 缺 VERSION_NAME
  assert.ok(validateVersionProperties({ VERSION_CODE: '100', VERSION_NAME: '1.0' }, records).length > 0)
})

test('parseManifest：uni-app 字符串 versionCode 归一', () => {
  const manifest = parseManifest({ versionName: '1.0.0', versionCode: '100' })
  assert.equal(manifest.versionCode, 100)
  assert.equal(manifest.versionName, '1.0.0')
  assert.throws(() => parseManifest({ versionCode: 'x' }))
  assert.throws(() => parseManifest({ versionCode: '0' }))
  assert.throws(() => parseManifest({}))
})
