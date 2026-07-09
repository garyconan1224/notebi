import './workbench.css'
import { Hero } from './Hero'
import { Composer } from './Composer'
import { RecentTasks } from './RecentTasks'

export default function WorkbenchPage() {
  return (
    <div className="workbench-scroll">
      <Hero />
      <div className="wb-content">
        <Composer />
      </div>
      <RecentTasks />
    </div>
  )
}
