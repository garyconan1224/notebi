import { useTheme } from 'next-themes'
import { Sun, Moon, Monitor } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { FC } from 'react'

const ThemeSwitcher: FC = () => {
  const { theme, setTheme } = useTheme()

  const toggleTheme = () => {
    switch (theme) {
      case 'light':
        setTheme('dark')
        break
      case 'dark':
        setTheme('system')
        break
      default:
        setTheme('light')
        break
    }
  }

  const getIcon = () => {
    switch (theme) {
      case 'light':
        return <Sun className="h-4 w-4" />
      case 'dark':
        return <Moon className="h-4 w-4" />
      default:
        return <Monitor className="h-4 w-4" />
    }
  }

  const getTooltipText = () => {
    switch (theme) {
      case 'light':
        return '浅色主题'
      case 'dark':
        return '深色主题'
      default:
        return '系统主题'
    }
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleTheme}
            className="h-9 w-9 px-0"
          >
            {getIcon()}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <span>{getTooltipText()}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export default ThemeSwitcher

