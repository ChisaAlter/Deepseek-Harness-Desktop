/** The fork action: one `sidebar.workspaces.session.menu.item` row. */
import { IconBranchOutlineRegular, MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ForkSessionInjected, SessionMenuItemProps } from '../contract/slots.ts'

/**
 * Menu row (order 300): fork at the Session's last completed turn; the child
 * arrives through the Host list beside its source.
 * @param props - owner share, menu open state, and the fork share.
 * @returns the row.
 */
export function ForkSessionMenuItem({ sessionId, useMenuOpenState, forkSession, t }: SessionMenuItemProps<ForkSessionInjected>) {
  const [, setMenuOpen] = useMenuOpenState()
  return (
    <MenuItemButton
      icon={<IconBranchOutlineRegular />}
      onSelect={() => {
        setMenuOpen(false)
        forkSession(sessionId)
      }}
    >
      {t('menu.fork')}
    </MenuItemButton>
  )
}
