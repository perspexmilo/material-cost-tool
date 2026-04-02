'use client'

import { useState, useCallback } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { Tag } from '@/components/ui/Tag'
import { Button } from '@/components/ui/Button'
import type {
  ParseResult,
  ReviewRow,
  UnresolvedRow,
  Material,
  UpdateChange,
  BulkUpdateResponse,
} from '@/types'

interface ReviewTableProps {
  parseResult: ParseResult
  onCommitSuccess: (result: BulkUpdateResponse) => void
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatChangePercent(value: number): string {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

export function ReviewTable({ parseResult, onCommitSuccess }: ReviewTableProps) {
  const [rows, setRows] = useState<ReviewRow[]>(() =>
    parseResult.resolved.map((r) => ({
      materialId: r.materialId,
      materialDescription: r.materialDescription,
      supplier: r.supplier ?? '',
      currentCost: r.currentCost,
      proposedCost: r.proposedCost,
      changePercent: r.changePercent,
      effectiveDate: r.effectiveDate,
      confidence: r.confidence,
      rawText: r.rawText,
      aliasRawText: r.aliasRawText,
      selected: true,
      isEditing: false,
    }))
  )

  const [unresolvedRows, setUnresolvedRows] = useState<UnresolvedRow[]>(() =>
    parseResult.unresolved.map((u) => ({
      rawText: u.rawText,
      parsedRange: u.parsedRange,
      mappedMaterialId: null,
    }))
  )

  const [editingCost, setEditingCost] = useState<Record<string, string>>({})

  // Load all materials for dropdown in unresolved section
  const { data: allMaterials } = useQuery<Material[]>({
    queryKey: ['materials', {}],
    queryFn: async () => {
      const res = await fetch('/api/materials')
      if (!res.ok) throw new Error('Failed')
      const json = await res.json()
      return json.materials
    },
    enabled: unresolvedRows.length > 0,
  })

  const commitMutation = useMutation<BulkUpdateResponse, Error, UpdateChange[]>({
    mutationFn: async (changes) => {
      const res = await fetch('/api/materials/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Commit failed')
      }
      return res.json()
    },
    onSuccess: onCommitSuccess,
  })

  const toggleSelect = useCallback((materialId: string) => {
    setRows((prev) =>
      prev.map((r) => (r.materialId === materialId ? { ...r, selected: !r.selected } : r))
    )
  }, [])

  const toggleAll = useCallback(() => {
    const allSelected = rows.every((r) => r.selected)
    setRows((prev) => prev.map((r) => ({ ...r, selected: !allSelected })))
  }, [rows])

  const startEdit = useCallback((materialId: string, currentProposed: number) => {
    setEditingCost((prev) => ({ ...prev, [materialId]: currentProposed.toFixed(2) }))
    setRows((prev) =>
      prev.map((r) => (r.materialId === materialId ? { ...r, isEditing: true } : r))
    )
  }, [])

  const commitEdit = useCallback((materialId: string) => {
    const val = parseFloat(editingCost[materialId] ?? '')
    if (!isNaN(val) && val > 0) {
      setRows((prev) =>
        prev.map((r) => {
          if (r.materialId !== materialId) return r
          const changePercent =
            r.currentCost > 0 ? ((val - r.currentCost) / r.currentCost) * 100 : 0
          return {
            ...r,
            proposedCost: val,
            changePercent: Math.round(changePercent * 100) / 100,
            isEditing: false,
          }
        })
      )
    } else {
      setRows((prev) =>
        prev.map((r) => (r.materialId === materialId ? { ...r, isEditing: false } : r))
      )
    }
    setEditingCost((prev) => {
      const next = { ...prev }
      delete next[materialId]
      return next
    })
  }, [editingCost])

  const handleCommit = useCallback(() => {
    const changes: UpdateChange[] = []

    // Selected resolved rows
    for (const row of rows) {
      if (!row.selected) continue
      changes.push({
        materialId: row.materialId,
        proposedCost: row.proposedCost,
        effectiveDate: row.effectiveDate,
        updateSource: 'email-parse',
        aliasRawText: row.aliasRawText,
      })
    }

    // Manually mapped unresolved rows
    for (const u of unresolvedRows) {
      if (!u.mappedMaterialId) continue

      const material = allMaterials?.find((m) => m.id === u.mappedMaterialId)
      if (!material) continue

      let proposedCost = material.costPerSheet
      if (u.parsedRange.changeType === 'percentage') {
        proposedCost = material.costPerSheet * (1 + u.parsedRange.changeValue / 100)
      } else {
        proposedCost = material.costPerSheet + u.parsedRange.changeValue
      }
      proposedCost = Math.round(proposedCost * 100) / 100

      changes.push({
        materialId: u.mappedMaterialId,
        proposedCost,
        effectiveDate: u.parsedRange.effectiveDate,
        updateSource: 'email-parse',
        aliasRawText: u.parsedRange.name,
      })
    }

    if (changes.length === 0) return
    commitMutation.mutate(changes)
  }, [rows, unresolvedRows, allMaterials, commitMutation])

  const selectedCount = rows.filter((r) => r.selected).length
  const mappedUnresolvedCount = unresolvedRows.filter((r) => r.mappedMaterialId).length
  const totalToCommit = selectedCount + mappedUnresolvedCount

  const allSelected = rows.length > 0 && rows.every((r) => r.selected)

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Resolved table */}
      {rows.length > 0 && (
        <div className="flex-1 flex flex-col min-h-0 bg-white rounded-xl border border-[#E5E5E3] overflow-hidden">
          <div className="flex-none flex items-center justify-between px-4 py-3 border-b border-[#E5E5E3] bg-white z-10">
            <h3 className="text-[12px] font-semibold uppercase tracking-wider text-gray-500">
              Matched ({rows.length})
            </h3>
          </div>
          <div className="flex-1 overflow-y-auto">
            <table className="w-full data-table relative">
              <thead className="sticky top-0 z-10 bg-white shadow-sm ring-1 ring-black/5">
                <tr style={{ backgroundColor: '#FFFFFF', boxShadow: 'inset 0 -1px 0 #E5E5E3' }}>
                <th className="px-4 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="rounded border-gray-300 cursor-pointer"
                    style={{ accentColor: '#2DBDAA' }}
                  />
                </th>
                <th className="text-left px-4 py-3 text-gray-500">Material</th>
                <th className="text-right px-4 py-3 text-gray-500">Current</th>
                <th className="text-right px-4 py-3 text-gray-500">Proposed</th>
                <th className="text-right px-4 py-3 text-gray-500">Change</th>
                <th className="text-left px-4 py-3 text-gray-500">Effective Date</th>
                <th className="text-left px-4 py-3 text-gray-500">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isIncrease = row.changePercent > 0
                return (
                  <tr
                    key={row.materialId}
                    className="border-b border-[#F0F0EE] transition-colors duration-100 hover:bg-[#F7F7F5]"
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={row.selected}
                        onChange={() => toggleSelect(row.materialId)}
                        className="rounded border-gray-300 cursor-pointer"
                        style={{ accentColor: '#2DBDAA' }}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[13px] font-medium text-gray-900">
                        {row.materialDescription}
                      </p>
                      {row.supplier && (
                        <p className="text-[11px] text-gray-400 mt-0.5">{row.supplier}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="cost-cell tabular-nums text-gray-500">
                        {formatCurrency(row.currentCost)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.isEditing ? (
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          className="inline-edit-input text-right"
                          value={editingCost[row.materialId] ?? ''}
                          onChange={(e) =>
                            setEditingCost((prev) => ({
                              ...prev,
                              [row.materialId]: e.target.value,
                            }))
                          }
                          onBlur={() => commitEdit(row.materialId)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEdit(row.materialId)
                            if (e.key === 'Escape') {
                              setRows((prev) =>
                                prev.map((r) =>
                                  r.materialId === row.materialId ? { ...r, isEditing: false } : r
                                )
                              )
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEdit(row.materialId, row.proposedCost)}
                          className="cost-cell tabular-nums text-gray-900 hover:underline cursor-pointer"
                          title="Click to edit"
                        >
                          {formatCurrency(row.proposedCost)}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={`text-[12px] font-medium tabular-nums ${
                          isIncrease ? 'text-red-600' : 'text-[#1A7A6A]'
                        }`}
                      >
                        {formatChangePercent(row.changePercent)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[13px] text-gray-600">
                      {row.effectiveDate
                        ? format(parseISO(row.effectiveDate), 'dd MMM yyyy')
                        : 'Immediate'}
                    </td>
                    <td className="px-4 py-3">
                      <Tag variant={row.confidence === 'high' ? 'success' : 'warning'}>
                        {row.confidence === 'high' ? 'Auto-matched' : 'Review'}
                      </Tag>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Unresolved section */}
      {unresolvedRows.length > 0 && (
        <div className="flex-none bg-white rounded-xl border border-[#E5E5E3] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#E5E5E3] bg-white">
            <h3 className="text-[12px] font-semibold uppercase tracking-wider text-gray-500">
              Unresolved ({unresolvedRows.length}) — map manually
            </h3>
          </div>
          <div className="max-h-64 overflow-y-auto divide-y divide-[#F0F0EE]">
            {unresolvedRows.map((u, idx) => (
              <div key={idx} className="px-4 py-4">
                <div className="flex items-start gap-4">
                  <div className="flex-1">
                    <p className="text-[13px] font-medium text-gray-900">{u.parsedRange.name}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5 italic">&ldquo;{u.rawText}&rdquo;</p>
                    <p className="text-[12px] text-gray-500 mt-1">
                      Change:{' '}
                      {u.parsedRange.changeType === 'percentage'
                        ? `${u.parsedRange.changeValue > 0 ? '+' : ''}${u.parsedRange.changeValue}%`
                        : `${u.parsedRange.changeValue > 0 ? '+' : ''}£${Math.abs(u.parsedRange.changeValue).toFixed(2)}`}
                      {u.parsedRange.effectiveDate &&
                        ` · Effective ${format(parseISO(u.parsedRange.effectiveDate), 'dd MMM yyyy')}`}
                    </p>
                  </div>
                  <div className="w-72 shrink-0">
                    <select
                      className="w-full text-[13px] px-3 py-2 border border-[#E5E5E3] rounded-lg bg-white text-gray-900 focus:outline-none focus:ring-1 focus:ring-[#2DBDAA] focus:border-[#2DBDAA]"
                      value={u.mappedMaterialId ?? ''}
                      onChange={(e) => {
                        const val = e.target.value || null
                        setUnresolvedRows((prev) =>
                          prev.map((r, i) =>
                            i === idx ? { ...r, mappedMaterialId: val } : r
                          )
                        )
                      }}
                    >
                      <option value="">— Select material —</option>
                      {allMaterials?.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.description} ({m.supplier?.name})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Commit bar */}
      <div className="flex-none flex items-center justify-between bg-white rounded-xl border border-[#E5E5E3] px-4 py-3">
        <p className="text-[13px] text-gray-500">
          {totalToCommit} update{totalToCommit !== 1 ? 's' : ''} ready to commit
          {rows.some((r) => r.selected && r.effectiveDate) && (
            <span className="text-gray-400"> (some future-dated → staged)</span>
          )}
        </p>
        <div className="flex items-center gap-3">
          {commitMutation.isError && (
            <p className="text-[12px] text-red-600">{commitMutation.error?.message}</p>
          )}
          <Button
            variant="primary"
            disabled={totalToCommit === 0}
            loading={commitMutation.isPending}
            onClick={handleCommit}
          >
            Commit {totalToCommit > 0 ? `${totalToCommit} change${totalToCommit !== 1 ? 's' : ''}` : ''}
          </Button>
        </div>
      </div>
    </div>
  )
}
