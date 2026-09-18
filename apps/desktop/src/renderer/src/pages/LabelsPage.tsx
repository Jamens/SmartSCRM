import { Tags } from 'lucide-react'
import { ModulePlaceholder } from '@/components/ModulePlaceholder'

export default function LabelsPage(): React.JSX.Element {
  return (
    <ModulePlaceholder
      icon={Tags}
      title="标签管理"
      description="标签分组与标签的增删改将在 P3b 下一阶段接入。"
    />
  )
}
