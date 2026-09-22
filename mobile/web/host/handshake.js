async function handshake({ call, connectEvents }) {
  const host = await call('host.describe', {});
  if (!host?.ok) {
    throw new Error(host?.error?.message || 'host.describe failed');
  }
  const [sessions, workspaces] = await Promise.all([
    call('session.list', {}),
    call('workspace.list', {}),
  ]);
  if (!sessions?.ok) {
    throw new Error(sessions?.error?.message || 'session.list failed');
  }
  if (!workspaces?.ok) {
    throw new Error(workspaces?.error?.message || 'workspace.list failed');
  }
  await connectEvents();
  return {
    host: host.value,
    sessions: sessions.value,
    workspaces: workspaces.value,
  };
}

export { handshake };
