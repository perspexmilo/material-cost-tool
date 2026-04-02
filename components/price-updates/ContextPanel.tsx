'use client'

import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, X, BookOpen } from 'lucide-react'
import type { ParserContextHint } from '@/types'

async function fetchHints(): Promise<ParserContextHint[]> {
  const res = await fetch('/api/parser-context')
  if (!res.ok) throw new Error('Failed to load context hints')
  return res.json()
}

export function ContextPanel() {
  const [draft, setDraft] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const queryClient = useQueryClient()

  const { data: hints = [], isLoading } = useQuery({
    queryKey: ['parser-context'],
    queryFn: fetchHints,
  })

  const addMutation = useMutation({
    mutationFn: async (hint: string) => {
      const res = await fetch('/api/parser-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hint }),
      })
      if (!res.ok) throw new Error('Failed to add hint')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['parser-context'] })
      setDraft('')
      textareaRef.current?.focus()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/parser-context/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete hint')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['parser-context'] }),
  })

  function handleAdd() {
    const trimmed = draft.trim()
    if (!trimmed || addMutation.isPending) return
    addMutation.mutate(trimmed)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleAdd()
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Explainer */}
      <div className="bg-[#F0FAF8] border border-[#2DBDAA]/20 rounded-lg px-3 py-2.5 flex gap-2">
        <BookOpen size={13} className="text-[#2DBDAA] mt-0.5 shrink-0" />
        <p className="text-[12px] text-[#1A5C52] leading-relaxed">
          Hints are injected into Claude&apos;s system prompt before each parse. Use them to explain
          supplier terminology, product naming conventions, or anything else that isn&apos;t obvious
          from the email alone.
        </p>
      </div>

      {/* Existing hints */}
      {isLoading ? (
        <div className="text-[12px] text-gray-400 px-1">Loading…</div>
      ) : hints.length === 0 ? (
        <div className="text-center py-6 text-[12px] text-gray-400">
          No context hints yet. Add your first one below.
        </div>
      ) : (
        <ul className="space-y-2">
          {hints.map((hint) => (
            <li
              key={hint.id}
              className="group flex items-start gap-2 bg-white border border-[#E5E5E3] rounded-lg px-3 py-2.5"
            >
              <span className="flex-1 text-[13px] text-gray-700 leading-relaxed">{hint.hint}</span>
              <button
                type="button"
                onClick={() => deleteMutation.mutate(hint.id)}
                disabled={deleteMutation.isPending}
                className="mt-0.5 shrink-0 text-gray-300 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                aria-label="Remove hint"
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Add new hint */}
      <div className="flex flex-col gap-2">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. XT acrylic = extruded, covers 2–6mm only. 8mm and above is cast acrylic."
          rows={3}
          className="w-full px-3 py-2 text-[13px] text-gray-900 placeholder:text-gray-400 border border-[#E5E5E3] rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-[#2DBDAA] focus:border-[#2DBDAA] leading-relaxed"
        />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-gray-400">⌘ Enter to add</span>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!draft.trim() || addMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-lg bg-[#2DBDAA] text-white hover:bg-[#27A896] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Plus size={13} />
            Add hint
          </button>
        </div>
        {addMutation.isError && (
          <p className="text-[12px] text-red-500">{addMutation.error?.message}</p>
        )}
      </div>
    </div>
  )
}
