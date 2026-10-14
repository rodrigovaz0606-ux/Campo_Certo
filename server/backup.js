import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { dataDir } from './db.js'
import { registry } from './tenancy.js'

// Cópias consistentes (API de backup do SQLite) do cadastro de usuários e de todas as empresas.
export const backupRoot = path.resolve(process.env.BACKUP_DIR || path.join(dataDir, 'backups', 'automaticos'))
const keep = Math.max(1, Number(process.env.BACKUP_KEEP) || 10)
const dayMs = 24 * 60 * 60 * 1000
const namePattern = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/
let running = null

const pad = value => String(value).padStart(2, '0')
const folderName = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`

function folderSize(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).reduce((total, entry) => {
    const full = path.join(folder, entry.name)
    return total + (entry.isDirectory() ? folderSize(full) : fs.statSync(full).size)
  }, 0)
}

export function listBackups() {
  if (!fs.existsSync(backupRoot)) return []
  return fs.readdirSync(backupRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && namePattern.test(entry.name))
    .map(entry => {
      const folder = path.join(backupRoot, entry.name)
      let manifest = {}
      try { manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifesto.json'), 'utf8')) } catch {}
      return { name: entry.name, created_at: manifest.created_at || fs.statSync(folder).mtime.toISOString(), reason: manifest.reason || '', databases: manifest.databases?.length || 0, size: folderSize(folder) }
    })
    .sort((a, b) => b.name.localeCompare(a.name))
}

function prune() {
  for (const old of listBackups().slice(keep)) fs.rmSync(path.join(backupRoot, old.name), { recursive: true, force: true })
  for (const entry of fs.readdirSync(backupRoot)) {
    if (entry.endsWith('.parcial')) fs.rmSync(path.join(backupRoot, entry), { recursive: true, force: true })
  }
}

export function runBackup(reason = 'Automático') {
  if (running) return running
  running = (async () => {
    const now = new Date()
    const name = folderName(now)
    const partial = path.join(backupRoot, `.${name}.parcial`)
    fs.mkdirSync(partial, { recursive: true })
    try {
      const databases = ['produtor-rural.db']
      await registry.backup(path.join(partial, 'produtor-rural.db'))
      const companiesDir = path.join(dataDir, 'companies')
      const companyFiles = fs.existsSync(companiesDir) ? fs.readdirSync(companiesDir).filter(file => /^\d+\.db$/.test(file)) : []
      if (companyFiles.length) fs.mkdirSync(path.join(partial, 'companies'))
      for (const file of companyFiles) {
        const source = new Database(path.join(companiesDir, file), { readonly: true, fileMustExist: true })
        try { await source.backup(path.join(partial, 'companies', file)) } finally { source.close() }
        databases.push(`companies/${file}`)
      }
      fs.writeFileSync(path.join(partial, 'manifesto.json'), JSON.stringify({ created_at: now.toISOString(), reason, databases }, null, 2))
      fs.renameSync(partial, path.join(backupRoot, name))
      prune()
      return listBackups().find(item => item.name === name)
    } catch (error) {
      fs.rmSync(partial, { recursive: true, force: true })
      throw error
    }
  })().finally(() => { running = null })
  return running
}

export function startBackupSchedule() {
  if (process.env.BACKUP_DISABLED === '1') return
  const check = () => {
    const latest = listBackups()[0]
    if (latest && Date.now() - new Date(latest.created_at).getTime() < dayMs) return
    runBackup().catch(error => console.error('Falha no backup automático:', error))
  }
  // Aguarda o servidor estabilizar antes da primeira cópia e depois confere a cada hora.
  setTimeout(check, 2 * 60 * 1000).unref()
  setInterval(check, 60 * 60 * 1000).unref()
}
