import './App.css'
import { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import DesktopBootstrap from './desktop/DesktopBootstrap'
import { useAppearanceStore } from './store/appearanceStore'

function ReadyApp() {
  useEffect(() => {
    void useAppearanceStore.getState().initialize()
  }, [])

  return <RouterProvider router={router} />
}

export default function App() {
  return (
    <DesktopBootstrap>
      <ReadyApp />
    </DesktopBootstrap>
  )
}
