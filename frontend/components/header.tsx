"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Swords } from "lucide-react";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/duels", label: "Browse" },
  { href: "/create", label: "Create" },
  { href: "/jury", label: "Jury" },
  { href: "/profile", label: "Profile" },
];

export function Header() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 w-full border-b border-border/60 bg-background/85 backdrop-blur">
      <div className="container flex h-16 max-w-5xl items-center justify-between gap-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Swords className="h-5 w-5 text-primary" />
          <span>PredictionDuel</span>
        </Link>
        <nav className="hidden gap-2 md:flex">
          {nav.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <ConnectButton
          accountStatus={{ smallScreen: "avatar", largeScreen: "full" }}
          chainStatus="icon"
          showBalance={{ smallScreen: false, largeScreen: true }}
        />
      </div>
    </header>
  );
}
