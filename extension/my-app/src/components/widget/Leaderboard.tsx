"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { ChevronDown, RefreshCw, Trophy, TrendingUp, TrendingDown, Minus } from "lucide-react"

export interface LeaderboardEntry {
  id: string
  name: string
  avatarUrl?: string
  focusTime: number // in minutes
  rank: number
  previousRank?: number
  isCurrentUser?: boolean
}

interface LeaderboardProps {
  entries: LeaderboardEntry[]
  currentUserRank?: number
  totalParticipants?: number
  onRefresh?: () => void
  refreshing?: boolean
  className?: string
}

function RankChange({ current, previous }: { current: number; previous?: number }) {
  if (previous === undefined) {
    return <Minus className="size-3 text-muted-foreground" />
  }
  
  const change = previous - current
  
  if (change > 0) {
    return (
      <span className="flex items-center text-emerald-500">
        <TrendingUp className="size-3" />
      </span>
    )
  }
  if (change < 0) {
    return (
      <span className="flex items-center text-rose-500">
        <TrendingDown className="size-3" />
      </span>
    )
  }
  return <Minus className="size-3 text-muted-foreground" />
}

function formatTime(minutes: number) {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

function getRankBadge(rank: number) {
  if (rank === 1) return "bg-amber-500/15 text-amber-600 dark:text-amber-400"
  if (rank === 2) return "bg-slate-400/15 text-slate-600 dark:text-slate-400"
  if (rank === 3) return "bg-orange-600/15 text-orange-700 dark:text-orange-400"
  return "bg-muted text-muted-foreground"
}

export function Leaderboard({
  entries,
  currentUserRank,
  totalParticipants,
  onRefresh,
  refreshing,
  className,
}: LeaderboardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  
  const topEntries = entries.slice(0, 3)
  const remainingEntries = entries.slice(3)
  const currentUser = entries.find((e) => e.isCurrentUser)

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded} className={className}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-full justify-between px-2 text-xs"
        >
          <span className="flex items-center gap-1.5">
            <Trophy className="size-3 text-black dark:text-white" />
            <span>Leaderboard</span>
            {currentUserRank && totalParticipants && (
              <span className="text-muted-foreground">
                #{currentUserRank}/{totalParticipants}
              </span>
            )}
          </span>
          <span className="flex items-center gap-1">
            {onRefresh && (
              <span
                role="button"
                tabIndex={0}
                aria-label="Refresh leaderboard"
                className="inline-flex items-center justify-center size-5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                onClick={(e) => {
                  e.stopPropagation()
                  onRefresh()
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation()
                    onRefresh()
                  }
                }}
              >
                <RefreshCw
                  className={cn(
                    "size-3",
                    refreshing && "animate-spin",
                  )}
                />
              </span>
            )}
            <ChevronDown
              className={cn(
                "size-3 text-muted-foreground transition-transform duration-200",
                isExpanded && "rotate-180"
              )}
            />
          </span>
        </Button>
      </CollapsibleTrigger>
      
      {/* Top-anchored height: expands downward / collapses upward (avoids shifting into the top of the viewport when the widget is top-right). */}
      <CollapsibleContent
        forceMount
        className={cn(
          "overflow-hidden transition-[max-height] duration-300 ease-in-out",
          "data-[state=closed]:max-h-0 data-[state=open]:max-h-[min(100vh,2000px)]",
          "data-[state=closed]:pointer-events-none",
        )}
      >
        <div className="mt-2 space-y-1.5">
          {topEntries.map((entry) => (
            <LeaderboardRow key={entry.id} entry={entry} />
          ))}
          
          {remainingEntries.length > 0 && (
            <>
              <div className="border-t my-1.5" />
              {remainingEntries.map((entry) => (
                <LeaderboardRow key={entry.id} entry={entry} />
              ))}
            </>
          )}
          
          {currentUser && currentUser.rank > 3 && !remainingEntries.some(e => e.id === currentUser.id) && (
            <>
              <div className="flex items-center justify-center py-0.5">
                <span className="text-xs text-muted-foreground">...</span>
              </div>
              <LeaderboardRow entry={currentUser} />
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function LeaderboardRow({ entry }: { entry: LeaderboardEntry }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 transition-colors",
        entry.isCurrentUser && "border-border bg-accent",
      )}
    >
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded text-[10px] font-semibold",
          getRankBadge(entry.rank)
        )}
      >
        {entry.rank}
      </span>
      
      <Avatar className="size-5">
        <AvatarImage src={entry.avatarUrl} alt={entry.name} />
        <AvatarFallback className="text-[10px]">
          {entry.name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      
      <span
        className={cn(
          "flex-1 truncate text-xs",
          entry.isCurrentUser && "font-medium"
        )}
      >
        {entry.name}
        {entry.isCurrentUser && (
          <span className="ml-1 text-muted-foreground">(you)</span>
        )}
      </span>
      
      <RankChange current={entry.rank} previous={entry.previousRank} />
      
      <span className="text-xs tabular-nums text-muted-foreground">
        {formatTime(entry.focusTime)}
      </span>
    </div>
  )
}
