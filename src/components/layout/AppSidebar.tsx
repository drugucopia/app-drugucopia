'use client'

import Image from 'next/image'
import { ChevronLeft, ChevronRight, Github } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { type MouseEvent } from 'react'
import { NAV_ITEMS, NAV_SECTIONS, isNavItemActive, type NavItem } from './navigation'
import { cn } from '@/lib/utils'

interface AppSidebarProps {
  expanded: boolean
  onNavigate?: () => void
  onToggle: () => void
}

/**
 * Literal class name lookup so Tailwind's content scanner sees every
 * `text-<color>` and `bg-<color>` utility at build time. Dynamic
 * template strings like `text-${color}` would be purged.
 *
 * Active: full-opacity text color + a 10% background tint + ring.
 * Inactive: 70%-opacity text color (icon still visibly tinted).
 */
const COLOR_CLASSES: Record<
  NavItem['color'],
  { active: string; inactive: string }
> = {
  primary: { active: 'text-primary bg-primary/10 ring-primary/30', inactive: 'text-primary/70' },
  secondary: { active: 'text-secondary bg-secondary/10 ring-secondary/30', inactive: 'text-secondary/70' },
  accent: { active: 'text-accent bg-accent/10 ring-accent/30', inactive: 'text-accent/70' },
  info: { active: 'text-info bg-info/10 ring-info/30', inactive: 'text-info/70' },
  success: { active: 'text-success bg-success/10 ring-success/30', inactive: 'text-success/70' },
  warning: { active: 'text-warning bg-warning/10 ring-warning/30', inactive: 'text-warning/70' },
  error: { active: 'text-error bg-error/10 ring-error/30', inactive: 'text-error/70' },
}

export function AppSidebar({ expanded, onNavigate, onToggle }: AppSidebarProps) {
  const pathname = usePathname()
  const router = useRouter()

  const navigate = (href: string) => {
    onNavigate?.()
    router.push(href)
  }

  const handleBrandClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    navigate('/')
  }

  return (
    <aside
      className={cn(
        'flex min-h-full w-72 flex-col overflow-x-hidden border-r border-base-300 bg-base-200 transition-[width] duration-200 lg:sticky lg:top-0 lg:h-[100dvh] lg:overflow-hidden pb-[env(safe-area-inset-bottom,0px)]',
        expanded ? 'lg:w-60' : 'lg:w-16',
      )}
    >
      <div className={cn('navbar min-h-16 border-b border-base-300 pt-[env(safe-area-inset-top,0px)]', expanded ? 'px-3 sm:px-4' : 'px-2 lg:px-1.5')}>
        <button
          type="button"
          className={cn(
            'flex flex-1 w-full min-w-0 items-center gap-3 text-left',
            !expanded && 'lg:justify-center lg:gap-0',
          )}
          onClick={handleBrandClick}
          title="Drugucopia"
          aria-label="Go to Library"
        >
          <Image
            src={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/logo.png`}
            alt="Drugucopia"
            width={36}
            height={36}
            className="rounded-box shrink-0"
          />
          <div className={cn('min-w-0', !expanded && 'lg:hidden')}>
            <div className="text-sm font-semibold leading-tight">Drugucopia</div>
            <div className="text-xs text-neutral-content">
              Harm reduction toolkit
            </div>
          </div>
        </button>

        <button
          type="button"
          className="btn btn-ghost btn-square btn-sm ml-auto hidden lg:inline-flex"
          onClick={onToggle}
          aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
          title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {expanded ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      </div>

      <div className="flex-1 min-h-0 space-y-3 overflow-y-auto overflow-x-hidden p-2 lg:p-1.5">
        {NAV_SECTIONS.map((section) => {
          const items = NAV_ITEMS.filter((item) => item.section === section.section)

          return (
            <ul
              key={section.section}
              className={cn(
                'menu menu-md w-full rounded-box border border-base-300 bg-base-100 p-2',
                !expanded && 'lg:px-0.5 lg:py-2',
              )}
            >
              <li className={cn('menu-title px-2', !expanded && 'lg:hidden')}>
                <span>{section.title}</span>
              </li>
              {items.map((item) => {
                const isActive = isNavItemActive(item, pathname)
                const Icon = item.icon
                const colorClass = COLOR_CLASSES[item.color]

                return (
                  <li key={item.id} className="w-full">
                    <button
                      type="button"
                      onClick={() => navigate(item.href)}
                      className={cn(
                        // Layout: icon + label on ONE line, centered
                        // both horizontally and vertically. Override
                        // daisyUI .menu defaults which left-align.
                        'flex w-full items-center justify-center gap-2 min-h-11 px-2 rounded-md transition-colors',
                        // Icon/text color: each item uses its assigned
                        // semantic color. Active = full opacity + bg
                        // tint + ring; inactive = 70% opacity so the
                        // color is still visible but recedes.
                        isActive
                          ? cn(colorClass.active, 'lg:ring-1')
                          : colorClass.inactive,
                        !expanded && 'lg:!px-1.5 lg:!gap-0',
                      )}
                      title={item.label}
                      aria-current={isActive ? 'page' : undefined}
                      aria-label={item.label}
                      data-tip={!expanded ? item.label : undefined}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className={cn(!expanded && 'lg:hidden')}>{item.label}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )
        })}
      </div>

      <div className="border-t border-base-300 p-2 lg:p-1.5">
        <div
          className={cn(!expanded && 'tooltip tooltip-right w-full')}
          data-tip={!expanded ? 'GitHub' : undefined}
        >
          <a
            href="https://github.com/drugucopia/drugucopia.github.io"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'btn btn-ghost btn-block',
              expanded ? 'justify-center' : 'lg:!flex lg:!justify-center lg:!items-center lg:!gap-0 lg:px-1.5 lg:min-h-11',
            )}
            title="GitHub"
            aria-label="GitHub"
          >
            <Github className="h-4 w-4 shrink-0" />
            <span className={cn(!expanded && 'lg:hidden')}>GitHub</span>
          </a>
        </div>
      </div>
    </aside>
  )
}
