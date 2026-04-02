import { TopBar } from '@/components/layout/TopBar'
import { PriceUpdateTool } from '@/components/price-updates/PriceUpdateTool'

export default function PriceUpdatesPage() {
  return (
    <>
      <TopBar title="Price Updates" />
      <main className="flex flex-col h-[calc(100vh-48px)] p-6">
        <PriceUpdateTool />
      </main>
    </>
  )
}
