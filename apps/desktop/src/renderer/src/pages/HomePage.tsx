import AccountSidebar from '@/components/AccountSidebar'
import AccountStage from '@/components/AccountStage'
import { useAccounts, useSelectionStore } from '@/stores/accounts'

export default function HomePage(): React.JSX.Element {
  const { data } = useAccounts()
  const selectedId = useSelectionStore((s) => s.selectedId)
  const active = (data ?? []).find((a) => a.id === selectedId) ?? null

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
      <AccountSidebar />
      <AccountStage account={active} />
    </div>
  )
}
