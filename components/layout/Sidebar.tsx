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
      className="fixed left-0 top-0 h-screen w-[240px] flex flex-col z-30 shadow-2xl shadow-black/50"
      style={{
        background: 'linear-gradient(180deg, #1C1E22 0%, #14161A 100%)',
        boxShadow: '4px 0 24px rgba(0, 0, 0, 0.4)'
      }}
    >
      {/* Brand */}
      <div className="flex items-center h-14 px-5 border-b border-white/[0.03]">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center mr-3 shrink-0 shadow-lg shadow-[#2DBDAA]/20"
          style={{
            background: 'linear-gradient(135deg, #2DBDAA 0%, #249A8B 100%)'
          }}
        >
          <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
            <path
              d="M2 7L7 2L12 7M3.5 6V11H10.5V6"
              stroke="white"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div>
          <div className="flex items-center leading-none">
            <span className="text-white text-[15px] font-bold tracking-tight">CutMy</span>
            <span className="text-[#2DBDAA] text-[15px] font-medium ml-1">Costs</span>
          </div>
          <div className="text-[10px] text-gray-500 font-medium uppercase tracking-widest mt-1 opacity-60">System v0.1</div>
        </div>
      </div>
 
      {/* Nav */}
      <nav className="px-3 pt-6 pb-2 flex-1 space-y-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon, badge }) => {
          const isActive = pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                'group flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-all duration-200 border border-transparent',
                isActive
                  ? 'bg-white/[0.08] text-white border-white/[0.05] shadow-lg shadow-black/20'
                  : 'text-[#C8CAD0] hover:bg-white/[0.04] hover:text-white'
              )}
            >
              <Icon
                size={18}
                className={clsx(
                  'shrink-0 transition-transform duration-200 group-hover:scale-110',
                  isActive ? 'text-[#2DBDAA]' : 'text-[#8E9196]'
                )}
              />
              <span className="flex-1 text-[13.5px] font-medium">{label}</span>
              {badge && stagedCount > 0 && (
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full leading-none shadow-sm"
                  style={{ background: 'linear-gradient(135deg, #2DBDAA 0%, #249A8B 100%)', color: 'white' }}
                >
                  {stagedCount}
                </span>
              )}
            </Link>
          )
        })}
      </nav>
 
      {/* Footer */}
      <div className="px-5 py-4 border-t border-white/[0.03] bg-black/10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-700 to-gray-800 border border-white/10 flex items-center justify-center text-[11px] font-bold text-gray-400">
            MM
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-medium text-gray-300 truncate">Milo McCardle</p>
            <p className="text-[10px] text-gray-500 truncate">Administrator</p>
          </div>
        </div>
      </div>
    </aside>
  )
}
