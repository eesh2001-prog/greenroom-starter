"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Clock, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PlainBadge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { signOff } from "@/app/actions/signOff";
import type { Signoff } from "@/db/schema";

type Role = "agent" | "tour_manager" | "gm";

const ROLE_OPTIONS: { value: Role; label: string; mandatory: boolean }[] = [
  { value: "agent", label: "Agent", mandatory: true },
  { value: "tour_manager", label: "Tour Manager", mandatory: false },
  { value: "gm", label: "Marcus (GM)", mandatory: false },
];

const ROSTER: { role: Signoff["role"]; label: string; mandatory: boolean }[] = [
  { role: "booker", label: "Mariana (Booker / Venue)", mandatory: true },
  { role: "agent", label: "Agent", mandatory: true },
  { role: "tour_manager", label: "Tour Manager", mandatory: false },
  { role: "gm", label: "Marcus (GM)", mandatory: false },
];

type Props = {
  shareToken: string;
  signoffs: Signoff[];
  agentName: string | null;
  agentEmail: string | null;
  isConfirmed: boolean;
};

export function SignOffSection({
  shareToken,
  signoffs: initialSignoffs,
  agentName,
  agentEmail,
  isConfirmed,
}: Props) {
  const [signoffs, setSignoffs] = useState(initialSignoffs);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  const signedRoles = new Set(signoffs.map((s) => s.role));
  const availableRoles = ROLE_OPTIONS.filter((r) => !signedRoles.has(r.value));

  // Pre-fill name/email when agent role is selected and we have agent info
  function handleRoleSelect(role: Role) {
    setSelectedRole(role);
    setError(null);
    if (role === "agent") {
      if (agentName) setName(agentName);
      if (agentEmail) setEmail(agentEmail);
    } else {
      setName("");
      setEmail("");
    }
  }

  function handleSubmit() {
    if (!selectedRole || !name.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await signOff(shareToken, selectedRole, name, email);
      if (!result.ok) {
        setError(result.error);
      } else {
        const roleInfo = ROLE_OPTIONS.find((r) => r.value === selectedRole)!;
        setSignoffs((prev) => [
          ...prev,
          {
            role: selectedRole,
            name: name.trim(),
            email: email.trim(),
            mandatory: roleInfo.mandatory,
            signedAt: Date.now(),
          },
        ]);
        setSuccess(true);
        setSelectedRole(null);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign off on this deal</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Current sign-off status */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {ROSTER.map(({ role, label, mandatory }) => {
            const s = signoffs.find((x) => x.role === role);
            return (
              <div
                key={role}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3",
                  s ? "border-brand-200 bg-brand-50/50" : "border-ink-100 bg-white",
                )}
              >
                {s ? (
                  <CheckCircle2 className="h-4 w-4 text-brand-600 shrink-0 mt-0.5" />
                ) : (
                  <Clock className="h-4 w-4 text-ink-300 shrink-0 mt-0.5" />
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[12px] font-medium text-ink-800">
                      {s ? s.name : label}
                    </span>
                    <PlainBadge
                      variant={mandatory ? "rose" : "default"}
                      className="text-[9px]"
                    >
                      {mandatory ? "required" : "optional"}
                    </PlainBadge>
                  </div>
                  <p className="text-[11px] text-ink-500 mt-0.5">
                    {s
                      ? `Signed · ${new Date(s.signedAt).toLocaleDateString()}`
                      : "Not yet signed"}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Success message */}
        {success && (
          <div className="rounded-md border border-brand-200 bg-brand-50 px-4 py-3 text-[12.5px] text-brand-800">
            ✓ Your sign-off has been recorded. Thank you.
          </div>
        )}

        {/* Sign-off form — hidden when confirmed or no available roles */}
        {!isConfirmed && availableRoles.length > 0 && !success && (
          <div className="border-t border-ink-100 pt-4 space-y-4">
            <p className="text-[12.5px] text-ink-600">
              Who are you? Select your role to sign off.
            </p>

            {/* Role picker */}
            <div className="flex flex-wrap gap-2">
              {availableRoles.map((r) => (
                <button
                  key={r.value}
                  onClick={() => handleRoleSelect(r.value)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg border text-[12.5px] font-medium transition-colors",
                    selectedRole === r.value
                      ? "border-brand-500 bg-brand-50 text-brand-800"
                      : "border-ink-200 bg-white text-ink-700 hover:border-ink-400",
                  )}
                >
                  {r.label}
                  {r.mandatory && (
                    <span className="ml-1 text-[10px] text-rose-600">*</span>
                  )}
                </button>
              ))}
            </div>

            {/* Name + email form */}
            {selectedRole && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="eyebrow text-[10px] text-ink-500 block mb-1">
                      Your name
                    </span>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Full name"
                      className="w-full h-8 px-3 rounded-md border border-ink-200 bg-white text-[12.5px] text-ink-800 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"
                    />
                  </label>
                  <label className="block">
                    <span className="eyebrow text-[10px] text-ink-500 block mb-1">
                      Email (optional)
                    </span>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="your@email.com"
                      className="w-full h-8 px-3 rounded-md border border-ink-200 bg-white text-[12.5px] text-ink-800 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"
                    />
                  </label>
                </div>
                {error && (
                  <p className="text-[12px] text-rose-700">{error}</p>
                )}
                <Button
                  variant="brand"
                  onClick={handleSubmit}
                  disabled={isPending || !name.trim()}
                >
                  {isPending && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  Sign off on this deal
                </Button>
              </div>
            )}
          </div>
        )}

        {/* All done */}
        {isConfirmed && (
          <div className="rounded-md border border-brand-300 bg-brand-50 px-4 py-3 text-[12.5px] text-brand-800 font-medium">
            ✓ All mandatory sign-offs received. This deal is confirmed.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
