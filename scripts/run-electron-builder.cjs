const fsPromises = require('fs/promises')

const originalWriteFile = fsPromises.writeFile
const retryableCodes = new Set(['EBUSY', 'EACCES', 'EPERM', 'UNKNOWN'])

fsPromises.writeFile = async (...args) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await originalWriteFile(...args)
    } catch (error) {
      if (!retryableCodes.has(error?.code) || attempt >= 7) {
        throw error
      }
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)))
    }
  }
}

require('electron-builder/cli.js')
