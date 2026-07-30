import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Check,
  MessageCircle,
  BellRing,
  HeartHandshake,
  FileText,
} from "lucide-react";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Sweet Talk — Sign in or create your account" }],
    links: [
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,600;12..96,700;12..96,800&display=swap",
      },
    ],
  }),
  component: AuthPage,
});

/* Same palette as the landing page:
   ink #0C231B · moss #143528 · bone #F6F3EC · honey #E8A33D · mist #A8C0B5 */

const display = { fontFamily: "'Bricolage Grotesque', 'Fraunces', serif" };
const easeOut = [0.22, 1, 0.36, 1] as const;

type Mode = "signin" | "signup";

const copy = {
  signin: {
    heading: "Welcome back.",
    sub: "Your diary kept every reading safe while you were away. Pick up right where you left off.",
    button: "Sign in",
    switchPrompt: "New to Sweet Talk?",
    switchAction: "Create a free account",
  },
  signup: {
    heading: "Start your sugar diary.",
    sub: "Free to start, no card needed. Your first reading can be logged in the next 60 seconds.",
    button: "Create free account",
    switchPrompt: "Already have an account?",
    switchAction: "Sign in instead",
  },
} as const;

const signupPerks = [
  { icon: MessageCircle, text: "Log readings in a quick chat — no forms" },
  { icon: BellRing, text: "Clear alerts when a reading is dangerous" },
  { icon: HeartHandshake, text: "Daily summaries for the family you choose" },
  { icon: FileText, text: "Doctor-ready reports from months of real data" },
] as const;

function AuthPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [signupConfirmOpen, setSignupConfirmOpen] = useState(false);
  const [pendingConfirmEmail, setPendingConfirmEmail] = useState("");

  useEffect(() => {
    if (user) navigate({ to: "/dashboard", replace: true });
  }, [user, navigate]);

  const continueToSignIn = () => {
    setSignupConfirmOpen(false);
    setMode("signin");
    setPassword("");
    setShowPassword(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth` },
        });
        if (error) throw error;
        setPendingConfirmEmail(email.trim());
        setSignupConfirmOpen(true);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const c = copy[mode];

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0C231B] font-sans text-[#F6F3EC]">
      {/* ambient glows, matching the landing hero */}
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[500px] w-[900px] -translate-x-1/2 rounded-full bg-[#E8A33D]/10 blur-[120px]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-[400px] w-[500px] rounded-full bg-[#2C5C44]/30 blur-[100px]" />

      {/* top bar */}
      <motion.header
        initial={reduce ? false : { opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: easeOut }}
        className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-5 py-5"
      >
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#E8A33D]">
            <span className="text-lg font-extrabold text-[#0C231B]" style={display}>
              S
            </span>
          </div>
          <span className="text-lg font-bold" style={display}>
            Sweet&nbsp;Talk
          </span>
        </Link>
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-[#A8C0B5] transition hover:text-[#F6F3EC]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to home
        </Link>
      </motion.header>

      <main className="relative z-10 mx-auto grid min-h-[calc(100vh-160px)] max-w-6xl items-center gap-14 px-5 py-10 lg:grid-cols-[1fr_440px]">
        {/* left: pitch that changes with the mode */}
        <div className="hidden lg:block">
          <AnimatePresence mode="wait">
            <motion.div
              key={mode}
              initial={reduce ? false : { opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -16 }}
              transition={{ duration: 0.5, ease: easeOut }}
            >
              <h1
                className="max-w-lg text-5xl font-extrabold leading-[1.05] tracking-tight"
                style={display}
              >
                {mode === "signup" ? (
                  <>
                    Your next reading deserves better than{" "}
                    <span className="text-[#E8A33D]">a notebook.</span>
                  </>
                ) : (
                  <>
                    Good to see you{" "}
                    <span className="text-[#E8A33D]">again.</span>
                  </>
                )}
              </h1>
              <p className="mt-5 max-w-md text-lg leading-relaxed text-[#A8C0B5]">
                {mode === "signup"
                  ? "Tell Sweet Talk about a reading the way you'd tell a friend — it logs it, watches for danger, and keeps the right people in the loop."
                  : "Everything is where you left it — your history, your trends, and the people who care about your numbers."}
              </p>

              {mode === "signup" && (
                <ul className="mt-8 space-y-4">
                  {signupPerks.map((p, i) => (
                    <motion.li
                      key={p.text}
                      initial={reduce ? false : { opacity: 0, x: -16 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.5, delay: 0.15 + i * 0.1, ease: easeOut }}
                      className="flex items-center gap-3.5"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#E8A33D]/15">
                        <p.icon className="h-4.5 w-4.5 text-[#E8A33D]" />
                      </div>
                      <span className="text-[#EDE7D8]">{p.text}</span>
                    </motion.li>
                  ))}
                </ul>
              )}

              {mode === "signin" && (
                <motion.div
                  initial={reduce ? false : { opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.2, ease: easeOut }}
                  className="mt-8 max-w-sm rounded-2xl border border-white/10 bg-[#143528] p-5 shadow-2xl"
                >
                  <div className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-[#8BD8A8]" strokeWidth={3} />
                    <p className="text-sm font-bold text-[#EDE7D8]">While you were away</p>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-[#A8C0B5]">
                    Your readings, charts and caregiver summaries are exactly where you left them.
                    Sign in to add today's numbers.
                  </p>
                </motion.div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* right: the form card */}
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.1, ease: easeOut }}
          className="w-full"
        >
          <div className="rounded-3xl border border-white/10 bg-[#143528] p-8 shadow-[0_50px_80px_-30px_rgba(0,0,0,0.6)]">
            {/* mode toggle — position via left + x only; never use layout here.
                layout + percentage x re-projects on any reflow (keyboard, autofill,
                AnimatePresence sibling), which snaps the pill back to Sign in. */}
            <div
              className="relative mb-7 grid grid-cols-2 rounded-full bg-[#0C231B] p-1"
              role="tablist"
              aria-label="Account mode"
            >
              <motion.div
                aria-hidden
                className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-[#E8A33D]"
                initial={false}
                animate={{ x: mode === "signin" ? "0%" : "100%" }}
                transition={
                  reduce
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 400, damping: 32 }
                }
              />
              {(["signin", "signup"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => setMode(m)}
                  className={`relative z-10 rounded-full py-2 text-sm font-bold transition-colors ${
                    mode === m ? "text-[#0C231B]" : "text-[#A8C0B5] hover:text-[#F6F3EC]"
                  }`}
                >
                  {m === "signin" ? "Sign in" : "Sign up"}
                </button>
              ))}
            </div>

            {/* Copy/CTA animate on mode change; inputs stay mounted so typing
                never remounts the form or steals focus. */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={mode}
                initial={reduce ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, y: -8 }}
                transition={{ duration: 0.35, ease: easeOut }}
              >
                <h2 className="text-2xl font-extrabold tracking-tight" style={display}>
                  {c.heading}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-[#A8C0B5]">{c.sub}</p>
              </motion.div>
            </AnimatePresence>

            <form onSubmit={submit} className="mt-6 space-y-4">
              <div>
                <label htmlFor="email" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#A8C0B5]">
                  Email
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#A8C0B5]" />
                  <input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-[#0C231B] py-3 pl-10 pr-4 text-sm text-[#F6F3EC] placeholder:text-[#A8C0B5]/50 outline-none transition focus:border-[#E8A33D]/60 focus:ring-2 focus:ring-[#E8A33D]/20"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="password" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#A8C0B5]">
                  Password
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#A8C0B5]" />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={6}
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    placeholder={mode === "signup" ? "At least 6 characters" : "Your password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-[#0C231B] py-3 pl-10 pr-11 text-sm text-[#F6F3EC] placeholder:text-[#A8C0B5]/50 outline-none transition focus:border-[#E8A33D]/60 focus:ring-2 focus:ring-[#E8A33D]/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#A8C0B5] transition hover:text-[#F6F3EC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E8A33D]/40"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <motion.button
                type="submit"
                disabled={loading}
                whileTap={reduce ? undefined : { scale: 0.98 }}
                className="group mt-2 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#E8A33D] px-6 py-3.5 text-sm font-bold text-[#0C231B] shadow-xl shadow-[#E8A33D]/20 transition hover:bg-[#F2B658] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    {c.button}
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </>
                )}
              </motion.button>
            </form>

            <p className="mt-5 text-center text-sm text-[#A8C0B5]">
              {c.switchPrompt}{" "}
              <button
                type="button"
                onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
                className="font-semibold text-[#E8A33D] transition hover:text-[#F2B658]"
              >
                {c.switchAction}
              </button>
            </p>
          </div>

          <motion.p
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.5 }}
            className="mt-5 text-center text-xs leading-relaxed text-[#A8C0B5]/70"
          >
            Your readings are yours. We never sell health data.
          </motion.p>
        </motion.div>
      </main>

      <Dialog
        open={signupConfirmOpen}
        onOpenChange={(open) => {
          if (!open) continueToSignIn();
        }}
      >
        <DialogContent className="border-white/10 bg-[#143528] text-[#F6F3EC] sm:rounded-3xl sm:max-w-md [&_[data-slot=dialog-close],&>button.absolute]:text-[#A8C0B5] [&_>button.absolute]:hover:text-[#F6F3EC] [&_>button.absolute]:ring-[#E8A33D]/40">
          <DialogHeader className="space-y-3 text-center sm:text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#E8A33D]/15">
              <Mail className="h-5 w-5 text-[#E8A33D]" />
            </div>
            <DialogTitle className="text-xl font-extrabold tracking-tight text-[#F6F3EC]" style={display}>
              Confirm your email to continue
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 text-sm leading-relaxed text-[#A8C0B5]">
                <p>
                  Your Sweet Talk account has been created successfully.
                </p>
                <p>
                  Please check your inbox
                  {pendingConfirmEmail ? (
                    <>
                      {" "}
                      at <span className="font-semibold text-[#EDE7D8]">{pendingConfirmEmail}</span>
                    </>
                  ) : null}{" "}
                  and follow the confirmation link we sent you to activate your account.
                </p>
                <p>
                  Once confirmed, you may sign in and begin logging your readings.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2 sm:justify-center">
            <button
              type="button"
              onClick={continueToSignIn}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#E8A33D] px-6 py-3.5 text-sm font-bold text-[#0C231B] transition hover:bg-[#F2B658] sm:w-auto sm:min-w-[220px]"
            >
              Continue to sign in
              <ArrowRight className="h-4 w-4" />
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
