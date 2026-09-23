import * as React from 'react'
import { FileTypeIcon } from '@deepseek-ai/dsh-client-ui-primitives'
import { remoteFileTarget } from './api.js'

/** Chip title for a remote file tab: the file-type glyph before the label. */
export function RemoteFileTitle({ useTabInfo }) {
  const { tab } = useTabInfo()
  let name = ''
  try { name = remoteFileTarget(tab.navigation.address).path.split(/[\\/]/).pop() || '' } catch { /* keep bare label */ }
  return (
    <React.Fragment>
      {name ? <FileTypeIcon path={name} size={16} /> : <FileTypeIcon kind="other" size={16} />}
      {tab.title}
    </React.Fragment>
  )
}
