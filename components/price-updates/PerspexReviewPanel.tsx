'use client'

import { useState, useMemo } from 'react'
import { useMutation } from '@tanstack/react-query'
import { CheckCircle, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { PerspexParseResult, PerspexProductGroup, PerspexEntry } from '@/types'
import type { BulkUpdateResponse } from '@/types'

interface Props {
  result: PerspexParseResult
  onCommitSuccess: (result: BulkUpdateResponse) => void
}

interface RowKey { groupIdx: number; entryIdx: number }

function fmt(n: number) {
  return `£${n.toFixed(2)}`
}

function changeColor(pct: number) {
  if (pct > 0) return 'text-red-500'
  if (pct < 0) return 'text-emerald-600'
  return 'text-gray-400'
}

export function PerspexReviewPanel({ result, onCommitSuccess }: Props) {
  // Track which entries are checked (all on by default where matches found)
  const [checked, setChecked] = useState<Set<string>>(() => {
    const s = new Set<string>()
    result.productGroups.forEach((g, gi) => {
      g.entries.forEach((e, ei) => {
        if (e.matchedMaterials.length > 0) s.add(`${gi}:${ei}`)
      })
    })
    return s
  })

  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())

  function toggleRow(gi: number, ei: number) {
    const key = `${gi}:${ei}`
    setChecked(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function toggleGroup(gi: number) {
    const group = result.productGroups[gi]
    const groupKeys = group.entries.map((_, ei) => `${gi}:${ei}`)
    const allChecked = groupKeys.every(k => checked.has(k))
    setChecked(prev => {
      const next = new Set(prev)
      groupKeys.forEach(k => allChecked ? next.delete(k) : next.add(k))
      return next
    })
  }

  function toggleCollapse(gi: number) {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(gi) ? next.delete(gi) : next.add(gi)
      return next
    })
  }

  // Collect all updates to commit
  const pendingUpdates = useMemo(() => {
    const updates: Array<{ materialId: string; newCost: number; effectiveDate: string | null }> = []
    result.productGroups.forEach((g, gi) => {
      g.entries.forEach((e, ei) => {
        if (!checked.has(`${gi}:${ei}`)) return
        e.matchedMaterials.forEach(m => {
          updates.push({
            materialId: m.id,
            newCost: e.pricePerSheet,
            effectiveDate: result.effectiveDate,
          })
        })
      })
    })
    // Deduplicate by materialId — last writer wins (shouldn't normally conflict)
    const seen = new Map<string, typeof updates[number]>()
    updates.forEach(u => seen.set(u.materialId, u))
    return Array.from(seen.values())
  }, [checked, result])

  const commitMutation = useMutation<BulkUpdateResponse, Error, typeof pendingUpdates>({
    mutationFn: async (updates) => {
      const res = await fetch('/api/materials', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updates: updates.map(u => ({
            materialId: u.materialId,
            newCost: u.newCost,
            effectiveDate: u.effectiveDate,
            updateSource: 'import',
          })),
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Commit failed')
      }
      return res.json()
    },
    onSuccess: onCommitSuccess,
  })

  const totalMaterials = pendingUpdates.length
  const noMatchGroups = result.productGroups.filter(g =>
    g.entries.some(e => e.matchedMaterials.length === 0)
  ).length

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h2 className="text-[13px] font-semibold text-gray-900">
            Perspex Price List
            {result.quoteDate && (
              <span className="ml-2 text-gray-400 font-normal">({result.quoteDate})</span>
            )}
          </h2>
          <p className="text-[12px] text-gray-400 mt-0.5">
            {result.productGroups.length} product groups · {totalMaterials} materials selected
          </p>
        </div>
        {result.effectiveDate && (
          <span className="text-[11px] px-2 py-1 bg-amber-50 border border-amber-200 text-amber-700 rounded-md">
            Effective {result.effectiveDate}
          </span>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto min-h-0 rounded-xl border border-[#E5E5E3] bg-white">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 bg-[#F7F7F5] z-10">
            <tr className="border-b border-[#E5E5E3]">
              <th className="w-8 px-3 py-2.5" />
              <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide text-[11px]">Group / Sub-type</th>
              <th className="px-3 py-2.5 text-right font-semibold text-gray-500 uppercase tracking-wide text-[11px]">Thickness</th>
              <th className="px-3 py-2.5 text-right font-semibold text-gray-500 uppercase tracking-wide text-[11px]">£/m²</th>
              <th className="px-3 py-2.5 text-right font-semibold text-gray-500 uppercase tracking-wide text-[11px]">New price</th>
              <th className="px-3 py-2.5 text-right font-semibold text-gray-500 uppercase tracking-wide text-[11px]">Change</th>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide text-[11px]">Materials</th>
            </tr>
          </thead>
          <tbody>
            {result.productGroups.map((group, gi) => {
              const isCollapsed = collapsed.has(gi)
              const groupKeys = group.entries.map((_, ei) => `${gi}:${ei}`)
              const allChecked = groupKeys.every(k => checked.has(k))
              const someChecked = groupKeys.some(k => checked.has(k))
              const matchCount = group.entries.reduce((n, e) => n + e.matchedMaterials.length, 0)

              return [
                // Group header row
                <tr
                  key={`group-${gi}`}
                  className="bg-[#F7F7F5] border-b border-[#E5E5E3] cursor-pointer hover:bg-[#F0F0EE]"
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      ref={el => { if (el) el.indeterminate = someChecked && !allChecked }}
                      onChange={() => toggleGroup(gi)}
                      className="accent-[#2DBDAA] cursor-pointer"
                    />
                  </td>
                  <td
                    className="px-3 py-2 font-semibold text-gray-700 flex items-center gap-1.5"
                    colSpan={1}
                    onClick={() => toggleCollapse(gi)}
                  >
                    {isCollapsed ? <ChevronRight size={13} className="text-gray-400" /> : <ChevronDown size={13} className="text-gray-400" />}
                    <span>{group.groupName}</span>
                    <span className="mx-1 text-gray-300">·</span>
                    <span className="font-normal text-gray-500">{group.subType}</span>
                    {group.isColourCategory && (
                      <span className="ml-1.5 text-[10px] px-1.5 py-0.5 bg-violet-100 text-violet-600 rounded font-medium">BULK COLOUR</span>
                    )}
                    {!group.dbVariantType && (
                      <span className="ml-1.5 text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-600 rounded font-medium">NO MAPPING</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-400" colSpan={4}>
                    {group.entries.length} thicknesses · {matchCount} materials
                  </td>
                  <td className="px-3 py-2" />
                </tr>,

                // Entry rows
                ...(!isCollapsed ? group.entries.map((entry, ei) => {
                  const key = `${gi}:${ei}`
                  const isChecked = checked.has(key)
                  const hasMatches = entry.matchedMaterials.length > 0

                  // Average change % across matched materials
                  let avgChange: number | null = null
                  if (hasMatches) {
                    const changes = entry.matchedMaterials
                      .filter(m => m.currentCost > 0)
                      .map(m => ((entry.pricePerSheet - m.currentCost) / m.currentCost) * 100)
                    if (changes.length > 0) {
                      avgChange = changes.reduce((a, b) => a + b, 0) / changes.length
                    }
                  }

                  return (
                    <tr
                      key={key}
                      className={`border-b border-[#F0F0EE] transition-colors ${
                        isChecked ? 'bg-white' : 'bg-[#FAFAFA] opacity-60'
                      } ${hasMatches ? 'hover:bg-[#F5FAF9]' : ''}`}
                    >
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={!hasMatches}
                          onChange={() => hasMatches && toggleRow(gi, ei)}
                          className="accent-[#2DBDAA] cursor-pointer disabled:cursor-not-allowed disabled:opacity-30"
                        />
                      </td>
                      <td className="px-3 py-2 pl-8 text-gray-400">
                        {entry.sheetSize !== '3050x2030' && (
                          <span className="text-[10px] text-amber-500 mr-1">(derived)</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-gray-700 tabular-nums">
                        {entry.thicknessMm}mm
                      </td>
                      <td className="px-3 py-2 text-right text-gray-400 tabular-nums">
                        {entry.pricePerM2 != null ? fmt(entry.pricePerM2) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-gray-900 tabular-nums">
                        {fmt(entry.pricePerSheet)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {avgChange != null ? (
                          <span className={`font-medium ${changeColor(avgChange)}`}>
                            {avgChange > 0 ? '+' : ''}{avgChange.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {hasMatches ? (
                          <div className="flex flex-wrap gap-1">
                            {entry.matchedMaterials.slice(0, 3).map(m => (
                              <span
                                key={m.id}
                                className="text-[10px] px-1.5 py-0.5 bg-[#E6F4F1] text-[#1A7A6A] rounded truncate max-w-[180px]"
                                title={m.description}
                              >
                                {m.description}
                              </span>
                            ))}
                            {entry.matchedMaterials.length > 3 && (
                              <span className="text-[10px] text-gray-400">
                                +{entry.matchedMaterials.length - 3} more
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] text-amber-500">No DB match</span>
                        )}
                      </td>
                    </tr>
                  )
                }) : []),
              ]
            })}
          </tbody>
        </table>
      </div>

      {/* Commit bar */}
      <div className="shrink-0 mt-4 flex items-center justify-between gap-4 bg-white border border-[#E5E5E3] rounded-xl px-4 py-3">
        <div className="text-[12px] text-gray-500">
          {totalMaterials > 0 ? (
            <>
              <span className="font-semibold text-gray-800">{totalMaterials}</span> material
              {totalMaterials !== 1 ? 's' : ''} will be updated
              {noMatchGroups > 0 && (
                <span className="ml-2 text-amber-500">· {noMatchGroups} group{noMatchGroups !== 1 ? 's' : ''} with no DB match</span>
              )}
            </>
          ) : (
            <span className="text-gray-400">No rows selected</span>
          )}
        </div>
        <Button
          variant="primary"
          size="md"
          disabled={totalMaterials === 0 || commitMutation.isPending}
          loading={commitMutation.isPending}
          onClick={() => commitMutation.mutate(pendingUpdates)}
        >
          <CheckCircle size={14} />
          Commit {totalMaterials > 0 ? `${totalMaterials} update${totalMaterials !== 1 ? 's' : ''}` : 'updates'}
        </Button>
      </div>

      {commitMutation.isError && (
        <div className="mt-2 flex items-center gap-2 text-[12px] text-red-600">
          <AlertCircle size={13} />
          {commitMutation.error.message}
        </div>
      )}
    </div>
  )
}
