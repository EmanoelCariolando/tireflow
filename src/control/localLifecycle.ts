/** The local panel owns its child; losing that IPC channel requests normal cleanup. */
export function attachLocalPanelLifecycle(shutdown: (reason: string) => Promise<void>): boolean {
  if (process.env.TIREFLOW_CONTROL_LOCAL_CHILD !== '1') return true;
  if (typeof process.send !== 'function') { void shutdown('LOCAL_PANEL_CLOSED'); return false; }
  process.once('disconnect', () => { void shutdown('LOCAL_PANEL_CLOSED'); });
  if (!process.connected) { void shutdown('LOCAL_PANEL_CLOSED'); return false; }
  return true;
}
