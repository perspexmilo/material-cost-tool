'use client'

import { type ReactNode } from 'react'
import { Sidebar } from '@/components/layout/Sidebar'

interface AppShellProps {
  children: ReactNode
  stagedCount: number
}

export function AppShell({ children, stagedCount }: AppShellProps) {
  return (
    <div className="min-w-[1280px]">
      <Sidebar stagedCount={stagedCount} />
      <div className="ml-[240px] pt-12 min-h-screen bg-[#F7F7F5]">
        {children}
      </div>
    </div>
  )
}
