import * as fs from 'fs'
import * as path from 'path'

export let HEARTBEAT_INTERVAL_MS = 2000

export async function checkLockFile() {
  const lockPath = path.join(process.cwd(), '.config', 'lock')
  if (fs.existsSync(lockPath)) {
    // read the lock file and the timestamp in it
    const lockContent = await fs.readFileSync(lockPath, 'utf8')
    const timestamp = new Date(lockContent.trim())
    if (Date.now() - timestamp.getTime() < HEARTBEAT_INTERVAL_MS * 1.5) {
      console.error('Lock file exists and is up to date. Exiting...')
      process.exit(1)
    }
  }
}

export async function updateLockFile() {
  const lockPath = path.join(process.cwd(), '.config', 'lock')
  await fs.promises.writeFile(lockPath, new Date().toISOString())
}
