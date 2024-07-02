import * as fs from 'fs'
import * as path from 'path'

export let HEARTBEAT_INTERVAL_MS = 2000

export async function checkLockFile(firstTime: boolean = true) {
  const lockPath = path.join(process.cwd(), '.config', 'lock')
  if (fs.existsSync(lockPath)) {
    // read the lock file and the timestamp in it
    const lockContent = await fs.readFileSync(lockPath, 'utf8')
    const timestamp = new Date(lockContent.trim())
    if (Date.now() - timestamp.getTime() < HEARTBEAT_INTERVAL_MS * 1.5) {
      if (firstTime) {
        console.error(
          `Lock file exists and is up to date. Retrying in ${HEARTBEAT_INTERVAL_MS}ms ...`
        )
        function timeout(ms: number) {
          return new Promise((resolve) => setTimeout(resolve, ms))
        }
        setTimeout(() => checkLockFile(false), HEARTBEAT_INTERVAL_MS)
        await timeout(HEARTBEAT_INTERVAL_MS)
      } else {
        console.error(
          `Lock file exists and is up to date upon checking again. Killing program...`
        )
        process.exit(1)
      }
    }
  }
}

export async function updateLockFile() {
  const lockPath = path.join(process.cwd(), '.config', 'lock')
  await fs.promises.writeFile(lockPath, new Date().toISOString())
}
