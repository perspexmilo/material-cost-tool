'use client'

import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  ResponsiveContainer, AreaChart, Area,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
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

// ─── Price Chart ──────────────────────────────────────────────────────────────

function PriceChart({ history }: { history: CostHistory[] }) {
  // history is DESC — reverse to chronological order
  const chronological = [...history].reverse()

  // Plot only real data points — each entry's newCost at its changedAt date.
  // previousCost is shown in the tooltip but not plotted as a fake anchor date.
  const points = chronological.map((e) => ({
    date: new Date(e.changedAt).getTime(),
    cost: e.newCost,
    previousCost: e.previousCost,
    label: sourceLabel(e.updateSource),
  }))

  const minCost = Math.min(...points.map((p) => p.cost))
  const maxCost = Math.max(...points.map((p) => p.cost))
  const pad = (maxCost - minCost) * 0.15 || maxCost * 0.1

  return (
    <div className="mb-6 -mx-6 px-6 pt-2 pb-5 border-b border-[#E5E5E3]">
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={points} margin={{ top: 4, right: 48, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#2DBDAA" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#2DBDAA" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#F0F0EE" />
          <XAxis
            dataKey="date"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tick={{ fontSize: 10, fill: '#9CA3AF', fontFamily: 'inherit', textRendering: 'geometricPrecision' }}
            tickFormatter={(v) => format(new Date(v), 'd MMM yy')}
            tickLine={false}
            axisLine={false}
            minTickGap={40}
          />
          <YAxis
            domain={[Math.max(0, minCost - pad), maxCost + pad]}
            tickFormatter={(v) =>
              new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(v)
            }
            tick={{ fontSize: 10, fill: '#9CA3AF', fontFamily: 'inherit' }}
            tickLine={false}
            axisLine={false}
            width={64}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const { date, cost, label } = payload[0].payload as typeof points[0]
              return (
                <div className="bg-white border border-[#E5E5E3] rounded-lg px-3 py-2 shadow-sm text-[12px]">
                  <p className="text-gray-400 mb-0.5">{format(new Date(date), 'dd MMM yyyy')}</p>
                  {payload[0].payload.previousCost != null && (
                    <p className="text-gray-400 text-[11px]">
                      {new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(payload[0].payload.previousCost)}
                      {' → '}
                    </p>
                  )}
                  <p className="font-semibold text-gray-900">
                    {new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(cost)}
                  </p>
                  <p className="text-gray-400">{label}</p>
                </div>
              )
            }}
          />
          <Area
            type="monotone"
            dataKey="cost"
            stroke="#2DBDAA"
            strokeWidth={2}
            fill="url(#costGradient)"
            dot={{ r: 3, fill: '#2DBDAA', strokeWidth: 0 }}
            activeDot={{ r: 4, fill: '#2DBDAA', strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
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
        <PriceChart history={data} />
      )}

      {data && data.length > 0 && (
        <div className="history-timeline max-h-56 overflow-y-auto pr-1">
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
