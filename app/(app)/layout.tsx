import type { ReactNode } from 'react'
import { AppShell } from './AppShell'
import { getStagedChanges } from '@/lib/db/staged-changes'

async function getStagedCount() {
  try {
    const changes = await getStagedChanges()
    return changes.length
  } catch {
    return 0
  }
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const stagedCount = await getStagedCount()

  return (
    <AppShell stagedCount={stagedCount}>
      {children}
    </AppShell>
  )
}
