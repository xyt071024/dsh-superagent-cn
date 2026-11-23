/**
 * 运行时版本与 DSH 配置（profile）识别（M08）。
 *
 * 启动时捕获内存中的加载版本与当前 profile 名称/路径，查询时实时读取磁盘上的已安装版本，
 * 以便面板、自检和升级流程清楚区分「当前正在运行的版本」与「磁盘上新安装的版本」，并在两者不一致时提示重载。
 */
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface RuntimeVersionInfo {
  /** 本进程启动时加载进内存的插件版本。 */
  loaded: string | null
  /** 磁盘上当前 profile 中实际安装的插件版本（实时读取）。 */
  installed: string | null
  /** 插件启动时间（ISO 字符串）。 */
  startedAt: string
  /** 当前 DSH profile 名称（如 superagent、web）。 */
  profileName: string | null
  /** 当前 DSH profile 根目录路径。 */
  profileDir: string | null
  /** 当前配置的 stateDir。 */
  stateDir: string
  /** 内存中加载版本与磁盘已安装版本不一致时为 true，提示用户重载当前配置。 */
  reloadRequired: boolean
}

function readPackageVersion(pkgPath: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: unknown; version?: unknown }
    return parsed.name === 'dsh-superagent' && typeof parsed.version === 'string' ? parsed.version : null
  } catch {
    return null
  }
}

/** 根据模块文件位置向上查找最近的 dsh-superagent package.json。 */
function findPackageFile(): string | null {
  let current = dirname(fileURLToPath(import.meta.url))
  for (let depth = 0; depth < 5; depth++) {
    const candidate = join(current, 'package.json')
    if (existsSync(candidate) && readPackageVersion(candidate) !== null) return candidate
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

/** 从进程启动参数、环境变量或安装路径推断当前运行的 profile 名称与目录。 */
function detectProfile(pkgFile: string | null): { profileName: string | null; profileDir: string | null } {
  if (pkgFile) {
    const pkgDir = dirname(pkgFile)
    const parentDir = dirname(pkgDir)
    if (basename(parentDir) === 'node_modules') {
      const profileDir = dirname(parentDir)
      if (basename(dirname(profileDir)) === 'profiles') {
        return { profileName: basename(profileDir), profileDir }
      }
      return { profileName: basename(profileDir), profileDir }
    }
  }
  const argv = process.argv
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? ''
    if (arg === '--profile' && argv[i + 1]) {
      const name = argv[i + 1]!
      const home = process.env.DSH_HOME?.trim()
      const dir = home ? resolve(home, 'profiles', name) : null
      return { profileName: name, profileDir: dir }
    }
    if (arg.startsWith('--profile=')) {
      const name = arg.slice('--profile='.length)
      const home = process.env.DSH_HOME?.trim()
      const dir = home ? resolve(home, 'profiles', name) : null
      return { profileName: name, profileDir: dir }
    }
  }
  const envProfile = process.env.DSH_PROFILE?.trim()
  if (envProfile) {
    const home = process.env.DSH_HOME?.trim()
    return { profileName: envProfile, profileDir: home ? resolve(home, 'profiles', envProfile) : null }
  }
  return { profileName: null, profileDir: null }
}

/** Tracks loaded vs installed plugin version and DSH profile metadata across reloads. */
export class VersionTracker {
  private readonly pkgFile: string | null
  readonly loaded: string | null
  readonly startedAt: string
  readonly profileName: string | null
  readonly profileDir: string | null

  constructor(private readonly stateDir: string) {
    this.pkgFile = findPackageFile()
    this.loaded = this.pkgFile ? readPackageVersion(this.pkgFile) : null
    this.startedAt = new Date().toISOString()
    const detected = detectProfile(this.pkgFile)
    this.profileName = detected.profileName
    this.profileDir = detected.profileDir
  }

  /** 实时读取磁盘上已安装插件版本。 */
  readInstalled(): string | null {
    if (this.profileDir) {
      const candidate = join(this.profileDir, 'node_modules', 'dsh-superagent', 'package.json')
      const v = readPackageVersion(candidate)
      if (v !== null) return v
    }
    return this.pkgFile ? readPackageVersion(this.pkgFile) : this.loaded
  }

  snapshot(): RuntimeVersionInfo {
    const installed = this.readInstalled()
    return {
      loaded: this.loaded,
      installed,
      startedAt: this.startedAt,
      profileName: this.profileName,
      profileDir: this.profileDir,
      stateDir: this.stateDir,
      reloadRequired: this.loaded !== null && installed !== null && this.loaded !== installed,
    }
  }
}
