import * as React from 'react'
import { FileTypeIcon } from '@deepseek-ai/dsh-client-ui-primitives'

/** Chip title for the remote explorer tab: a link glyph before the label. */
export function RemoteExplorerTitle({ useTabInfo }) {
  const { tab } = useTabInfo()
  return (
    <React.Fragment>
      <FileTypeIcon kind="folder" size={16} />
      {tab.title}
    </React.Fragment>
  )
}
