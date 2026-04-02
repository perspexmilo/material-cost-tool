'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, parseISO, differenceInDays } from 'date-fns'
import { Clock, X } from 'lucide-react'
import type { StagedChange } from '@/types'

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function daysRemaining(effectiveDate: string): number {
  return differenceInDays(parseISO(effectiveDate), new Date())
}

interface StagedChangesTableProps {
  initialData: StagedChange[]
}

export function StagedChangesTable({ initialData }: StagedChangesTableProps) {
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const { data: changes } = useQuery<StagedChange[]>({
    queryKey: ['staged-changes'],
    queryFn: async () => {
      const res = await fetch('/api/staged-changes')
      if (!res.ok) throw new Error('Failed to fetch staged changes')
      return res.json()
    },
    initialData,
    staleTime: 30 * 1000,
  })

  const cancelMutation = useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const res = await fetch(`/api/staged-changes/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Cancel failed')
      }
    },
    onMutate: (id) => {
      setCancellingId(id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staged-changes'] })
    },
    onSettled: () => {
      setCancellingId(null)
    },
  })

  if (!changes || changes.length === 0) {
    return (
      <div className="flex-1 bg-white rounded-xl border border-[#E5E5E3]">
        <div className="flex flex-col h-full items-center justify-center py-16 px-8 text-center">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center mb-4"
            style={{ backgroundColor: '#EEEEEC' }}
          >
            <Clock size={20} className="text-gray-400" />
          </div>
          <p className="text-[14px] font-medium text-gray-600">No staged changes</p>
          <p className="text-[13px] text-gray-400 mt-1">
            Future-dated price updates will appear here until their effective date.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white rounded-xl border border-[#E5E5E3] overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <table className="w-full data-table relative">
          <thead className="sticky top-0 z-10 bg-white shadow-sm ring-1 ring-black/5">
            <tr style={{ backgroundColor: '#FFFFFF', boxShadow: 'inset 0 -1px 0 #E5E5E3' }}>
            <th className="text-left px-4 py-3 text-gray-500 w-[300px]">Material</th>
            <th className="text-right px-4 py-3 text-gray-500 w-[120px]">Current Cost</th>
            <th className="text-right px-4 py-3 text-gray-500 w-[120px]">Staged Cost</th>
            <th className="text-left px-4 py-3 text-gray-500 w-[140px]">Effective Date</th>
            <th className="text-left px-4 py-3 text-gray-500 w-[120px]">Days Remaining</th>
            <th className="text-left px-4 py-3 text-gray-500 w-[80px]">Source</th>
            <th className="w-16" />
          </tr>
        </thead>
        <tbody>
          {changes.map((change) => {
            const days = daysRemaining(change.effectiveDate)
            const isImminent = days <= 7
            const isPast = days < 0

            return (
              <tr
                key={change.id}
                className="border-b border-[#F0F0EE] hover:bg-[#F7F7F5] transition-colors duration-100"
              >
                <td className="px-4 py-3">
                  <p className="text-[13px] font-medium text-gray-900">
                    {change.material?.description ?? `Material ${change.materialId.slice(0, 8)}`}
                  </p>
                  {change.material?.supplier?.name && (
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {change.material.supplier.name}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="cost-cell tabular-nums text-gray-500">
                    {formatCurrency(change.currentCost)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="cost-cell tabular-nums text-gray-900">
                    {formatCurrency(change.proposedCost)}
                  </span>
                  {(() => {
                    const pct =
                      change.currentCost > 0
                        ? ((change.proposedCost - change.currentCost) / change.currentCost) * 100
                        : 0
                    const isUp = pct > 0
                    return (
                      <span
                        className={`ml-1.5 text-[11px] font-medium tabular-nums ${
                          isUp ? 'text-red-600' : 'text-[#1A7A6A]'
                        }`}
                      >
                        {isUp ? '+' : ''}
                        {pct.toFixed(1)}%
                      </span>
                    )
                  })()}
                </td>
                <td className="px-4 py-3 text-[13px] text-gray-600">
                  {format(parseISO(change.effectiveDate), 'dd MMM yyyy')}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`text-[13px] font-medium tabular-nums ${
                      isPast
                        ? 'text-orange-600'
                        : isImminent
                        ? 'text-[#B07D00]'
                        : 'text-gray-600'
                    }`}
                  >
                    {isPast ? 'Overdue' : days === 0 ? 'Today' : `${days}d`}
                  </span>
                </td>
                <td className="px-4 py-3 text-[12px] text-gray-400">
                  {change.updateSource === 'email-parse' ? 'Email' : change.updateSource}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => cancelMutation.mutate(change.id)}
                    disabled={cancellingId === change.id}
                    className="inline-flex items-center gap-1 text-[12px] text-red-500 hover:text-red-700 transition-colors disabled:opacity-40"
                    title="Cancel this staged change"
                  >
                    {cancellingId === change.id ? (
                      <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <X size={13} />
                    )}
                    Cancel
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      </div>

      <div className="flex-none px-4 py-3 border-t border-[#E5E5E3] flex items-center justify-between bg-white">
        <p className="text-[12px] text-gray-400">
          {changes.length} staged change{changes.length !== 1 ? 's' : ''} pending
        </p>
        <p className="text-[12px] text-gray-400">
          Applies automatically at 06:00 UTC each day
        </p>
      </div>
    </div>
  )
}
