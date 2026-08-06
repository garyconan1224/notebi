import { Plus, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { FavoriteGroup } from '@/services/workspaces'

interface Props {
  search: string
  onSearch: (value: string) => void
  groupId: string
  onGroup: (value: string) => void
  groups: FavoriteGroup[]
  newGroup: string
  onNewGroup: (value: string) => void
  onAddGroup: () => Promise<void>
}

export function FavoriteOrganizer(props: Props) {
  const { t } = useTranslation('pages')

  return (
    <div className="fav-organizer">
      <label className="fav-search">
        <Search size={14} />
        <input value={props.search} onChange={event => props.onSearch(event.target.value)}
          placeholder="搜索收藏标题或合集" />
      </label>
      <select value={props.groupId} onChange={event => props.onGroup(event.target.value)}>
        <option value="__all__">{t('favorites.allGroups')}</option>
        {props.groups.map(group => (
          <option key={group.group_id} value={group.group_id}>
            {group.name}（{group.item_count}）
          </option>
        ))}
      </select>
      <label className="fav-new-group">
        <input value={props.newGroup}
          onChange={event => props.onNewGroup(event.target.value)}
          onKeyDown={event => event.key === 'Enter' && void props.onAddGroup()}
          placeholder="新分组名称" />
        <button onClick={() => void props.onAddGroup()} disabled={!props.newGroup.trim()}>
          <Plus size={14} />新建
        </button>
      </label>
    </div>
  )
}
