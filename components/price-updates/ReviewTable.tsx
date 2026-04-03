'use client'

import { useState, useCallback, useMemo } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { CheckCircle, XCircle } from 'lucide-react'
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

// A "needs review" item: medium-confidence match, pre-populated but requires explicit approval
interface PendingReviewRow {
  materialId: string
  materialDescription: string
  currentCost: number
  proposedCost: number
  changePercent: number
  effectiveDate: string | null
  rawText: string
  aliasRawText: string
  supplier?: string
  // The material the user has selected (starts as the pre-populated match)
  selectedMaterialId: string
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
  // High-confidence matches → committed automatically unless unchecked
  const [rows, setRows] = useState<ReviewRow[]>(() =>
    parseResult.resolved
      .filter((r) => r.confidence === 'high')
      .map((r) => ({
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

  // Medium-confidence matches → need explicit Approve or Skip
  const [pendingRows, setPendingRows] = useState<PendingReviewRow[]>(() =>
    parseResult.resolved
      .filter((r) => r.confidence !== 'high')
      .map((r) => ({
        materialId: r.materialId,
        materialDescription: r.materialDescription,
        currentCost: r.currentCost,
        proposedCost: r.proposedCost,
        changePercent: r.changePercent,
        effectiveDate: r.effectiveDate,
        rawText: r.rawText,
        aliasRawText: r.aliasRawText,
        supplier: r.supplier,
        selectedMaterialId: r.materialId,
      }))
  )

  // No match → fully manual
  const [unresolvedRows, setUnresolvedRows] = useState<UnresolvedRow[]>(() =>
    parseResult.unresolved.map((u) => ({
      rawText: u.rawText,
      parsedRange: u.parsedRange,
      mappedMaterialId: null,
    }))
  )

  const [editingCost, setEditingCost] = useState<Record<string, string>>({})

  const isLathams = parseResult.manufacturers.includes('James Latham')
  const needsDropdown = pendingRows.length > 0 || unresolvedRows.length > 0

  // Load materials for dropdowns
  const { data: allMaterials } = useQuery<Material[]>({
    queryKey: ['materials', {}],
    queryFn: async () => {
      const res = await fetch('/api/materials')
      if (!res.ok) throw new Error('Failed')
      const json = await res.json()
      return json.materials
    },
    enabled: needsDropdown,
  })

  // Filtered + sorted dropdown list
  const dropdownMaterials = useMemo(() => {
    if (!allMaterials) return []
    const filtered = isLathams
      ? allMaterials.filter((m) => m.supplier?.name?.toLowerCase().includes('latham'))
      : allMaterials
    return [...filtered].sort((a, b) => {
      const typeA = (a.typeFinish ?? '').toLowerCase()
      const typeB = (b.typeFinish ?? '').toLowerCase()
      if (typeA !== typeB) return typeA.localeCompare(typeB)
      return a.description.localeCompare(b.description)
    })
  }, [allMaterials, isLathams])

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

  // ── Matched table handlers ──────────────────────────────────────────────────
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
          const changePercent = r.currentCost > 0 ? ((val - r.currentCost) / r.currentCost) * 100 : 0
          return { ...r, proposedCost: val, changePercent: Math.round(changePercent * 100) / 100, isEditing: false }
        })
      )
    } else {
      setRows((prev) =>
        prev.map((r) => (r.materialId === materialId ? { ...r, isEditing: false } : r))
      )
    }
    setEditingCost((prev) => { const next = { ...prev }; delete next[materialId]; return next })
  }, [editingCost])

  // ── Pending review handlers ─────────────────────────────────────────────────
  const approvePending = useCallback((pending: PendingReviewRow) => {
    // Find the selected material (may have been changed in dropdown)
    const material = allMaterials?.find((m) => m.id === pending.selectedMaterialId)
    const description = material?.description ?? pending.materialDescription
    const supplier = material?.supplier?.name ?? pending.supplier ?? ''
    const currentCost = material?.costPerSheet ?? pending.currentCost
    const proposedCost = pending.proposedCost
    const changePercent = currentCost > 0
      ? Math.round(((proposedCost - currentCost) / currentCost) * 10000) / 100
      : 0

    setRows((prev) => [
      ...prev,
      {
        materialId: pending.selectedMaterialId,
        materialDescription: description,
        supplier,
        currentCost,
        proposedCost,
        changePercent,
        effectiveDate: pending.effectiveDate,
        confidence: 'high' as const,
        rawText: pending.rawText,
        aliasRawText: pending.aliasRawText,
        selected: true,
        isEditing: false,
      },
    ])
    setPendingRows((prev) => prev.filter((r) => r.materialId !== pending.materialId))
  }, [allMaterials])

  const skipPending = useCallback((materialId: string) => {
    setPendingRows((prev) => prev.filter((r) => r.materialId !== materialId))
  }, [])

  // ── Commit ──────────────────────────────────────────────────────────────────
  const handleCommit = useCallback(() => {
    const changes: UpdateChange[] = []
    const updateSource = isLathams ? 'import' : 'email-parse'

    for (const row of rows) {
      if (!row.selected) continue
      changes.push({
        materialId: row.materialId,
        proposedCost: row.proposedCost,
        effectiveDate: row.effectiveDate,
        updateSource,
        aliasRawText: row.aliasRawText,
      })
    }

    for (const u of unresolvedRows) {
      if (!u.mappedMaterialId) continue
      const material = allMaterials?.find((m) => m.id === u.mappedMaterialId)
      if (!material) continue

      let proposedCost: number
      if (u.parsedRange.absoluteNewPrice != null) {
        proposedCost = Math.round(u.parsedRange.absoluteNewPrice * 100) / 100
      } else if (u.parsedRange.changeType === 'percentage') {
        proposedCost = Math.round(material.costPerSheet * (1 + u.parsedRange.changeValue / 100) * 100) / 100
      } else {
        proposedCost = Math.round((material.costPerSheet + u.parsedRange.changeValue) * 100) / 100
      }

      changes.push({
        materialId: u.mappedMaterialId,
        proposedCost,
        effectiveDate: u.parsedRange.effectiveDate,
        updateSource,
        aliasRawText: u.parsedRange.name,
      })
    }

    if (changes.length === 0) return
    commitMutation.mutate(changes)
  }, [rows, unresolvedRows, allMaterials, commitMutation, isLathams])

  const selectedCount = rows.filter((r) => r.selected).length
  const mappedUnresolvedCount = unresolvedRows.filter((r) => r.mappedMaterialId).length
  const totalToCommit = selectedCount + mappedUnresolvedCount

  const allSelected = rows.length > 0 && rows.every((r) => r.selected)

  return (
    <div className="flex flex-col h-full gap-4">

      {/* ── Tier 1: Matched (high confidence) ─────────────────────────────── */}
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
                  <th className="text-left px-4 py-3 text-gray-500">Effective</th>
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
                        <p className="text-[13px] font-medium text-gray-900">{row.materialDescription}</p>
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
                              setEditingCost((prev) => ({ ...prev, [row.materialId]: e.target.value }))
                            }
                            onBlur={() => commitEdit(row.materialId)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitEdit(row.materialId)
                              if (e.key === 'Escape')
                                setRows((prev) =>
                                  prev.map((r) =>
                                    r.materialId === row.materialId ? { ...r, isEditing: false } : r
                                  )
                                )
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
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Tier 2: Needs Review (medium confidence) ───────────────────────── */}
      {pendingRows.length > 0 && (
        <div className="flex-none bg-white rounded-xl border border-amber-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-amber-100 bg-amber-50 flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            <h3 className="text-[12px] font-semibold uppercase tracking-wider text-amber-700">
              Needs Review ({pendingRows.length}) — approve or skip each match
            </h3>
          </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-[#F0F0EE]">
            {pendingRows.map((pending) => {
              const isIncrease = pending.changePercent > 0
              // Find current cost from allMaterials if material was changed
              const selectedMaterial = allMaterials?.find((m) => m.id === pending.selectedMaterialId)
              const displayCurrentCost = selectedMaterial?.costPerSheet ?? pending.currentCost
              const displayChangePercent = displayCurrentCost > 0
                ? Math.round(((pending.proposedCost - displayCurrentCost) / displayCurrentCost) * 10000) / 100
                : 0

              return (
                <div key={pending.materialId} className="px-4 py-4">
                  <div className="flex items-start gap-4">
                    {/* Left: info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-gray-400 italic mb-1">&ldquo;{pending.rawText}&rdquo;</p>
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-[13px] font-medium text-gray-900 tabular-nums">
                          {formatCurrency(displayCurrentCost)}
                        </span>
                        <span className="text-gray-400">→</span>
                        <span className="text-[13px] font-semibold text-gray-900 tabular-nums">
                          {formatCurrency(pending.proposedCost)}
                        </span>
                        <span className={`text-[12px] font-medium tabular-nums ${isIncrease ? 'text-red-600' : 'text-[#1A7A6A]'}`}>
                          {formatChangePercent(displayChangePercent)}
                        </span>
                        {pending.effectiveDate && (
                          <span className="text-[11px] text-gray-400">
                            · {format(parseISO(pending.effectiveDate), 'dd MMM yyyy')}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Middle: dropdown — pre-selected, changeable */}
                    <div className="w-64 shrink-0">
                      <select
                        className="w-full text-[13px] px-3 py-2 border border-amber-300 rounded-lg bg-white text-gray-900 focus:outline-none focus:ring-1 focus:ring-[#2DBDAA] focus:border-[#2DBDAA]"
                        value={pending.selectedMaterialId}
                        onChange={(e) => {
                          const newId = e.target.value
                          setPendingRows((prev) =>
                            prev.map((r) =>
                              r.materialId === pending.materialId
                                ? { ...r, selectedMaterialId: newId }
                                : r
                            )
                          )
                        }}
                      >
                        {dropdownMaterials.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.typeFinish ? `[${m.typeFinish}] ` : ''}{m.description}
                          </option>
                        ))}
                        {/* Fallback: if the pre-selected material isn't in dropdownMaterials yet */}
                        {!dropdownMaterials.find((m) => m.id === pending.selectedMaterialId) && (
                          <option value={pending.selectedMaterialId}>{pending.materialDescription}</option>
                        )}
                      </select>
                    </div>

                    {/* Right: Approve / Skip */}
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => approvePending(pending)}
                        title="Approve — add to matched"
                        className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-[#1A7A6A] bg-[#E6F4F1] hover:bg-[#CCE9E4] rounded-lg transition-colors"
                      >
                        <CheckCircle size={13} />
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => skipPending(pending.materialId)}
                        title="Skip — don't commit"
                        className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-gray-500 bg-[#F7F7F5] hover:bg-[#EEEEEC] rounded-lg transition-colors"
                      >
                        <XCircle size={13} />
                        Skip
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Tier 3: Unresolved (no match) ─────────────────────────────────── */}
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
                      {u.parsedRange.absoluteNewPrice != null
                        ? `New price: £${u.parsedRange.absoluteNewPrice.toFixed(2)}`
                        : u.parsedRange.changeType === 'percentage'
                        ? `Change: ${u.parsedRange.changeValue > 0 ? '+' : ''}${u.parsedRange.changeValue}%`
                        : `Change: ${u.parsedRange.changeValue > 0 ? '+' : ''}£${Math.abs(u.parsedRange.changeValue).toFixed(2)}`}
                      {u.parsedRange.effectiveDate &&
                        ` · Effective ${format(parseISO(u.parsedRange.effectiveDate), 'dd MMM yyyy')}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="w-64">
                      <select
                        className="w-full text-[13px] px-3 py-2 border border-[#E5E5E3] rounded-lg bg-white text-gray-900 focus:outline-none focus:ring-1 focus:ring-[#2DBDAA] focus:border-[#2DBDAA]"
                        value={u.mappedMaterialId ?? ''}
                        onChange={(e) => {
                          const val = e.target.value || null
                          setUnresolvedRows((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, mappedMaterialId: val } : r))
                          )
                        }}
                      >
                        <option value="">— Select material —</option>
                        {dropdownMaterials.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.typeFinish ? `[${m.typeFinish}] ` : ''}{m.description}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={() => setUnresolvedRows((prev) => prev.filter((_, i) => i !== idx))}
                      title="Skip"
                      className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-gray-500 bg-[#F7F7F5] hover:bg-[#EEEEEC] rounded-lg transition-colors"
                    >
                      <XCircle size={13} />
                      Skip
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Commit bar ─────────────────────────────────────────────────────── */}
      <div className="flex-none flex items-center justify-between bg-white rounded-xl border border-[#E5E5E3] px-4 py-3">
        <div>
          <p className="text-[13px] text-gray-500">
            {totalToCommit} update{totalToCommit !== 1 ? 's' : ''} ready to commit
            {rows.some((r) => r.selected && r.effectiveDate) && (
              <span className="text-gray-400"> (some future-dated → staged)</span>
            )}
          </p>
          {pendingRows.length > 0 && (
            <p className="text-[11px] text-amber-600 mt-0.5">
              {pendingRows.length} item{pendingRows.length !== 1 ? 's' : ''} still need review
            </p>
          )}
        </div>
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
