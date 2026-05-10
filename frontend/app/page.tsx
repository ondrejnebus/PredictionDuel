import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Swords, Scale, Shield, Coins } from "lucide-react";

export default function Home() {
  return (
    <div className="space-y-16 py-6">
      <section className="text-center space-y-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/40 px-3 py-1 text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          Live on Sepolia
        </div>
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
          Bet your prediction.
          <br />
          <span className="text-primary">Settle on-chain.</span>
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
          Trustless peer-to-peer wagers with asymmetric stakes, soulbound
          reputation, and a Kleros-style jury for disputes. No middleman, no
          custodian, no vault to drain.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Link href="/duels" className={cn(buttonVariants({ size: "lg" }))}>
            Browse Duels
          </Link>
          <Link
            href="/create"
            className={cn(buttonVariants({ size: "lg", variant: "outline" }))}
          >
            Create a Duel
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Feature icon={<Swords className="h-5 w-5" />} title="Asymmetric stakes">
          The creator picks both stakes - the favoured side risks more to win less.
        </Feature>
        <Feature icon={<Coins className="h-5 w-5" />} title="Pull-payment safety">
          Settlements credit a balance you withdraw yourself. A receiver that
          rejects ETH cannot brick the duel.
        </Feature>
        <Feature icon={<Scale className="h-5 w-5" />} title="Jury disputes">
          Disagreements escalate to a 1 - 3 - 5 juror panel with stake-slashing
          minority pressure.
        </Feature>
        <Feature
          icon={<Shield className="h-5 w-5" />}
          title="Soulbound reputation"
        >
          Every duel updates an on-chain ERC-721 reputation NFT, with stake-weighted
          wins and decaying scores.
        </Feature>
      </section>
    </div>
  );
}

function Feature({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="space-y-2 p-5">
        <div className="inline-flex rounded-md bg-primary/10 p-2 text-primary">
          {icon}
        </div>
        <h3 className="font-medium">{title}</h3>
        <p className="text-sm text-muted-foreground">{children}</p>
      </CardContent>
    </Card>
  );
}
