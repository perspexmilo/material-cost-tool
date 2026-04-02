'use client'

import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow, format } from 'date-fns'
import type { CostHistory } from '@/types'

interface CostHistoryPanelProps {
  materialId: string
  materialDescription: string
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function sourceLabel(source: string): string {
  switch (source) {
    case 'email-parse':
      return 'Email parse'
    case 'manual':
      return 'Manual entry'
    case 'import':
      return 'Imported'
    case 'staged':
      return 'Scheduled'
    default:
      return source
  }
}

export function CostHistoryPanel({ materialId, materialDescription }: CostHistoryPanelProps) {
  const { data, isLoading, isError } = useQuery<CostHistory[]>({
    queryKey: ['cost-history', materialId],
    queryFn: async () => {
      const res = await fetch(`/api/materials/${materialId}/history`)
      if (!res.ok) throw new Error('Failed to fetch cost history')
      return res.json()
    },
  })

  return (
    <div className="px-6 py-4 bg-white border-t border-[#E5E5E3]" style={{ backgroundColor: '#FAFAF9' }}>
      <div className="flex items-center gap-2 mb-4">
        <div className="w-[3px] h-4 rounded-full" style={{ backgroundColor: '#2DBDAA' }} />
        <h3 className="text-[12px] font-semibold text-gray-500 uppercase tracking-widest">
          Cost History — {materialDescription}
        </h3>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 py-4">
          <svg className="animate-spin h-4 w-4 text-gray-400" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm text-gray-400">Loading history…</span>
        </div>
      )}

      {isError && (
        <p className="text-sm text-red-500 py-4">Failed to load cost history.</p>
      )}

      {data && data.length === 0 && (
        <p className="text-sm text-gray-400 py-4">No cost history recorded yet.</p>
      )}

      {data && data.length > 0 && (
        <div className="history-timeline">
          {data.map((entry, idx) => {
            const changeAmount = entry.newCost - entry.previousCost
            const changePercent = entry.previousCost > 0
              ? ((changeAmount / entry.previousCost) * 100).toFixed(1)
              : null
            const isIncrease = changeAmount > 0
            const changedAt = new Date(entry.changedAt)

            const effectiveDate = entry.effectiveDate ? new Date(entry.effectiveDate) : null
            const sameDay = effectiveDate
              ? format(changedAt, 'yyyy-MM-dd') === format(effectiveDate, 'yyyy-MM-dd')
              : true

            return (
              <div key={entry.id} className="relative mb-5 last:mb-0">
                <div className="history-timeline-dot" />
                <div className="flex items-start justify-between gap-4">
                  <div>
                    {/* Dates */}
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <time
                        dateTime={entry.changedAt}
                        className="text-[12px] text-gray-500"
                      >
                        <span className="text-[11px] text-gray-400 mr-1">Inputted</span>
                        {format(changedAt, 'dd MMM yyyy')}
                      </time>
                      {effectiveDate && !sameDay && (
                        <>
                          <span className="text-gray-300 text-[11px]">·</span>
                          <time
                            dateTime={entry.effectiveDate!}
                            className="text-[12px] text-gray-500"
                          >
                            <span className="text-[11px] text-gray-400 mr-1">Effective</span>
                            {format(effectiveDate, 'dd MMM yyyy')}
                          </time>
                        </>
                      )}
                    </div>

                    {/* Cost change */}
                    <div className="flex items-center gap-2">
                      <span className="tabular-nums text-[13px] font-medium text-gray-500 line-through">
                        {formatCurrency(entry.previousCost)}
                      </span>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-gray-400">
                        <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span className="tabular-nums text-[13px] font-semibold text-gray-900">
                        {formatCurrency(entry.newCost)}
                      </span>
                      {changePercent !== null && (
                        <span
                          className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${
                            isIncrease
                              ? 'bg-red-50 text-red-600'
                              : 'bg-[#E6F4F1] text-[#1A7A6A]'
                          }`}
                        >
                          {isIncrease ? '+' : ''}{changePercent}%
                        </span>
                      )}
                    </div>

                    {/* Source + notes */}
                    <p className="text-[11px] text-gray-400 mt-1">
                      {sourceLabel(entry.updateSource)}
                      {entry.notes ? ` · ${entry.notes}` : ''}
                    </p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
