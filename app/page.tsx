"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useScroll, useTransform } from "framer-motion";
import { Icon } from "@/components/icon";
import { Logo } from "@/components/logo";
import { TABS } from "@/lib/tabs";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#compare", label: "Compare" },
  { href: "#faq", label: "FAQ" },
];

const FEATURES = [
  {
    icon: "filter_alt",
    title: "Local heuristic pre-filter",
    body: "Format, disposable-domain, and role-account checks run instantly, before anything touches the network.",
    isNative: false,
  },
  {
    icon: "dns",
    title: "Live MX + SMTP mailbox check",
    body: "Confirms the mailbox itself accepts mail — not just that the domain has a mail server.",
    isNative: true,
  },
  {
    icon: "report",
    title: "Catch-all detection",
    body: "Flags servers whose accept/reject answers can't be trusted, instead of guessing at a verdict.",
    isNative: true,
  },
  {
    icon: "smart_toy",
    title: "AI review of ambiguous cases",
    body: "Groq confirms or overturns the heuristic verdict, with automatic retry on rate limits.",
    isNative: false,
  },
  {
    icon: "auto_awesome",
    title: "AI-drafted outreach",
    body: "A personalized subject + body per contact, written from your pitch, proof points, CTA, and tone.",
    isNative: false,
  },
  {
    icon: "send",
    title: "Paced sending, your own Gmail",
    body: "Randomized delay between sends, cancel mid-run, CAN-SPAM footer included automatically.",
    isNative: false,
  },
  {
    icon: "how_to_reg",
    title: "Manual override on any row",
    body: "Disagree with a verdict? \"Mark valid\" gives you the final say, always.",
    isNative: false,
  },
  {
    icon: "ios_share",
    title: "Export at every stage",
    body: "Full results, valid-only, or generated drafts — download as CSV whenever you need to.",
    isNative: false,
  },
];

type CompareValue = true | false | string;
const COMPARE_ROWS: { capability: string; ours: CompareValue; validators: CompareValue; mass: CompareValue; isInverted?: boolean }[] = [
  { capability: "Local heuristic pre-filter (format, disposable domain, role account)", ours: true, validators: true, mass: "Varies" },
  { capability: "Live MX + SMTP mailbox check", ours: true, validators: true, mass: false },
  { capability: "Catch-all / inconsistent-response detection", ours: true, validators: true, mass: false },
  { capability: "AI-assisted review of ambiguous cases", ours: true, validators: "Not typical", mass: false },
  { capability: "Personalized AI-drafted outreach per contact", ours: true, validators: false, mass: "Varies (usually template/merge-tag)" },
  { capability: "Paced sending directly from your own Gmail account", ours: true, validators: false, mass: "Varies (own sending infra)" },
  { capability: "Requires uploading your list to a third-party hosted dashboard", ours: false, validators: true, mass: true, isInverted: true },
];

const FAQS = [
  {
    q: "What file formats can I upload?",
    a: "CSV only, via drag-and-drop or the file browser. Any column layout works — the parser auto-detects the email field.",
  },
  {
    q: "Does this store my email list anywhere?",
    a: "No database. Your list lives only in the browser session — in memory — and clears when you refresh or hit Start Over. Individual addresses are sent over HTTPS to Groq for the AI classification/drafting pass and to this app's own server for MX/SMTP checks — never to a separate storage or analytics service.",
  },
  {
    q: "What happens if Groq is rate-limited or unavailable?",
    a: "Validation and drafting automatically fall back to heuristic-only results — retried with backoff first, then gracefully degraded. You're never blocked by an AI outage.",
  },
  {
    q: "Will bulk sending get my Gmail account flagged?",
    a: "Sending is one address at a time with a randomized delay between each — choose Cautious, Balanced, or Fast pacing depending on your risk tolerance, and cancel mid-run whenever you want.",
  },
  {
    q: "Can I override a verdict I disagree with?",
    a: "Yes — every non-valid row in Results has a \"Mark valid\" action so you always have the final say.",
  },
  {
    q: "What do I need to bring?",
    a: "A Groq API key for validation and drafting. For sending, a Gmail address and app password, set server-side — nothing is asked of the person you're emailing.",
  },
];

// Interactive Pipeline Animation in Hero Section
function PipelineAnimation() {
  const [packets, setPackets] = useState<{ id: number; status: "valid" | "invalid"; label: string }[]>([]);
  const [validCount, setValidCount] = useState(0);
  const [junkCount, setJunkCount] = useState(0);

  useEffect(() => {
    let id = 0;
    const interval = setInterval(() => {
      const status = Math.random() > 0.4 ? "valid" : "invalid";
      const labels = {
        valid: ["hello@corp.io", "sales@acme.co", "j.doe@tech.net", "founders@grow.ai"],
        invalid: ["spam@tempmail.org", "no-domain.xyz", "user@disposable.co", "missing-mx"],
      };
      const labelList = labels[status];
      const label = labelList[Math.floor(Math.random() * labelList.length)];
      setPackets((prev) => [...prev.slice(-4), { id: id++, status, label }]);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative w-full max-w-[600px] aspect-[600/220] bg-surface-container-lowest/80 backdrop-blur-md rounded-2xl border border-outline/80 p-4 overflow-hidden flex flex-col justify-between shadow-2xl mx-auto select-none">
      {/* Header Bar */}
      <div className="flex justify-between items-center w-full z-10">
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
          </span>
          <span className="text-[10px] font-bold text-primary uppercase tracking-wider font-mono">Pipeline Active</span>
        </div>
        <span className="text-[9px] text-on-surface-variant/60 font-mono border border-outline/80 rounded px-1.5 py-0.5 bg-surface-container-low/50">
          Simulation
        </span>
      </div>

      {/* SVG Pipeline lines */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 600 220" preserveAspectRatio="none">
        {/* Horizontal main rail */}
        <line x1="72" y1="90" x2="480" y2="90" stroke="#1b1e25" strokeWidth="6" strokeLinecap="round" />
        <line x1="72" y1="90" x2="480" y2="90" stroke="#242933" strokeWidth="2" strokeLinecap="round" />
        
        <line x1="480" y1="90" x2="540" y2="90" stroke="#1b1e25" strokeWidth="6" strokeLinecap="round" />
        <line x1="480" y1="90" x2="540" y2="90" stroke="#242933" strokeWidth="2" strokeLinecap="round" />
        
        {/* Downward drop rail for junk */}
        <path d="M 480 90 L 480 160" fill="none" stroke="#1b1e25" strokeWidth="6" strokeLinecap="round" />
        <path d="M 480 90 L 480 160" fill="none" stroke="#242933" strokeWidth="2" strokeLinecap="round" strokeDasharray="4 4" />

        {/* Pulse glow background line */}
        <line x1="72" y1="90" x2="480" y2="90" stroke="var(--color-primary)" strokeWidth="6" strokeLinecap="round" className="opacity-15 blur-sm" />
        <line x1="72" y1="90" x2="480" y2="90" stroke="#a3e635" strokeWidth="2" strokeLinecap="round" className="animate-signal-flow opacity-40" />
      </svg>

      {/* Node Indicators */}
      {/* Node 1: Start / Upload */}
      <div
        style={{ left: "12%", top: "40.9%" }}
        className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center z-10"
      >
        <div className="w-8 h-8 rounded-full bg-surface-container border border-outline flex items-center justify-center shadow-lg">
          <Icon name="cloud_upload" className="text-[14px] text-on-surface-variant/70" />
        </div>
        <span className="absolute top-9 left-1/2 -translate-x-1/2 text-[9px] text-on-surface-variant font-mono uppercase tracking-wider whitespace-nowrap">
          Upload
        </span>
      </div>

      {/* Node 2: Local validation */}
      <div
        style={{ left: "31%", top: "40.9%" }}
        className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center z-10"
      >
        <div className="w-8 h-8 rounded-full bg-surface-container border border-outline flex items-center justify-center pulse-glow-border shadow-lg">
          <Icon name="filter_alt" className="text-[14px] text-primary" />
        </div>
        <span className="absolute top-9 left-1/2 -translate-x-1/2 text-[9px] text-on-surface-variant font-mono uppercase tracking-wider whitespace-nowrap">
          Local
        </span>
      </div>

      {/* Node 3: Live MX/SMTP Check */}
      <div
        style={{ left: "50%", top: "40.9%" }}
        className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center z-10"
      >
        <div className="w-8 h-8 rounded-full bg-surface-container border border-outline flex items-center justify-center pulse-glow-border shadow-lg">
          <Icon name="dns" className="text-[14px] text-primary" />
        </div>
        <span className="absolute top-9 left-1/2 -translate-x-1/2 text-[9px] text-on-surface-variant font-mono uppercase tracking-wider whitespace-nowrap">
          MX/SMTP
        </span>
      </div>

      {/* Node 4: AI Heuristics */}
      <div
        style={{ left: "69%", top: "40.9%" }}
        className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center z-10"
      >
        <div className="w-8 h-8 rounded-full bg-surface-container border border-outline flex items-center justify-center pulse-glow-border shadow-lg">
          <Icon name="smart_toy" className="text-[14px] text-primary" />
        </div>
        <span className="absolute top-9 left-1/2 -translate-x-1/2 text-[9px] text-on-surface-variant font-mono uppercase tracking-wider whitespace-nowrap">
          AI Review
        </span>
      </div>

      {/* Split point (Decision router) */}
      <div
        style={{ left: "80%", top: "40.9%" }}
        className="absolute -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-surface-container border border-outline flex items-center justify-center shadow z-10"
      >
        <div className="w-1.5 h-1.5 rounded-full bg-primary" />
      </div>

      {/* Valid Stack (far right) */}
      <div
        style={{ left: "90%", top: "40.9%" }}
        className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center z-10"
      >
        <div className="flex flex-col gap-0.5 w-10 h-10 items-center justify-end border border-outline-variant border-dashed rounded p-1 bg-surface-container-low/60 shadow-inner">
          <motion.div className="w-6 h-1 bg-primary rounded-sm shadow-[0_0_8px_rgba(163,230,53,0.4)]" animate={{ scaleY: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 2 }} />
          <div className="w-6 h-1 bg-primary/70 rounded-sm" />
          <div className="w-6 h-1 bg-primary/40 rounded-sm" />
        </div>
        <span className="absolute top-11 left-1/2 -translate-x-1/2 text-[9px] text-primary font-bold uppercase tracking-wider whitespace-nowrap">
          Valid ({validCount})
        </span>
      </div>

      {/* Junk Bin (bottom right/center) */}
      <div
        style={{ left: "80%", top: "72.7%" }}
        className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center z-10"
      >
        <div className="w-10 h-10 border border-red-500/20 border-dashed rounded flex items-center justify-center bg-red-950/10 shadow-inner">
          <Icon name="delete_outline" className="text-[18px] text-red-400 animate-pulse" />
        </div>
        <span className="absolute top-11 left-1/2 -translate-x-1/2 text-[9px] text-red-400 font-bold uppercase tracking-wider whitespace-nowrap">
          Junk ({junkCount})
        </span>
      </div>

      {/* Render travelling email packets */}
      <AnimatePresence>
        {packets.map((p) => {
          return (
            <motion.div
              key={p.id}
              initial={{ left: "12%", top: "40.9%", opacity: 0, scale: 0.8 }}
              animate={{
                left: ["12%", "31%", "50%", "69%", "80%", p.status === "valid" ? "90%" : "80%"],
                top: ["40.9%", "40.9%", "40.9%", "40.9%", "40.9%", p.status === "valid" ? "40.9%" : "72.7%"],
                opacity: [0, 1, 1, 1, 1, 0],
                scale: [0.8, 1, 1, 1, 1, 0.8]
              }}
              transition={{
                duration: 4.4,
                ease: "linear",
                times: [0, 0.22, 0.45, 0.68, 0.81, 1.0]
              }}
              onAnimationComplete={() => {
                if (p.status === "valid") {
                  setValidCount((c) => c + 1);
                } else {
                  setJunkCount((c) => c + 1);
                }
              }}
              exit={{ opacity: 0 }}
              className="absolute z-20 flex flex-col items-center pointer-events-none -translate-x-1/2 -translate-y-1/2"
              style={{ originX: 0.5, originY: 0.5 }}
            >
              {/* Pulsing travel dot */}
              <div className={cn(
                "w-3 h-3 rounded-full border shadow-[0_0_8px_currentColor]",
                p.status === "valid" ? "bg-primary border-primary text-primary" : "bg-red-500 border-red-500 text-red-500"
              )} />

              {/* Float-above email tracker tag */}
              <div className="absolute bottom-[16px] flex flex-col items-center">
                <div className={cn(
                  "px-2 py-0.5 rounded-full text-[9px] font-mono font-bold border shadow-lg bg-surface/95 backdrop-blur-sm whitespace-nowrap flex items-center gap-1",
                  p.status === "valid" ? "border-primary/30 text-primary" : "border-red-500/30 text-red-400"
                )}>
                  <Icon name="mail" className="text-[10px]" />
                  {p.label}
                </div>
                {/* Arrow pointer */}
                <div className={cn(
                  "w-1.5 h-1.5 rotate-45 border-r border-b -mt-[4px] bg-surface/95",
                  p.status === "valid" ? "border-primary/30" : "border-red-500/30"
                )} />
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>

      {/* Footer info text */}
      <div className="w-full flex justify-between items-center text-[9px] text-on-surface-variant/40 font-mono select-none z-10 pt-2 border-t border-outline-variant/30">
        <span>Processing outreach pulses in real-time</span>
        <span>Illustrative</span>
      </div>
    </div>
  );
}

// Scroll Scrub Stages Section
function ScrollScrubStages() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const scrolled = -rect.top;
      const viewportHeight = window.innerHeight;
      const height = rect.height;

      if (rect.top < viewportHeight && rect.bottom > 0) {
        // clamped scroll progress through the section height (minus the last viewport)
        const totalScrollable = height - viewportHeight;
        const progress = totalScrollable > 0 ? scrolled / totalScrollable : 0;
        const clamped = Math.max(0, Math.min(0.99, progress));
        const step = Math.floor(clamped * 6);
        setActiveStep(step);
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div ref={containerRef} className="relative min-h-[1800px] border-t border-outline-variant bg-surface-container-low py-16">
      <div className="sticky top-20 z-30 mx-auto max-w-6xl px-md lg:px-lg pointer-events-none">
        <div className="bg-surface/85 backdrop-blur-md rounded-2xl border border-outline p-6 shadow-xl pointer-events-auto">
          <div className="flex flex-col gap-sm md:flex-row md:items-center md:justify-between mb-6">
            <div>
              <span className="text-[10px] font-bold text-primary uppercase tracking-wider">How it works — 6 Stages</span>
              <h3 className="text-headline-md font-bold text-on-surface">Interactive Pipeline Journey</h3>
            </div>
            <span className="text-[11px] text-on-surface-variant font-mono bg-surface-container px-2 py-0.5 rounded">
              Scroll-scrub to advance stages
            </span>
          </div>

          {/* Connected Stepper Line */}
          <div className="relative flex justify-between items-center w-full px-4 mb-4">
            <div className="absolute left-6 right-6 top-1/2 -translate-y-1/2 h-[3px] bg-outline-variant rounded-full z-0 overflow-hidden">
              <motion.div
                className="h-full bg-primary"
                animate={{ width: `${(activeStep / 5) * 100}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>

            {TABS.map((tab, idx) => {
              const active = idx === activeStep;
              const completed = idx < activeStep;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    const el = document.getElementById(`stage-card-${idx}`);
                    if (el) el.scrollIntoView({ behavior: "smooth" });
                  }}
                  className="relative z-10 flex flex-col items-center justify-center group cursor-pointer focus:outline-none"
                >
                  <motion.div
                    className={cn(
                      "w-10 h-10 rounded-full border-2 flex items-center justify-center font-mono text-sm font-bold transition-all",
                      active
                        ? "bg-primary border-primary text-on-primary shadow-[0_0_12px_rgba(163,230,53,0.6)]"
                        : completed
                        ? "bg-surface-container border-primary text-primary"
                        : "bg-surface-container-low border-outline-variant text-on-surface-variant"
                    )}
                    animate={active ? { scale: 1.15 } : { scale: 1.0 }}
                    transition={{ duration: 0.2 }}
                  >
                    {idx + 1}
                  </motion.div>
                  <span className={cn(
                    "hidden md:block absolute top-12 text-[10px] uppercase font-bold tracking-wider whitespace-nowrap",
                    active ? "text-primary font-extrabold" : "text-on-surface-variant group-hover:text-on-surface"
                  )}>
                    {tab.label}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="h-8 md:hidden" />
        </div>
      </div>

      {/* Vertically Spaced Stage Content Cards */}
      <div className="mx-auto max-w-3xl px-md mt-16 space-y-[220px]">
        {TABS.map((tab, idx) => {
          const active = idx === activeStep;
          return (
            <motion.div
              id={`stage-card-${idx}`}
              key={tab.id}
              className={cn(
                "rounded-2xl border p-8 shadow-lg transition-all duration-500",
                active
                  ? "border-primary/40 bg-surface shadow-[0_4px_30px_rgba(163,230,53,0.05)] scale-100"
                  : "border-outline-variant bg-surface-container-lowest/50 opacity-40 scale-95"
              )}
            >
              <div className="flex items-center gap-md mb-4">
                <div className={cn(
                  "w-12 h-12 rounded-xl flex items-center justify-center border transition-all",
                  active ? "bg-primary/10 border-primary/30 text-primary" : "bg-surface-container border-outline text-on-surface-variant"
                )}>
                  <Icon name={tab.icon} className="text-[24px]" />
                </div>
                <div>
                  <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-primary">Stage {idx + 1}</span>
                  <h4 className="text-headline-md font-bold text-on-surface">{tab.label}</h4>
                </div>
              </div>
              <p className="text-body-lg text-on-surface-variant leading-relaxed">
                {tab.description}
              </p>

              {active && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="mt-6 border-t border-outline-variant/60 pt-4 flex items-center gap-xs text-xs font-mono text-primary"
                >
                  <Icon name="subdirectory_arrow_right" className="text-[14px]" />
                  <span>Interactive flow step active in workspace</span>
                </motion.div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// Sketched Refresh Animation for the Security Section
function SketchedRefreshPulse() {
  return (
    <div className="relative w-36 h-36 flex items-center justify-center bg-surface-container rounded-full border border-outline">
      {/* Outer pulsing ring */}
      <motion.div
        className="absolute inset-0 rounded-full border border-primary/40"
        initial={{ scale: 0.95, opacity: 0.8 }}
        animate={{ scale: [1, 2.0], opacity: [0.6, 0] }}
        transition={{ repeat: Infinity, duration: 3, ease: "easeOut" }}
      />
      <motion.div
        className="absolute inset-0 rounded-full border border-primary/30"
        initial={{ scale: 0.95, opacity: 0.8 }}
        animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
        transition={{ repeat: Infinity, duration: 3, ease: "easeOut", delay: 1 }}
      />

      {/* Sketched rotating loop */}
      <motion.svg
        width="60"
        height="60"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-primary z-10"
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 12, ease: "linear" }}
      >
        <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
        <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
        <path d="M16 16h5v5" />
      </motion.svg>
    </div>
  );
}

export default function Landing() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  return (
    <div className="min-h-full w-full bg-background text-on-surface font-sans antialiased">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-outline bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-md lg:px-lg">
          <Logo size="sm" />

          <nav className="hidden items-center gap-lg md:flex">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-label-md font-bold text-on-surface-variant transition-colors hover:text-primary"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-sm">
            <Link
              href="/validator"
              className="hidden items-center gap-sm rounded-lg bg-primary px-md py-sm text-label-md font-extrabold text-on-primary shadow-lg shadow-primary/20 transition-all hover:scale-[1.02] active:scale-95 sm:flex"
            >
              Launch App
              <Icon name="arrow_forward" className="text-[16px] font-extrabold" />
            </Link>
            <button
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="Toggle menu"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-outline text-on-surface-variant md:hidden cursor-pointer"
            >
              <Icon name={mobileMenuOpen ? "close" : "menu"} className="text-[20px]" />
            </button>
          </div>
        </div>

        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="border-t border-outline bg-surface px-md py-md md:hidden"
            >
              <div className="flex flex-col gap-sm">
                {NAV_LINKS.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className="rounded-lg px-md py-sm text-label-md font-semibold text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface"
                  >
                    {link.label}
                  </a>
                ))}
                <Link
                  href="/validator"
                  className="flex items-center justify-center gap-sm rounded-lg bg-primary px-md py-sm text-label-md font-bold text-on-primary"
                >
                  Launch App
                  <Icon name="arrow_forward" className="text-[16px]" />
                </Link>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-md py-xl lg:px-lg lg:py-xl">
        <div className="grid grid-cols-1 items-center gap-xl lg:grid-cols-2">
          <div className="space-y-lg">
            <div className="inline-flex items-center gap-xs rounded-full bg-primary/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-primary border border-primary/20">
              <Icon name="bolt" className="text-[14px]" />
              Validation + AI outreach, one pipeline
            </div>
            <div className="space-y-sm">
              <div className="w-16 h-[2px] bg-primary rounded-full" />
              <h1 className="text-display-lg font-extrabold tracking-tight text-on-surface leading-tight">
                Stop guessing which emails are real.
              </h1>
            </div>
            <p className="text-body-lg text-on-surface-variant leading-relaxed">
              Local heuristics catch the obvious junk instantly. Live MX and SMTP checks confirm the mailbox
              actually exists. Groq AI reviews anything still ambiguous — then writes and sends your outreach.
              Validate, draft, and send, without leaving one tool.
            </p>
            <div className="flex flex-col gap-sm sm:flex-row pt-md">
              <Link
                href="/validator"
                className="flex items-center justify-center gap-sm rounded-lg bg-primary px-lg py-md text-label-md font-extrabold text-on-primary shadow-xl shadow-primary/20 transition-all hover:scale-[1.02] active:scale-95"
              >
                Get Started — it&apos;s free to run
                <Icon name="arrow_forward" className="text-[18px]" />
              </Link>
              <a
                href="#how-it-works"
                className="flex items-center justify-center gap-sm rounded-lg border border-outline bg-surface px-lg py-md text-label-md font-bold text-on-surface transition-colors hover:bg-surface-container"
              >
                See how it works
              </a>
            </div>
          </div>

          {/* Illustrative Pipeline Live Mockup */}
          <div className="space-y-xs">
            <PipelineAnimation />
          </div>
        </div>
      </section>

      {/* How it works (Interactive Scroll Scrub) */}
      <section id="how-it-works">
        <ScrollScrubStages />
      </section>

      {/* Feature grid */}
      <section id="features" className="px-md py-xl lg:px-lg border-t border-outline">
        <div className="mx-auto max-w-6xl space-y-xl">
          <div className="space-y-xs text-center">
            <span className="text-[10px] font-bold uppercase tracking-wider text-primary">Features</span>
            <h2 className="text-headline-lg font-bold tracking-tight text-on-surface">What&apos;s running under the hood</h2>
            <p className="mx-auto max-w-2xl text-body-md text-on-surface-variant">
              No black box — every one of these is a real step in the pipeline, not an abstract marketing claim.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f, index) => {
              if (f.isNative) {
                // Dark Weighted Card for Pipeline Native features
                return (
                  <div
                    key={f.title}
                    className="col-span-1 sm:col-span-2 rounded-2xl bg-surface-container border border-primary/30 p-lg shadow-lg relative overflow-hidden pulse-glow-border group flex flex-col justify-between min-h-[220px]"
                  >
                    <div className="absolute top-4 right-4 flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-primary animate-ping" />
                      <span className="h-2 w-2 rounded-full bg-primary" />
                      <span className="text-[9px] font-mono text-primary font-bold uppercase tracking-wider">Pipeline Native</span>
                    </div>
                    <div>
                      <div className="mb-sm flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
                        <Icon name={f.icon} className="text-[20px]" />
                      </div>
                      <h3 className="text-body-lg font-bold text-on-surface mb-2 group-hover:text-primary transition-colors">{f.title}</h3>
                      <p className="text-body-sm text-on-surface-variant leading-relaxed">{f.body}</p>
                    </div>
                  </div>
                );
              }

              // Quiet card for generic ones
              return (
                <div
                  key={f.title}
                  className="rounded-xl border border-dashed border-outline-variant bg-transparent p-md flex flex-col justify-between min-h-[180px] hover:border-outline hover:bg-surface-container-low transition-all"
                >
                  <div>
                    <div className="mb-sm flex h-8 w-8 items-center justify-center rounded-lg bg-surface-container text-on-surface-variant/70 border border-outline">
                      <Icon name={f.icon} className="text-[16px]" />
                    </div>
                    <h3 className="text-body-sm font-semibold text-on-surface mb-1">{f.title}</h3>
                    <p className="text-body-sm text-on-surface-variant/80 leading-relaxed">{f.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Comparison */}
      <section id="compare" className="border-t border-outline bg-surface-container-low px-md py-xl lg:px-lg">
        <div className="mx-auto max-w-6xl space-y-xl">
          <div className="space-y-xs text-center">
            <span className="text-[10px] font-bold uppercase tracking-wider text-primary">Compare</span>
            <h2 className="text-headline-lg font-bold tracking-tight text-on-surface">How we differ</h2>
            <p className="mx-auto max-w-2xl text-body-md text-on-surface-variant">
              Compared by capability — dedicated validators and mass-mailing tools aren't built for this unified flow.
            </p>
          </div>

          <div className="overflow-hidden rounded-xl border border-outline bg-surface shadow-2xl">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-body-sm">
                <thead>
                  <tr className="border-b border-outline-variant bg-surface-container">
                    <th className="px-lg py-md text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Capability</th>
                    <th className="px-lg py-md text-center text-[10px] font-bold uppercase tracking-wider text-primary border-l border-r border-outline-variant/60 bg-primary/5">
                      Email Validator Pro
                    </th>
                    <th className="px-lg py-md text-center text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                      Dedicated validators
                    </th>
                    <th className="px-lg py-md text-center text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                      Mass-mailing tools
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {COMPARE_ROWS.map((row) => {
                    const isInverted = row.isInverted;
                    return (
                      <tr
                        key={row.capability}
                        className={cn(
                          "transition-colors hover:bg-surface-container-lowest",
                          isInverted && "bg-surface-container-low font-medium border-y border-outline"
                        )}
                      >
                        <td className={cn("px-lg py-md font-medium text-on-surface-variant", isInverted && "text-on-surface")}>
                          {row.capability}
                        </td>
                        <td className="px-lg py-md text-center border-l border-r border-outline-variant/60 bg-primary/5">
                          {isInverted ? (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 border border-primary/20 text-primary font-bold text-sm">
                              ✗
                            </span>
                          ) : (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/20 text-primary font-bold text-sm">
                              ●
                            </span>
                          )}
                        </td>
                        <td className="px-lg py-md text-center">
                          {row.validators === true ? (
                            <span className="text-on-surface-variant/80 font-bold text-sm">●</span>
                          ) : row.validators === false ? (
                            <span className="text-on-surface-variant/30 font-bold text-sm">✗</span>
                          ) : (
                            <span className="text-xs text-on-surface-variant">{row.validators}</span>
                          )}
                        </td>
                        <td className="px-lg py-md text-center">
                          {row.mass === true ? (
                            <span className="text-on-surface-variant/80 font-bold text-sm">●</span>
                          ) : row.mass === false ? (
                            <span className="text-on-surface-variant/30 font-bold text-xs">✗</span>
                          ) : (
                            <span className="text-xs text-on-surface-variant">{row.mass}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-center text-[11px] text-on-surface-variant leading-relaxed">
            * Dedicated validators category refers to services like ZeroBounce / NeverBounce. 
            Last row inverted is the privacy/security check we win on: we don&apos;t store your lists.
          </p>
        </div>
      </section>

      {/* Trust & security - Calm Dark Band */}
      <section className="px-md py-xl lg:px-lg border-t border-outline bg-surface-container-lowest relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-[3px] bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
        <div className="mx-auto max-w-4xl">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-xl items-center">
            <div className="md:col-span-2 space-y-md">
              <span className="text-[10px] font-bold uppercase tracking-wider text-primary">Trust &amp; Security</span>
              <h2 className="text-headline-lg font-bold text-on-surface">No database. No dashboard. No lock-in.</h2>
              <p className="text-body-md text-on-surface-variant leading-relaxed">
                Your data is protected by design. We hold no logs of your contact lists and process everything on the fly.
              </p>
              <div className="grid grid-cols-1 gap-md pt-sm">
                <div className="flex items-start gap-sm">
                  <div className="mt-1 h-2 w-2 rounded-full bg-primary" />
                  <p className="text-body-sm text-on-surface-variant">
                    <strong className="text-on-surface font-semibold">Local Session Storage:</strong> Your contacts live in memory, vanishing instantly the moment you refresh this page.
                  </p>
                </div>
                <div className="flex items-start gap-sm">
                  <div className="mt-1 h-2 w-2 rounded-full bg-primary" />
                  <p className="text-body-sm text-on-surface-variant">
                    <strong className="text-on-surface font-semibold">Direct Routing:</strong> Individual addresses map directly to Groq (AI processing) and our validator server, never touching third-party logs.
                  </p>
                </div>
                <div className="flex items-start gap-sm">
                  <div className="mt-1 h-2 w-2 rounded-full bg-primary" />
                  <p className="text-body-sm text-on-surface-variant">
                    <strong className="text-on-surface font-semibold">Gmail Auth:</strong> App credentials stay server-side for paced outreach, never saved or exposed to external entities.
                  </p>
                </div>
              </div>
            </div>
            
            {/* Sketched refresh pulse column */}
            <div className="flex flex-col items-center justify-center">
              <SketchedRefreshPulse />
              <span className="text-[10px] text-on-surface-variant/60 font-mono mt-3 text-center">
                Clears automatically on refresh
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-t border-outline bg-surface-container-low px-md py-xl lg:px-lg">
        <div className="mx-auto max-w-3xl space-y-lg">
          <div className="space-y-xs text-center">
            <span className="text-[10px] font-bold uppercase tracking-wider text-primary">FAQ</span>
            <h2 className="text-headline-lg font-bold tracking-tight text-on-surface">Frequently asked</h2>
          </div>
          <div className="space-y-sm">
            {FAQS.map((item, i) => {
              const open = openFaq === i;
              return (
                <div key={item.q} className="overflow-hidden rounded-xl border border-outline bg-surface shadow-sm">
                  <button
                    onClick={() => setOpenFaq(open ? null : i)}
                    className="flex w-full items-center justify-between gap-md px-md py-md text-left cursor-pointer transition-colors hover:bg-surface-container-low"
                  >
                    <span className="text-body-md font-semibold text-on-surface">{item.q}</span>
                    <Icon
                      name={open ? "remove" : "add"}
                      className={cn("shrink-0 text-[18px] text-primary transition-transform")}
                    />
                  </button>
                  {open && (
                    <p className="px-md pb-md text-body-sm text-on-surface-variant leading-relaxed border-t border-outline-variant/50 pt-2">
                      {item.a}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-md py-xl lg:px-lg border-t border-outline">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-md text-center">
          <Logo size="lg" />
          <p className="max-w-[28rem] text-body-sm text-on-surface-variant">
            Validate, draft, and send outreach — one pipeline, no third-party dashboard required.
          </p>
          <Link
            href="/validator"
            className="flex items-center gap-sm rounded-lg bg-primary px-lg py-md text-label-md font-extrabold text-on-primary shadow-lg shadow-primary/20 transition-all hover:scale-[1.02] active:scale-95"
          >
            Launch App
            <Icon name="arrow_forward" className="text-[18px]" />
          </Link>
          <p className="mt-md text-[12px] text-on-surface-variant/60 font-mono">
            © {new Date().getFullYear()} Email Validator Pro. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
