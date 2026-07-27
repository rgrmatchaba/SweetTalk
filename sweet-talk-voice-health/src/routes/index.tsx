import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState, useEffect } from "react";
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  useScroll,
  useReducedMotion,
  AnimatePresence,
} from "framer-motion";
import {
  MessageCircle,
  BellRing,
  HeartHandshake,
  FileText,
  TrendingUp,
  Globe2,
  Check,
  ArrowRight,
  BookOpenText,
  Wallet,
  Users,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sweet Talk — The sugar diary that talks like a person" },
      {
        name: "description",
        content:
          "Log your glucose in a quick chat, get alerts when it matters, and keep your family and doctor in the loop. Built for Africa. Free to start.",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,600;12..96,700;12..96,800&display=swap",
      },
    ],
  }),
  component: LandingPage,
});

/* ────────────────────────────────────────────────────────────────────────────
   Palette (deliberately not the in-app theme, no default-AI purples/creams):
   ink    #0C231B  deep evergreen ink (ground)
   moss   #143528  raised panels on ink
   bone   #F6F3EC  paper sections
   honey  #E8A33D  accent — "sweet" amber
   clay   #C4553B  alerts only
   mist   #A8C0B5  muted text on ink
──────────────────────────────────────────────────────────────────────────── */

const display = { fontFamily: "'Bricolage Grotesque', 'Fraunces', serif" };

const easeOut = [0.22, 1, 0.36, 1] as const;

function Reveal({
  children,
  delay = 0,
  y = 28,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.7, delay, ease: easeOut }}
    >
      {children}
    </motion.div>
  );
}

/* ── The 3D phone: a real replay of the product's chat flow ──────────────── */

const chatScript = [
  { from: "user", text: "my sugar was 6.7 this morning" },
  {
    from: "bot",
    text: "Got it — 6.7 mmol/L, taken this morning. What did you eat, and how are you feeling?",
  },
  { from: "user", text: "sadza and greens, feeling fine" },
  {
    from: "bot",
    card: true,
    text: "this morning reading",
    rows: [
      ["Glucose", "6.7 mmol/L"],
      ["Food", "sadza and greens"],
      ["Feeling", "fine"],
    ],
  },
  { from: "user", text: "yes" },
  { from: "bot", saved: true, text: "Saved! Logged 6.7 mmol/L for this morning." },
] as const;

function PhoneChat() {
  const [step, setStep] = useState(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) {
      setStep(chatScript.length);
      return;
    }
    if (step >= chatScript.length) {
      const reset = setTimeout(() => setStep(0), 6000);
      return () => clearTimeout(reset);
    }
    const t = setTimeout(() => setStep((s) => s + 1), step === 0 ? 900 : 1400);
    return () => clearTimeout(t);
  }, [step, reduce]);

  return (
    <div className="flex h-full flex-col gap-2.5 overflow-hidden px-4 pt-4">
      <AnimatePresence>
        {chatScript.slice(0, step).map((m, i) => (
          <motion.div
            key={i}
            initial={reduce ? false : { opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.4, ease: easeOut }}
            className={m.from === "user" ? "flex justify-end" : "flex justify-start"}
          >
            {"card" in m && m.card ? (
              <div className="w-[88%] rounded-2xl rounded-bl-md border border-[#E8A33D]/30 bg-[#1B4433] p-3 text-[11px] leading-snug text-[#EDE7D8] shadow-lg">
                <p className="mb-1.5 font-semibold text-[#E8A33D]">{m.text}</p>
                {m.rows.map(([k, v]) => (
                  <div key={k} className="flex justify-between border-t border-white/5 py-1">
                    <span className="text-[#A8C0B5]">{k}</span>
                    <span className="font-medium">{v}</span>
                  </div>
                ))}
                <div className="mt-2 flex gap-1.5">
                  <span className="rounded-full bg-[#E8A33D] px-3 py-0.5 text-[10px] font-semibold text-[#0C231B]">
                    Save
                  </span>
                  <span className="rounded-full border border-white/15 px-3 py-0.5 text-[10px] text-[#A8C0B5]">
                    Cancel
                  </span>
                </div>
              </div>
            ) : (
              <div
                className={
                  m.from === "user"
                    ? "max-w-[80%] rounded-2xl rounded-br-md bg-[#E8A33D] px-3.5 py-2 text-[11.5px] font-medium leading-snug text-[#0C231B] shadow"
                    : `max-w-[85%] rounded-2xl rounded-bl-md px-3.5 py-2 text-[11.5px] leading-snug shadow ${
                        "saved" in m && m.saved
                          ? "bg-[#2C5C44] text-[#DDF0E4]"
                          : "bg-[#1B4433] text-[#EDE7D8]"
                      }`
                }
              >
                {"saved" in m && m.saved && (
                  <Check className="mr-1 inline h-3 w-3 text-[#8BD8A8]" strokeWidth={3} />
                )}
                {m.text}
              </div>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function Phone3D() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  const rotateY = useSpring(useTransform(mx, [0, 1], [-14, 14]), { stiffness: 120, damping: 18 });
  const rotateX = useSpring(useTransform(my, [0, 1], [10, -10]), { stiffness: 120, damping: 18 });

  return (
    <div
      ref={ref}
      style={{ perspective: 1200 }}
      onMouseMove={(e) => {
        if (reduce || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        mx.set((e.clientX - r.left) / r.width);
        my.set((e.clientY - r.top) / r.height);
      }}
      onMouseLeave={() => {
        mx.set(0.5);
        my.set(0.5);
      }}
      className="relative mx-auto w-fit"
    >
      <motion.div
        style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
        initial={reduce ? false : { opacity: 0, y: 60, rotateX: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, delay: 0.3, ease: easeOut }}
        className="relative"
      >
        {/* phone body */}
        <div
          className="relative h-[560px] w-[272px] rounded-[42px] border border-white/10 bg-[#0A1F17] p-2.5"
          style={{
            boxShadow:
              "0 60px 100px -30px rgba(0,0,0,.7), 0 25px 45px -20px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.08)",
          }}
        >
          <div className="relative h-full w-full overflow-hidden rounded-[32px] bg-[#0F2A1F]">
            {/* status bar + app header */}
            <div className="flex items-center gap-2 border-b border-white/5 bg-[#0C231B] px-4 pb-3 pt-5">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#E8A33D] text-[13px]" style={display}>
                <span className="font-bold text-[#0C231B]">S</span>
              </div>
              <div>
                <p className="text-[11px] font-semibold text-[#EDE7D8]">Sweet Talk</p>
                <p className="text-[9px] text-[#8BD8A8]">● online</p>
              </div>
              <MessageCircle className="ml-auto h-3.5 w-3.5 text-[#A8C0B5]" />
            </div>
            <PhoneChat />
            {/* input bar */}
            <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 border-t border-white/5 bg-[#0C231B] px-4 py-3">
              <div className="flex-1 rounded-full bg-white/5 px-3 py-1.5 text-[10px] text-[#A8C0B5]">
                Tell me about a reading…
              </div>
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#E8A33D]">
                <ArrowRight className="h-3.5 w-3.5 text-[#0C231B]" />
              </div>
            </div>
          </div>
        </div>

        {/* floating 3D card — alert */}
        <motion.div
          style={{ transform: "translateZ(70px)" }}
          animate={reduce ? undefined : { y: [0, -10, 0] }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -left-32 top-16 hidden w-52 rounded-2xl border border-[#C4553B]/40 bg-[#241512]/95 p-3.5 shadow-2xl backdrop-blur md:block"
        >
          <div className="flex items-center gap-2">
            <BellRing className="h-4 w-4 text-[#E8825F]" />
            <p className="text-[11px] font-bold text-[#F1B9A5]">Low glucose alert</p>
          </div>
          <p className="mt-1.5 text-[10.5px] leading-snug text-[#E7CFC4]">
            2.8 mmol/L is below your safe level. Take 15g of fast-acting carbs now.
          </p>
        </motion.div>

        {/* floating 3D card — caregiver */}
        <motion.div
          style={{ transform: "translateZ(90px)" }}
          animate={reduce ? undefined : { y: [0, 12, 0] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: 1 }}
          className="absolute -right-36 bottom-24 hidden w-56 rounded-2xl border border-white/10 bg-[#143528]/95 p-3.5 shadow-2xl backdrop-blur md:block"
        >
          <div className="flex items-center gap-2">
            <HeartHandshake className="h-4 w-4 text-[#E8A33D]" />
            <p className="text-[11px] font-bold text-[#EDE7D8]">Daily summary → Tariro (London)</p>
          </div>
          <p className="mt-1.5 text-[10.5px] leading-snug text-[#A8C0B5]">
            Mum logged 3 readings today. Average 6.4 mmol/L. All within her safe range. ✓
          </p>
        </motion.div>

        {/* floating 3D card — trend */}
        <motion.div
          style={{ transform: "translateZ(50px)" }}
          animate={reduce ? undefined : { y: [0, -8, 0] }}
          transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
          className="absolute -right-24 top-6 hidden rounded-2xl border border-white/10 bg-[#143528]/95 px-4 py-3 shadow-2xl backdrop-blur md:block"
        >
          <p className="text-[10px] text-[#A8C0B5]">7-day average</p>
          <p className="text-xl font-bold text-[#8BD8A8]" style={display}>
            6.4 <span className="text-[11px] font-medium text-[#A8C0B5]">mmol/L</span>
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
}

/* ── Sections ────────────────────────────────────────────────────────────── */

function Nav() {
  return (
    <motion.nav
      initial={{ opacity: 0, y: -16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: easeOut }}
      className="fixed inset-x-0 top-0 z-50 border-b border-white/5 bg-[#0C231B]/80 backdrop-blur-md"
    >
      <div className="mx-auto flex max-w-6xl items-center gap-8 px-5 py-3.5">
        <a href="#top" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#E8A33D]">
            <span className="text-lg font-extrabold text-[#0C231B]" style={display}>
              S
            </span>
          </div>
          <span className="text-lg font-bold text-[#F6F3EC]" style={display}>
            Sweet&nbsp;Talk
          </span>
        </a>
        <div className="ml-auto hidden items-center gap-7 text-sm text-[#A8C0B5] md:flex">
          <a href="#problem" className="transition hover:text-[#F6F3EC]">Why</a>
          <a href="#how" className="transition hover:text-[#F6F3EC]">How it works</a>
          <a href="#family" className="transition hover:text-[#F6F3EC]">For family</a>
          <a href="#pricing" className="transition hover:text-[#F6F3EC]">Pricing</a>
        </div>
        <div className="ml-auto flex items-center gap-3 md:ml-0">
          <Link to="/auth" className="hidden text-sm font-medium text-[#A8C0B5] transition hover:text-[#F6F3EC] sm:block">
            Sign in
          </Link>
          <Link
            to="/auth"
            className="rounded-full bg-[#E8A33D] px-4 py-2 text-sm font-bold text-[#0C231B] shadow-lg shadow-[#E8A33D]/20 transition hover:bg-[#F2B658]"
          >
            Start free
          </Link>
        </div>
      </div>
    </motion.nav>
  );
}

function Hero() {
  const reduce = useReducedMotion();
  const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.12 } } };
  const item = {
    hidden: reduce ? {} : { opacity: 0, y: 24 },
    show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: easeOut } },
  };

  return (
    <header id="top" className="relative overflow-hidden bg-[#0C231B] pb-24 pt-32 text-[#F6F3EC]">
      {/* ambient glows */}
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[500px] w-[900px] -translate-x-1/2 rounded-full bg-[#E8A33D]/10 blur-[120px]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-[400px] w-[500px] rounded-full bg-[#2C5C44]/30 blur-[100px]" />

      <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 lg:grid-cols-[1.05fr_1fr]">
        <motion.div variants={stagger} initial="hidden" animate="show">
          <motion.p
            variants={item}
            className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#E8A33D]/30 bg-[#E8A33D]/10 px-4 py-1.5 text-xs font-semibold tracking-wide text-[#E8A33D]"
          >
            <Globe2 className="h-3.5 w-3.5" />
            BUILT FOR THE 24 MILLION LIVING WITH DIABETES IN AFRICA
          </motion.p>

          <motion.h1
            variants={item}
            className="text-[42px] font-extrabold leading-[1.05] tracking-tight sm:text-6xl"
            style={display}
          >
            Your sugar diary.
            <br />
            As easy as sending
            <br />
            <span className="text-[#E8A33D]">a text.</span>
          </motion.h1>

          <motion.p variants={item} className="mt-6 max-w-xl text-lg leading-relaxed text-[#A8C0B5]">
            Type{" "}
            <em className="text-[#EDE7D8]">"my sugar was 6.7 this morning after sadza"</em> — Sweet
            Talk logs it, warns you when a reading is dangerous, and keeps your family and your
            doctor in the loop. No forms. No lost notebooks.
          </motion.p>

          <motion.div variants={item} className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              to="/auth"
              className="group inline-flex items-center gap-2 rounded-full bg-[#E8A33D] px-7 py-3.5 text-base font-bold text-[#0C231B] shadow-xl shadow-[#E8A33D]/25 transition hover:bg-[#F2B658]"
            >
              Start logging free
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <a
              href="#how"
              className="inline-flex items-center gap-2 rounded-full border border-white/15 px-6 py-3.5 text-base font-semibold text-[#EDE7D8] transition hover:border-white/30 hover:bg-white/5"
            >
              See how it works
            </a>
          </motion.div>

          <motion.div variants={item} className="mt-10 flex flex-wrap gap-x-8 gap-y-3 text-sm text-[#A8C0B5]">
            {[
              "Free to start — no card needed",
              "Works on any phone with a browser",
              "mmol/L and mg/dL",
            ].map((t) => (
              <span key={t} className="flex items-center gap-2">
                <Check className="h-4 w-4 text-[#8BD8A8]" strokeWidth={3} />
                {t}
              </span>
            ))}
          </motion.div>
        </motion.div>

        <Phone3D />
      </div>
    </header>
  );
}

const pains = [
  {
    icon: BookOpenText,
    stat: "3 readings",
    title: "The notebook lies",
    body:
      "You test faithfully, scribble it somewhere — and by clinic day the notebook is lost or half-empty. Your doctor makes decisions about your medication from the three readings you can remember.",
  },
  {
    icon: Wallet,
    stat: "R300+/month",
    title: "Expensive strips, wasted data",
    body:
      "Every test strip costs real money. But the numbers they produce go nowhere — no trends, no patterns, no answer to \"what does sadza actually do to my sugar?\" You pay for the data and then throw it away.",
  },
  {
    icon: Users,
    stat: "Too late",
    title: "The family finds out last",
    body:
      "Your daughter in London, your son in Joburg — they worry every day and hear about the bad readings weeks later, if at all. Distance shouldn't mean silence about the things that matter most.",
  },
];

function Problem() {
  return (
    <section id="problem" className="bg-[#F6F3EC] py-24 text-[#1C2B24]">
      <div className="mx-auto max-w-6xl px-5">
        <Reveal>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#C4553B]">The problem</p>
          <h2 className="mt-3 max-w-2xl text-4xl font-extrabold tracking-tight sm:text-5xl" style={display}>
            Managing diabetes shouldn't depend on a little notebook.
          </h2>
        </Reveal>
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {pains.map((p, i) => (
            <Reveal key={p.title} delay={i * 0.12}>
              <motion.div
                whileHover={{ y: -6, rotateX: 2, rotateY: -2 }}
                transition={{ type: "spring", stiffness: 260, damping: 20 }}
                style={{ transformStyle: "preserve-3d" }}
                className="h-full rounded-3xl border border-[#1C2B24]/8 bg-white p-7 shadow-[0_20px_50px_-20px_rgba(28,43,36,0.15)]"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0C231B]">
                  <p.icon className="h-5 w-5 text-[#E8A33D]" />
                </div>
                <p className="mt-5 text-3xl font-extrabold text-[#C4553B]" style={display}>
                  {p.stat}
                </p>
                <h3 className="mt-1 text-xl font-bold" style={display}>
                  {p.title}
                </h3>
                <p className="mt-3 leading-relaxed text-[#4A5A50]">{p.body}</p>
              </motion.div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

const steps = [
  {
    n: "01",
    title: "Write it like you'd say it",
    body:
      "\"My sugar was 6.7 this morning, I had sadza and greens, feeling fine.\" Type it in the words you actually use. Sweet Talk understands readings, meals, symptoms and times, even \"yesterday at 2pm\".",
    icon: MessageCircle,
  },
  {
    n: "02",
    title: "It's checked, then saved",
    body:
      "You see exactly what will be recorded and confirm with one tap. If a reading is dangerously low or high, you get clear, immediate guidance — take 15g of fast-acting carbs, drink water — not vague worry.",
    icon: BellRing,
  },
  {
    n: "03",
    title: "The right people know",
    body:
      "Your family gets a daily summary. Your doctor gets a clean, printable report of every reading, meal and pattern — months of real data instead of a guess. You walk into the clinic prepared.",
    icon: HeartHandshake,
  },
];

function HowItWorks() {
  return (
    <section id="how" className="relative overflow-hidden bg-[#0C231B] py-24 text-[#F6F3EC]">
      <div className="pointer-events-none absolute right-0 top-0 h-[400px] w-[600px] rounded-full bg-[#E8A33D]/8 blur-[120px]" />
      <div className="mx-auto max-w-6xl px-5">
        <Reveal>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#E8A33D]">How it works</p>
          <h2 className="mt-3 max-w-2xl text-4xl font-extrabold tracking-tight sm:text-5xl" style={display}>
            From reading to record in ten seconds.
          </h2>
        </Reveal>
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {steps.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.15}>
              <div className="relative h-full rounded-3xl border border-white/8 bg-[#143528] p-7">
                <span className="absolute right-6 top-5 text-5xl font-extrabold text-white/6" style={display}>
                  {s.n}
                </span>
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#E8A33D]/15">
                  <s.icon className="h-5 w-5 text-[#E8A33D]" />
                </div>
                <h3 className="mt-5 text-xl font-bold" style={display}>
                  {s.title}
                </h3>
                <p className="mt-3 leading-relaxed text-[#A8C0B5]">{s.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

const features = [
  {
    icon: MessageCircle,
    title: "Chat logging",
    body: "No forms, no dropdowns. Chat with it like a person — it asks for what's missing and never invents what you didn't say.",
  },
  {
    icon: BellRing,
    title: "Safety alerts, word for word",
    body: "Below 3.9 or above 10 mmol/L? You get exact, unsoftened guidance the moment it's saved — and your family can be alerted too.",
  },
  {
    icon: HeartHandshake,
    title: "Caregiver summaries",
    body: "A daily email to whoever you choose — a child abroad, a sibling in town. Readings, averages, and anything worth knowing.",
  },
  {
    icon: FileText,
    title: "Doctor-ready reports",
    body: "Export months of readings, meals and notes as a clean PDF. Your 5-minute consultation becomes a data-driven conversation.",
  },
  {
    icon: TrendingUp,
    title: "Food & trend analysis",
    body: "See what rice, sadza, or that Sunday braai actually does to your numbers. Patterns explained in plain English.",
  },
  {
    icon: Globe2,
    title: "Made for here",
    body: "mmol/L by default (mg/dL if you prefer), light on data, works on any phone browser — no app store, no big downloads.",
  },
];

function Features() {
  return (
    <section className="bg-[#F6F3EC] py-24 text-[#1C2B24]">
      <div className="mx-auto max-w-6xl px-5">
        <Reveal>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#C4553B]">What you get</p>
          <h2 className="mt-3 max-w-2xl text-4xl font-extrabold tracking-tight sm:text-5xl" style={display}>
            Everything the notebook never did.
          </h2>
        </Reveal>
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f, i) => (
            <Reveal key={f.title} delay={(i % 3) * 0.1}>
              <div className="group h-full rounded-3xl border border-[#1C2B24]/8 bg-white p-6 shadow-[0_16px_40px_-20px_rgba(28,43,36,0.12)] transition hover:shadow-[0_24px_50px_-20px_rgba(28,43,36,0.2)]">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0C231B] transition group-hover:bg-[#E8A33D]">
                  <f.icon className="h-5 w-5 text-[#E8A33D] transition group-hover:text-[#0C231B]" />
                </div>
                <h3 className="mt-4 text-lg font-bold" style={display}>
                  {f.title}
                </h3>
                <p className="mt-2 leading-relaxed text-[#4A5A50]">{f.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Family() {
  return (
    <section id="family" className="relative overflow-hidden bg-[#0C231B] py-24 text-[#F6F3EC]">
      <div className="pointer-events-none absolute left-0 top-1/3 h-[400px] w-[500px] rounded-full bg-[#C4553B]/10 blur-[120px]" />
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 lg:grid-cols-2">
        <Reveal>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#E8A33D]">For the family far from home</p>
          <h2 className="mt-3 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl" style={display}>
            You send money home.
            <br />
            Now send <span className="text-[#E8A33D]">peace of mind.</span>
          </h2>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-[#A8C0B5]">
            If you're in London, Atlanta or Dubai and your mother is managing diabetes in Harare,
            Lagos or Nairobi — the worry never stops. Sweet Talk's Family plan sends you her daily
            summary and alerts you the moment a reading is dangerous. She logs by chatting; you
            finally stop guessing.
          </p>
          <ul className="mt-7 space-y-3 text-[#EDE7D8]">
            {[
              "Daily summaries straight to your inbox",
              "Instant alerts for dangerous highs and lows",
              "You pay from abroad — she uses it free at home",
            ].map((t) => (
              <li key={t} className="flex items-start gap-3">
                <Check className="mt-1 h-4 w-4 shrink-0 text-[#8BD8A8]" strokeWidth={3} />
                {t}
              </li>
            ))}
          </ul>
          <Link
            to="/auth"
            className="group mt-8 inline-flex items-center gap-2 rounded-full bg-[#E8A33D] px-7 py-3.5 text-base font-bold text-[#0C231B] shadow-xl shadow-[#E8A33D]/25 transition hover:bg-[#F2B658]"
          >
            Set up the Family plan
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </Reveal>

        <Reveal delay={0.15}>
          <div style={{ perspective: 1000 }}>
            <motion.div
              initial={{ rotateY: -8, rotateX: 4 }}
              whileHover={{ rotateY: 0, rotateX: 0 }}
              transition={{ type: "spring", stiffness: 100, damping: 16 }}
              style={{ transformStyle: "preserve-3d" }}
              className="rounded-3xl border border-white/10 bg-[#143528] p-7 shadow-[0_50px_80px_-30px_rgba(0,0,0,0.6)]"
            >
              <div className="flex items-center gap-3 border-b border-white/8 pb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#E8A33D] font-bold text-[#0C231B]" style={display}>
                  S
                </div>
                <div>
                  <p className="text-sm font-bold">Sweet Talk — Daily Summary for Mum</p>
                  <p className="text-xs text-[#A8C0B5]">to tariro@…com · today 20:00</p>
                </div>
              </div>
              <div className="space-y-3 pt-4 text-sm text-[#EDE7D8]">
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <span className="text-[#A8C0B5]">Readings today</span>
                  <span className="font-semibold">3</span>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <span className="text-[#A8C0B5]">Average</span>
                  <span className="font-semibold text-[#8BD8A8]">6.4 mmol/L</span>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <span className="text-[#A8C0B5]">Highest / Lowest</span>
                  <span className="font-semibold">7.8 / 5.2</span>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <span className="text-[#A8C0B5]">Meals logged</span>
                  <span className="font-semibold">porridge, sadza & greens, rice</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#A8C0B5]">On time</span>
                  <span className="font-semibold text-[#8BD8A8]">3 of 3 ✓</span>
                </div>
              </div>
              <p className="mt-5 rounded-xl bg-[#0C231B] px-4 py-3 text-xs leading-relaxed text-[#A8C0B5]">
                "Feeling good today, took a walk after lunch." — Mum's note, 14:32
              </p>
            </motion.div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

const tiers = [
  {
    name: "Free",
    price: "R0",
    cadence: "forever",
    blurb: "Start today. No card, no catch.",
    features: [
      "20 AI chat logs per month",
      "Unlimited manual logging",
      "Charts & full history",
      "Low / high glucose alerts",
    ],
    cta: "Start free",
    highlight: false,
  },
  {
    name: "Premium",
    price: "R49",
    cadence: "per month · ≈ $3 / KSh 300 / ₦2,000",
    blurb: "Unlimited everything, for less than a week of test strips.",
    features: [
      "Unlimited chat logging",
      "Food & trend analysis",
      "Doctor-ready PDF reports",
      "Ask questions about your history",
      "Priority support",
    ],
    cta: "Go Premium",
    highlight: true,
  },
  {
    name: "Family",
    price: "$7.99",
    cadence: "per month, billed anywhere in the world",
    blurb: "You pay from abroad. They use everything free at home.",
    features: [
      "Everything in Premium — for them",
      "Daily summaries to your inbox",
      "Instant dangerous-reading alerts",
      "Up to 3 family recipients",
    ],
    cta: "Protect someone you love",
    highlight: false,
  },
];

function Pricing() {
  return (
    <section id="pricing" className="bg-[#F6F3EC] py-24 text-[#1C2B24]">
      <div className="mx-auto max-w-6xl px-5">
        <Reveal className="text-center">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#C4553B]">Pricing</p>
          <h2 className="mx-auto mt-3 max-w-2xl text-4xl font-extrabold tracking-tight sm:text-5xl" style={display}>
            Cheaper than the strips you already buy.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-[#4A5A50]">
            Pay with card, M-Pesa, MTN MoMo or EcoCash. Cancel anytime.
          </p>
        </Reveal>
        <div className="mt-14 grid items-stretch gap-6 lg:grid-cols-3">
          {tiers.map((t, i) => (
            <Reveal key={t.name} delay={i * 0.12}>
              <div
                className={
                  t.highlight
                    ? "relative flex h-full flex-col rounded-3xl bg-[#0C231B] p-8 text-[#F6F3EC] shadow-[0_40px_80px_-30px_rgba(12,35,27,0.5)]"
                    : "relative flex h-full flex-col rounded-3xl border border-[#1C2B24]/10 bg-white p-8 shadow-[0_20px_50px_-25px_rgba(28,43,36,0.15)]"
                }
              >
                {t.highlight && (
                  <span className="absolute -top-3.5 left-8 rounded-full bg-[#E8A33D] px-4 py-1 text-xs font-bold text-[#0C231B]">
                    MOST POPULAR
                  </span>
                )}
                <h3 className="text-lg font-bold" style={display}>
                  {t.name}
                </h3>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-5xl font-extrabold" style={display}>
                    {t.price}
                  </span>
                </div>
                <p className={`mt-1 text-xs ${t.highlight ? "text-[#A8C0B5]" : "text-[#6B7A70]"}`}>{t.cadence}</p>
                <p className={`mt-4 text-sm ${t.highlight ? "text-[#EDE7D8]" : "text-[#4A5A50]"}`}>{t.blurb}</p>
                <ul className="mt-6 flex-1 space-y-3 text-sm">
                  {t.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5">
                      <Check
                        className={`mt-0.5 h-4 w-4 shrink-0 ${t.highlight ? "text-[#E8A33D]" : "text-[#2C5C44]"}`}
                        strokeWidth={3}
                      />
                      <span className={t.highlight ? "text-[#EDE7D8]" : "text-[#33413A]"}>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  to="/auth"
                  className={
                    t.highlight
                      ? "mt-8 rounded-full bg-[#E8A33D] px-6 py-3 text-center text-sm font-bold text-[#0C231B] transition hover:bg-[#F2B658]"
                      : "mt-8 rounded-full border-2 border-[#0C231B] px-6 py-3 text-center text-sm font-bold text-[#0C231B] transition hover:bg-[#0C231B] hover:text-[#F6F3EC]"
                  }
                >
                  {t.cta}
                </Link>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

const faqs = [
  {
    q: "Is this medical advice?",
    a: "No. Sweet Talk records what you tell it, shows you your own patterns, and gives standard first-response guidance for dangerous readings (like taking fast-acting carbs for a low). Treatment decisions always belong to you and your doctor — and our reports make that conversation better.",
  },
  {
    q: "What phone do I need?",
    a: "Any phone with a web browser. There's nothing to install and it's light on data. If you can send a text message, you can use Sweet Talk.",
  },
  {
    q: "Is my health data private?",
    a: "Yes. Your readings are yours. Summaries go only to family members you explicitly add, and you can remove them anytime. We never sell health data.",
  },
  {
    q: "Does it work with my meter's units?",
    a: "Both mmol/L (South Africa, Zimbabwe, Kenya and most of the region) and mg/dL (Nigeria, Ghana) are supported — pick yours during setup.",
  },
  {
    q: "Can I log a reading I forgot yesterday?",
    a: "Yes — just say \"yesterday at 2pm it was 5.6\" and it's recorded on the right day, clearly marked, and confirmed with you before saving.",
  },
];

function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="bg-[#0C231B] py-24 text-[#F6F3EC]">
      <div className="mx-auto max-w-3xl px-5">
        <Reveal className="text-center">
          <h2 className="text-4xl font-extrabold tracking-tight" style={display}>
            Questions, answered.
          </h2>
        </Reveal>
        <div className="mt-12 space-y-3">
          {faqs.map((f, i) => (
            <Reveal key={f.q} delay={i * 0.06}>
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="w-full rounded-2xl border border-white/8 bg-[#143528] px-6 py-5 text-left transition hover:border-white/15"
              >
                <div className="flex items-center justify-between gap-4">
                  <span className="font-semibold" style={display}>
                    {f.q}
                  </span>
                  <motion.span animate={{ rotate: open === i ? 45 : 0 }} className="text-xl text-[#E8A33D]">
                    +
                  </motion.span>
                </div>
                <AnimatePresence>
                  {open === i && (
                    <motion.p
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: easeOut }}
                      className="overflow-hidden pt-3 text-sm leading-relaxed text-[#A8C0B5]"
                    >
                      {f.a}
                    </motion.p>
                  )}
                </AnimatePresence>
              </button>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="relative overflow-hidden bg-[#0C231B] pb-24 text-[#F6F3EC]">
      <div className="mx-auto max-w-6xl px-5">
        <Reveal>
          <div className="relative overflow-hidden rounded-[40px] bg-[#E8A33D] px-8 py-16 text-center text-[#0C231B] sm:px-16">
            <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/20 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-[#C4553B]/20 blur-3xl" />
            <h2 className="mx-auto max-w-2xl text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl" style={display}>
              Your next reading deserves better than a notebook.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg font-medium text-[#0C231B]/75">
              Log your first reading in the next 60 seconds. Free, on the phone already in your hand.
            </p>
            <Link
              to="/auth"
              className="group mt-8 inline-flex items-center gap-2 rounded-full bg-[#0C231B] px-8 py-4 text-base font-bold text-[#F6F3EC] shadow-2xl transition hover:scale-[1.03]"
            >
              Start free — no card needed
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/5 bg-[#0A1F17] py-10 text-sm text-[#A8C0B5]">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-5 md:flex-row md:justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#E8A33D]">
            <span className="font-extrabold text-[#0C231B]" style={display}>
              S
            </span>
          </div>
          <span className="font-bold text-[#F6F3EC]" style={display}>
            Sweet Talk
          </span>
        </div>
        <p className="max-w-md text-center text-xs leading-relaxed md:text-right">
          Sweet Talk is a tracking and communication tool, not a medical device. Always consult your
          healthcare provider about treatment. © {new Date().getFullYear()} Sweet Talk.
        </p>
      </div>
    </footer>
  );
}

function LandingPage() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 30 });

  return (
    <div className="min-h-screen bg-[#0C231B] font-sans">
      {/* scroll progress */}
      <motion.div
        style={{ scaleX, transformOrigin: "0% 50%" }}
        className="fixed inset-x-0 top-0 z-[60] h-[3px] bg-[#E8A33D]"
      />
      <Nav />
      <Hero />
      <Problem />
      <HowItWorks />
      <Features />
      <Family />
      <Pricing />
      <FAQ />
      <FinalCTA />
      <Footer />
    </div>
  );
}
