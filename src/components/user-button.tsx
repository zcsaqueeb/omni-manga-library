"use client";

import { useEffect, useState } from "react";
import { useSyncExternalStore } from "react";
import { Heart, History, Loader2, LogOut, RefreshCw, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { bootstrapAuthOnce, useApp } from "@/store/app-store";

const emptySubscribe = () => () => {};
const useMounted = () => useSyncExternalStore(emptySubscribe, () => true, () => false);

/** Brand-avatar with the user's initial, or a guest icon. */
function AvatarChip({ name, loggedIn }: { name?: string; loggedIn: boolean }) {
  return (
    <span
      className={`grid size-8 place-items-center rounded-full text-xs font-bold ${
        loggedIn
          ? "bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white"
          : "bg-muted text-muted-foreground"
      }`}
      aria-hidden
    >
      {loggedIn && name ? name.slice(0, 1).toUpperCase() : <UserRound className="size-4" />}
    </span>
  );
}

export function UserButton() {
  const { user, authReady, favorites, history, signIn, signUp, signOut, syncLocalIntoAccount } =
    useApp();
  const mounted = useMounted();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Check the session once when the app loads.
  useEffect(() => {
    bootstrapAuthOnce();
  }, []);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (mode === "register") {
        await signUp(username.trim(), password);
        toast.success(`Welcome, ${username.trim()}! Your private library is ready.`);
      } else {
        await signIn(username.trim(), password);
        toast.success(`Welcome back, ${username.trim()}!`);
      }
      setOpen(false);
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const doSync = async () => {
    setSyncing(true);
    await syncLocalIntoAccount();
    setSyncing(false);
    toast.success("Library synced to your account.");
  };

  const doSignOut = async () => {
    await signOut();
    toast.success("Signed out. This device is a guest again.");
  };

  return (
    <>
      {user ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative size-10 rounded-full"
              aria-label={`Account: ${user.username}`}
              title={`Signed in as ${user.username}`}
            >
              {mounted ? <AvatarChip name={user.username} loggedIn /> : <span className="size-8" />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="flex flex-col">
              <span className="text-sm font-semibold">{user.username}</span>
              <span className="text-xs font-normal text-muted-foreground">
                Private library — only you can see it
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 text-xs" disabled>
              <Heart className="size-3.5 text-primary" aria-hidden /> {favorites.length} favorites
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-xs" disabled>
              <History className="size-3.5 text-primary" aria-hidden /> {history.length} in history
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2" onClick={doSync} disabled={syncing}>
              {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Sync this device
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-destructive" onClick={doSignOut}>
              <LogOut className="size-4" aria-hidden />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="relative size-10 rounded-full"
          onClick={() => {
            setMode("signin");
            setError(null);
            setOpen(true);
          }}
          aria-label="Sign in to your library"
          title="Sign in — your own private library, favorites & history"
        >
          <AvatarChip loggedIn={false} />
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserRound className="size-5 text-primary" aria-hidden />
              {mode === "signin" ? "Sign in" : "Create your library"}
            </DialogTitle>
            <DialogDescription>
              Every account gets its own private favorites, history and reading progress — nobody
              else can see or change them.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={mode} onValueChange={(v) => setMode(v as "signin" | "register")}>
            <TabsList className="h-9 w-full">
              <TabsTrigger value="signin" className="flex-1 text-xs">
                Sign in
              </TabsTrigger>
              <TabsTrigger value="register" className="flex-1 text-xs">
                Register
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy) void submit();
            }}
          >
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Username</span>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. manga_fan"
                autoComplete="username"
                autoFocus
                required
                minLength={3}
                maxLength={24}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Password</span>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "register" ? "At least 4 characters" : "Your password"}
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                required
                minLength={4}
                maxLength={128}
              />
            </label>

            {error && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}

            <DialogFooter className="gap-2">
              <Button type="submit" className="w-full gap-2" disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {mode === "signin" ? "Sign in" : "Create account"}
              </Button>
            </DialogFooter>
            <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
              {mounted && mode === "register"
                ? "Favorites and history already on this device are moved into your new account."
                : "Signing in merges this device's favorites and history with your account."}
            </p>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
