"use client";

import Link from "next/link";
import Logo from "./Logo";
import NotificationsPopover from "./NotificationsPopover";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getToken, fetchWithAuth } from "@/lib/auth";

export default function Navbar() {
  const pathname = usePathname();
  const isDashboard = pathname?.startsWith("/dashboard");
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!isDashboard || !getToken()) return;

    fetchWithAuth("/notifications")
      .then((data) => setUnread(data.unreadCount || 0))
      .catch(() => {});
  }, [isDashboard, pathname]);

  const dashTabs = [
    { href: "/dashboard", label: "Dashboard", icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955a1.126 1.126 0 0 1 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
      </svg>
    )},
    { href: "/dashboard/friends", label: "Friends", icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
      </svg>
    )},
    { href: "/dashboard/leagues", label: "Leagues", icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 0 1 3 3h-15a3 3 0 0 1 3-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 0 1-.982-3.172M9.497 14.25a7.454 7.454 0 0 0 .981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 0 0 7.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0 1 16.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.023 6.023 0 0 1-2.27.308 6.023 6.023 0 0 1-2.27-.308" />
      </svg>
    )},
  ];

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname?.startsWith(href);
  }

  return (
    <nav className="w-full border-b border-purple-100 bg-white/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Logo size={36} />
          <span className="text-xl font-bold text-foreground">Focus Up</span>
        </Link>

        <div className="flex items-center gap-4">
          {isDashboard ? (
            <>
              <div className="flex items-center gap-1">
                {dashTabs.map((tab) => (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive(tab.href)
                        ? "bg-purple-100 text-purple-700"
                        : "text-foreground/50 hover:text-purple-500 hover:bg-purple-50"
                    }`}
                  >
                    {tab.icon}
                    <span className="hidden sm:inline">{tab.label}</span>
                  </Link>
                ))}
              </div>
              <NotificationsPopover unread={unread} onUnreadChange={setUnread} />
            </>
          ) : (
            <>
              <Link
                href="/#features"
                className="text-sm font-medium text-foreground/70 hover:text-purple-500 transition-colors"
              >
                Features
              </Link>
              <Link
                href="/dashboard"
                className="text-sm font-medium text-foreground/70 hover:text-purple-500 transition-colors"
              >
                Dashboard
              </Link>
              <Link
                href="/login"
                className="text-sm font-medium text-purple-600 hover:text-purple-700 transition-colors"
              >
                Log In
              </Link>
              <Link
                href="/signup"
                className="text-sm font-medium px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors"
              >
                Sign Up
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
