'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, AlertCircle, CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ReviewTable } from './ReviewTable'
import { ContextPanel } from './ContextPanel'
import type { ParseResult, BulkUpdateResponse } from '@/types'

type LeftTab = 'email' | 'context'

export function PriceUpdateTool() {
  const [activeTab, setActiveTab] = useState<LeftTab>('email')
  const [emailBody, setEmailBody] = useState('')
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [commitResult, setCommitResult] = useState<BulkUpdateResponse | null>(null)
  const queryClient = useQueryClient()

  const parseMutation = useMutation<ParseResult, Error, string>({
    mutationFn: async (body) => {
      const res = await fetch('/api/parse-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailBody: body }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Parse failed')
      }
      return res.json()
    },
    onSuccess: (result) => {
      setParseResult(result)
      setCommitResult(null)
    },
  })

  function handleParse() {
    if (!emailBody.trim()) return
    setParseResult(null)
    setCommitResult(null)
    parseMutation.mutate(emailBody)
  }

  function handleCommitSuccess(result: BulkUpdateResponse) {
    setCommitResult(result)
    // Invalidate materials and staged changes queries
    queryClient.invalidateQueries({ queryKey: ['materials'] })
    queryClient.invalidateQueries({ queryKey: ['staged-changes'] })
  }

  const hasContent = emailBody.trim().length > 0

  return (
    <div className="flex gap-6 min-h-[calc(100vh-48px-64px)]">
      {/* Left panel — 38% */}
      <div className="w-[38%] shrink-0 flex flex-col gap-4">
        <div className="bg-white rounded-xl border border-[#E5E5E3] overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-[#E5E5E3]">
            {(['email', 'context'] as LeftTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2.5 text-[12px] font-semibold capitalize tracking-wide transition-colors ${
                  activeTab === tab
                    ? 'text-[#2DBDAA] border-b-2 border-[#2DBDAA] -mb-px'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                {tab === 'email' ? 'Email' : 'Context'}
              </button>
            ))}
          </div>

          <div className="p-4">
            {activeTab === 'email' ? (
              <div className="flex flex-col gap-3">
                <div>
                  <label className="block text-[12px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
                    Paste Supplier Email
                  </label>
                  <textarea
                    value={emailBody}
                    onChange={(e) => setEmailBody(e.target.value)}
                    placeholder="Paste the full supplier price update email here…"
                    className="w-full h-64 px-3 py-2 text-[13px] text-gray-900 placeholder:text-gray-400 border border-[#E5E5E3] rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-[#2DBDAA] focus:border-[#2DBDAA] leading-relaxed"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-gray-400">
                    {emailBody.trim().length > 0
                      ? `${emailBody.trim().split(/\s+/).length} words`
                      : 'No content'}
                  </span>
                  <div className="flex items-center gap-2">
                    {hasContent && (
                      <button
                        type="button"
                        onClick={() => {
                          setEmailBody('')
                          setParseResult(null)
                          setCommitResult(null)
                        }}
                        className="text-[12px] text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        Clear
                      </button>
                    )}
                    <Button
                      variant="primary"
                      size="md"
                      disabled={!hasContent || parseMutation.isPending}
                      loading={parseMutation.isPending}
                      onClick={handleParse}
                    >
                      <RefreshCw size={14} />
                      Parse Email
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <ContextPanel />
            )}
          </div>
        </div>

        {/* Parse status */}
        {parseMutation.isPending && (
          <div className="bg-white rounded-xl border border-[#E5E5E3] p-4">
            <div className="flex items-center gap-3">
              <svg className="animate-spin h-4 w-4 text-[#2DBDAA]" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <div>
                <p className="text-[13px] font-medium text-gray-700">Parsing email with Claude…</p>
                <p className="text-[12px] text-gray-400">This usually takes 5–15 seconds</p>
              </div>
            </div>
          </div>
        )}

        {parseMutation.isError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <div className="flex items-start gap-2">
              <AlertCircle size={15} className="text-red-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-[13px] font-medium text-red-700">Parse failed</p>
                <p className="text-[12px] text-red-600 mt-0.5">{parseMutation.error?.message}</p>
              </div>
            </div>
          </div>
        )}

        {parseResult && !parseMutation.isPending && (
          <div className="bg-white rounded-xl border border-[#E5E5E3] p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1.5 h-1.5 rounded-full bg-[#2DBDAA]" />
              <p className="text-[12px] font-semibold uppercase tracking-wider text-gray-500">
                Parse Summary
              </p>
            </div>
            <div className="space-y-2">
              {parseResult.manufacturers.length > 0 && (
                <div>
                  <p className="text-[11px] text-gray-400 uppercase tracking-wide mb-1">Suppliers</p>
                  <div className="flex flex-wrap gap-1">
                    {parseResult.manufacturers.map((m) => (
                      <span
                        key={m}
                        className="text-[12px] px-2 py-0.5 bg-[#F7F7F5] border border-[#E5E5E3] rounded text-gray-700"
                      >
                        {m}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 mt-3">
                <Stat label="Matched" value={parseResult.resolved.length} color="text-[#1A7A6A]" />
                <Stat label="Unresolved" value={parseResult.unresolved.length} color="text-[#B07D00]" />
              </div>
            </div>
          </div>
        )}

        {commitResult && (
          <div className="bg-[#E6F4F1] border border-[#2DBDAA]/30 rounded-xl p-4">
            <div className="flex items-start gap-2">
              <CheckCircle size={15} className="text-[#2DBDAA] mt-0.5 shrink-0" />
              <div>
                <p className="text-[13px] font-medium text-[#1A5C52]">Changes committed</p>
                <p className="text-[12px] text-[#2A7A6E] mt-0.5">
                  {commitResult.updated} updated immediately
                  {commitResult.staged > 0 && `, ${commitResult.staged} staged for later`}
                  {commitResult.errors.length > 0 && `, ${commitResult.errors.length} error(s)`}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right panel — 62% */}
      <div className="flex-1 min-w-0">
        {!parseResult && !parseMutation.isPending && (
          <div className="flex items-center justify-center h-full min-h-64">
            <div className="text-center">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
                style={{ backgroundColor: '#EEEEEC' }}
              >
                <RefreshCw size={20} className="text-gray-400" />
              </div>
              <p className="text-[13px] font-medium text-gray-500">No email parsed yet</p>
              <p className="text-[12px] text-gray-400 mt-1">
                Paste an email on the left and click &ldquo;Parse Email&rdquo;
              </p>
            </div>
          </div>
        )}

        {parseMutation.isPending && (
          <div className="flex items-center justify-center h-full min-h-64">
            <div className="text-center">
              <svg className="animate-spin h-8 w-8 text-[#2DBDAA] mx-auto mb-3" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-[13px] text-gray-500">Claude is reading the email…</p>
            </div>
          </div>
        )}

        {parseResult && !parseMutation.isPending && (
          <div className="fade-in">
            {parseResult.resolved.length === 0 && parseResult.unresolved.length === 0 ? (
              <div className="flex items-center justify-center h-64">
                <div className="text-center">
                  <p className="text-[13px] font-medium text-gray-500">No price changes found</p>
                  <p className="text-[12px] text-gray-400 mt-1">
                    The email may not contain recognizable price update data.
                  </p>
                </div>
              </div>
            ) : (
              <ReviewTable
                parseResult={parseResult}
                onCommitSuccess={handleCommitSuccess}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-[#F7F7F5] rounded-lg px-3 py-2">
      <p className={`text-xl font-semibold tabular-nums ${color}`}>{value}</p>
      <p className="text-[11px] text-gray-400 mt-0.5">{label}</p>
    </div>
  )
}
