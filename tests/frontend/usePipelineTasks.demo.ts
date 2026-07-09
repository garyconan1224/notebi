/**
 * 演示脚本：usePipelineTasks per-task 轮询机制
 * 
 * 使用说明：
 * 1. 在浏览器 Console 中手动执行此脚本片段
 * 2. 观察轮询的启动、运行、和清理过程
 */

// ── 模拟场景：创建并监听任务轮询 ──

import { isTaskTerminal } from '@/types/task'
import type { TaskRecord } from '@/types/task'

/**
 * 模拟 per-task 轮询逻辑
 * 演示 3 个任务的并发轮询过程
 */
function demonstratePolling() {
  console.log('🚀 启动 per-task 轮询演示\n')

  // 模拟 3 个活跃任务
  const mockTasks: TaskRecord[] = [
    {
      task_id: 'task-001',
      project_id: 'proj-test',
      task_type: 'download',
      status: 'DOWNLOADING',
      progress: 0.1,
      payload: {},
      log: [],
      result: {},
      error: '',
      retry_of: '',
      cancel_requested: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      task_id: 'task-002',
      project_id: 'proj-test',
      task_type: 'transcribing',
      status: 'TRANSCRIBING',
      progress: 0.25,
      payload: {},
      log: [],
      result: {},
      error: '',
      retry_of: '',
      cancel_requested: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      task_id: 'task-003',
      project_id: 'proj-test',
      task_type: 'summarizing',
      status: 'SUCCESS',  // 已完成，应该被过滤掉
      progress: 1.0,
      payload: {},
      log: [],
      result: { markdown: '...' },
      error: '',
      retry_of: '',
      cancel_requested: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ]

  // 第 1 步：过滤非终结状态任务
  console.log('📊 第 1 步：过滤活跃任务')
  const activeTasks = mockTasks.filter((t) => !isTaskTerminal(t.status))
  console.log(
    `  ✅ 已过滤：${activeTasks.length} 个活跃任务（共 ${mockTasks.length} 个）`,
  )
  activeTasks.forEach((t) => {
    console.log(`    - ${t.task_id} [${t.status}] progress=${Math.round(t.progress * 100)}%`)
  })

  // 第 2 步：为每个请求创建 AbortController
  console.log('\n🔗 第 2 步：为每个请求绑定 AbortController')
  const controllers = activeTasks.map(() => new AbortController())
  console.log(`  ✅ 已创建 ${controllers.length} 个 AbortController 实例`)

  // 第 3 步：模拟并发请求
  console.log('\n📡 第 3 步：发送 ${activeTasks.length} 个并发请求')
  activeTasks.forEach((task, idx) => {
    const isAborted = controllers[idx].signal.aborted
    console.log(`  [${idx + 1}] GET /pipeline/tasks/${task.task_id} (signal: ${isAborted ? '❌ aborted' : '✅ active'})`)
  })

  // 第 4 步：模拟清理
  console.log('\n🧹 第 4 步：清理飞行中的请求（模拟组件卸载）')
  controllers.forEach((ctrl, idx) => {
    ctrl.abort()
    console.log(`  [${idx + 1}] AbortController.abort() → signal.aborted=${ctrl.signal.aborted}`)
  })

  console.log('\n✅ 演示完成！\n')

  // 第 5 步：显示更新对比
  console.log('📈 模拟更新对比（progress 从 API 响应）')
  activeTasks.forEach((task) => {
    const oldProgress = Math.round(task.progress * 100)
    const newProgress = oldProgress + Math.floor(Math.random() * 15) // 随机增加
    console.log(`  ${task.task_id}: ${oldProgress}% → ${newProgress}% (via updateTask)`)
  })
}

// 导出演示函数供 Console 调用
export { demonstratePolling }

