import { TopBar } from '@/components/layout/TopBar'
import { CompetitorPricesView } from '@/components/competitor-prices/CompetitorPricesView'

export default function PlasticCompetitorPricesPage() {
  return (
    <>
      <TopBar title="Plastic Competitor Prices" />
      <main className="flex flex-col h-[calc(100vh-48px)] overflow-y-auto px-6 pb-6">
        <CompetitorPricesView category="plastic" />
      </main>
    </>
  )
}
