import { TopBar } from '@/components/layout/TopBar'
import { CompetitorPricesView } from '@/components/competitor-prices/CompetitorPricesView'

export default function WoodCompetitorPricesPage() {
  return (
    <>
      <TopBar title="Wood Competitor Prices" />
      <main className="flex flex-col h-[calc(100vh-48px)] overflow-y-auto px-6 pb-6">
        <CompetitorPricesView category="wood" />
      </main>
    </>
  )
}
