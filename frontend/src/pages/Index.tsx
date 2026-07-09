import { Outlet } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AppShell } from '@/layouts/AppShell'

const Index = () => (
  <AppShell>
    <Outlet />
    <Toaster position="bottom-center" richColors visibleToasts={3} toastOptions={{ duration: 2200 }} />
  </AppShell>
)

export default Index
