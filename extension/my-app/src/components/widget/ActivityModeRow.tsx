"use client"

import { useId, useState } from "react"
import {
  Monitor,
  Pencil,
  Presentation,
  type LucideIcon,
} from "lucide-react"

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export type ActivityMode = "lecture" | "video" | "notes"

const modes: {
  id: ActivityMode
  tooltip: string
  Icon: LucideIcon
}[] = [
  { id: "lecture", tooltip: "lecture", Icon: Presentation },
  { id: "video", tooltip: "screen", Icon: Monitor },
  { id: "notes", tooltip: "notes", Icon: Pencil },
]

export interface ActivityModeRowProps {
  value?: ActivityMode
  defaultValue?: ActivityMode
  onValueChange?: (mode: ActivityMode) => void
  className?: string
}

export function ActivityModeRow({
  value: valueProp,
  defaultValue = "lecture",
  onValueChange,
  className,
}: ActivityModeRowProps) {
  const headingId = useId()
  const [uncontrolled, setUncontrolled] = useState<ActivityMode>(defaultValue)
  const value = valueProp ?? uncontrolled

  const setMode = (next: ActivityMode) => {
    if (valueProp === undefined) setUncontrolled(next)
    onValueChange?.(next)
  }

  return (
    <TooltipProvider delayDuration={200} skipDelayDuration={0}>
      <div className={cn("space-y-1.5", className)}>
        <p id={headingId} className="text-xs text-muted-foreground">
          Mode
        </p>
        <div
          role="toolbar"
          aria-labelledby={headingId}
          className="flex items-center justify-start gap-0.5"
        >
        {modes.map(({ id, tooltip, Icon }) => {
          const selected = value === id
          return (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setMode(id)}
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors",
                    "hover:bg-muted/90 hover:text-foreground",
                    selected &&
                      "bg-muted text-foreground ring-1 ring-border/80",
                  )}
                >
                  <Icon className="size-3.5" strokeWidth={2} aria-hidden />
                  <span className="sr-only">{tooltip} mode</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{tooltip}</TooltipContent>
            </Tooltip>
          )
        })}
        </div>
      </div>
    </TooltipProvider>
  )
}
