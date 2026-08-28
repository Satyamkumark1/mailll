"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Logo } from "@/components/logo";
import { Icon } from "@/components/icon";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/validator/upload";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("Please fill in both email and password.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Invalid email or password.");
      }

      // Successful login -> Redirect to destination page
      router.push(decodeURIComponent(callbackUrl));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed. Please check your credentials.");
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center bg-surface-container-lowest text-on-surface p-md overflow-hidden">
      {/* Dynamic Background Glow Elements */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-primary/20 rounded-full blur-[128px] pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-secondary/15 rounded-full blur-[128px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="w-full max-w-[440px] z-10"
      >
        <div className="rounded-2xl border border-outline/15 bg-surface-container/70 backdrop-blur-xl shadow-2xl p-xl sm:p-2xl flex flex-col gap-lg">
          {/* Header & Logo */}
          <div className="flex flex-col items-center gap-xs text-center">
            <div className="mb-2">
              <Logo size="lg" />
            </div>
            <h1 className="text-headline-sm font-bold tracking-tight text-on-surface">
              Welcome Back
            </h1>
            <p className="text-body-md text-on-surface-variant max-w-[320px]">
              Sign in to access your email verification dashboard and campaign outreach tools.
            </p>
          </div>

          {/* Error Alert */}
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="flex items-center gap-sm p-md rounded-xl bg-error-container/40 border border-error/30 text-error-container text-body-sm"
            >
              <Icon name="error" className="text-[20px] text-error flex-shrink-0" />
              <span>{error}</span>
            </motion.div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-md">
            {/* Email Field */}
            <div className="flex flex-col gap-xs">
              <label htmlFor="email" className="text-label-md font-medium text-on-surface-variant">
                Email Address
              </label>
              <div className="relative flex items-center">
                <Icon
                  name="mail"
                  className="absolute left-md text-[20px] text-on-surface-variant/60 pointer-events-none"
                />
                <input
                  id="email"
                  type="email"
                  required
                  placeholder="admin@elevique.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-[42px] pr-md py-sm rounded-xl border border-outline/20 bg-surface-container-high/60 text-on-surface text-body-md placeholder:text-on-surface-variant/40 focus:outline-none focus:border-secondary focus:ring-1 focus:ring-secondary transition-all"
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="flex flex-col gap-xs">
              <label htmlFor="password" className="text-label-md font-medium text-on-surface-variant">
                Password
              </label>
              <div className="relative flex items-center">
                <Icon
                  name="lock"
                  className="absolute left-md text-[20px] text-on-surface-variant/60 pointer-events-none"
                />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  required
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-[42px] pr-[44px] py-sm rounded-xl border border-outline/20 bg-surface-container-high/60 text-on-surface text-body-md placeholder:text-on-surface-variant/40 focus:outline-none focus:border-secondary focus:ring-1 focus:ring-secondary transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-md text-[20px] text-on-surface-variant/60 hover:text-on-surface transition-colors"
                >
                  <Icon name={showPassword ? "visibility_off" : "visibility"} />
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="mt-sm w-full py-sm px-lg rounded-xl bg-secondary text-on-secondary font-semibold text-body-md shadow-md hover:bg-secondary-hover focus:outline-none focus:ring-2 focus:ring-secondary/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-xs"
            >
              {loading ? (
                <>
                  <Icon name="progress_activity" className="animate-spin text-[20px]" />
                  <span>Signing in...</span>
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <Icon name="arrow_forward" className="text-[18px]" />
                </>
              )}
            </button>
          </form>

          {/* Security Footer Note */}
          <div className="text-center pt-xs border-t border-outline/10">
            <p className="text-label-sm text-on-surface-variant/60 flex items-center justify-center gap-xs">
              <Icon name="shield" className="text-[14px]" />
              Restricted Access • Authorized Credentials Only
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-surface-container-lowest text-on-surface">
          <Icon name="progress_activity" className="animate-spin text-headline-lg text-secondary" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
