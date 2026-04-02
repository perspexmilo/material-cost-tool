'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Database, RefreshCw, Clock } from 'lucide-react'
import { clsx } from 'clsx'

interface SidebarProps {
  stagedCount?: number
}

const NAV_ITEMS = [
  { href: '/database',       label: 'Database',        icon: Database },
  { href: '/price-updates',  label: 'Price Updates',   icon: RefreshCw },
  { href: '/staged-changes', label: 'Staged Changes',  icon: Clock, badge: true },
]

export function Sidebar({ stagedCount = 0 }: SidebarProps) {
  const pathname = usePathname()

  return (
    <aside
      className="fixed left-0 top-0 h-screen w-[240px] flex flex-col z-30"
      style={{ backgroundColor: '#1C1E22' }}
    >
      {/* Brand */}
      <div className="flex items-center h-12 px-4 border-b border-white/5">
        <div
          className="w-6 h-6 rounded flex items-center justify-center mr-2.5 shrink-0"
          style={{ backgroundColor: '#2DBDAA' }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M2 7L7 2L12 7M3.5 6V11H10.5V6"
              stroke="white"
              strokeWidth="1.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <span className="text-white text-sm font-semibold tracking-tight">CutMy</span>
        <span className="text-[#C8CAD0] text-sm font-normal ml-1">Costs</span>
      </div>

      {/* Nav */}
      <nav className="px-2 pt-3 pb-2 flex-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon, badge }) => {
          const isActive = pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                'sidebar-nav-item flex items-center gap-2.5 px-3 py-2 rounded-lg mb-0.5 transition-colors duration-150',
                isActive
                  ? 'active bg-white/8 text-white'
                  : 'hover:bg-white/5 hover:text-white'
              )}
            >
              <Icon size={15} className="shrink-0" />
              <span className="flex-1 text-[13px]">{label}</span>
              {badge && stagedCount > 0 && (
                <span
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full leading-none"
                  style={{ backgroundColor: '#2DBDAA', color: 'white' }}
                >
                  {stagedCount}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-white/5">
        <p className="text-[11px]" style={{ color: '#3D4048' }}>v0.1.0</p>
      </div>
    </aside>
  )
}
