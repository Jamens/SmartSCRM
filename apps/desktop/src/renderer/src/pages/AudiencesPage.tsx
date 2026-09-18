import { Target } from 'lucide-react'
import { ModulePlaceholder } from '@/components/ModulePlaceholder'

export default function AudiencesPage(): React.JSX.Element {
  return (
    <ModulePlaceholder
      icon={Target}
      title="人群包"
      description="按标签 / 平台 / 关键词组合的人群包管理将在 P3b 下一阶段接入。"
    />
  )
}
