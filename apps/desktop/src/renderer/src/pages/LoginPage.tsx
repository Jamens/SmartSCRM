import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Building2, User, Lock, Eye, EyeOff, ShieldCheck, Languages, Rocket, LoaderCircle } from 'lucide-react'
import { useAuthStore } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'

const INVITE_KEY = 'scrm-remember-invite'

export default function LoginPage(): React.JSX.Element {
  const { t } = useTranslation()
  const { login, submitting, error } = useAuthStore()
  const [inviteCode, setInviteCode] = useState(() => localStorage.getItem(INVITE_KEY) ?? 'DEMO0001')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(true)

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (remember) localStorage.setItem(INVITE_KEY, inviteCode)
    else localStorage.removeItem(INVITE_KEY)
    await login({ username, password, inviteCode })
  }

  return (
    <div className="drag-region flex h-screen overflow-hidden bg-background">
      {/* Brand panel */}
      <div className="relative hidden w-[56%] flex-col justify-between overflow-hidden bg-gradient-to-br from-[#081A45] via-primary to-[#132f75] p-12 lg:flex">
        <div className="pointer-events-none absolute -top-24 -left-24 size-96 rounded-full bg-gold/20 blur-3xl animate-drift-slow" />
        <div className="pointer-events-none absolute right-[-6rem] bottom-[-8rem] size-[28rem] rounded-full bg-sky-400/20 blur-3xl animate-drift-fast" />
        <div className="pointer-events-none inset-0 absolute bg-[radial-gradient(circle_at_75%_20%,rgba(212,175,55,0.14),transparent_45%)]" />

        <div className="relative flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br from-gold to-amber-600 shadow-lg shadow-amber-900/40">
            <ShieldCheck className="size-6 text-[#0b1e46]" />
          </div>
          <div>
            <p className="text-lg font-bold tracking-wide text-white">SmartSCRM</p>
            <p className="text-[11px] tracking-[0.25em] text-gold/90 uppercase">Client Growth Suite</p>
          </div>
        </div>

        <div className="relative max-w-md">
          <div className="mb-6 h-px w-16 bg-gradient-to-r from-gold to-transparent" />
          <h1 className="text-4xl leading-snug font-bold text-white">
            {t('login.heroTitle1')}
            <br />
            <span className="text-gold">{t('login.heroTitle2')}</span>
          </h1>
          <p className="mt-5 text-sm leading-relaxed text-blue-100/80">
            {t('login.heroSub')}
          </p>
          <ul className="mt-10 space-y-5 text-sm text-blue-50/90">
            <li className="flex items-center gap-3">
              <span className="flex size-8 items-center justify-center rounded-lg bg-white/10 ring-1 ring-gold/40">
                <Languages className="size-4 text-gold" />
              </span>
              {t('login.feature1')}
            </li>
            <li className="flex items-center gap-3">
              <span className="flex size-8 items-center justify-center rounded-lg bg-white/10 ring-1 ring-gold/40">
                <Rocket className="size-4 text-gold" />
              </span>
              {t('login.feature2')}
            </li>
            <li className="flex items-center gap-3">
              <span className="flex size-8 items-center justify-center rounded-lg bg-white/10 ring-1 ring-gold/40">
                <ShieldCheck className="size-4 text-gold" />
              </span>
              {t('login.feature3')}
            </li>
          </ul>
        </div>

        <p className="relative text-xs text-blue-200/50">{t('login.footer')}</p>
      </div>

      {/* Form panel */}
      <div className="relative flex flex-1 items-center justify-center bg-gradient-to-b from-muted via-background to-primary/5 p-8">
        <div className="no-drag w-full max-w-[380px]">
          <div className="rounded-2xl border border-border/60 bg-card/70 p-8 shadow-2xl shadow-primary/10 backdrop-blur-xl">
            <h2 className="text-2xl font-bold text-foreground">{t('login.welcome')}</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">{t('login.subtitle')}</p>
            <div className="mt-3 h-1 w-10 rounded-full bg-gradient-to-r from-primary to-gold" />

            <form onSubmit={onSubmit} className="mt-8 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="invite">{t('login.invite')}</Label>
                <div className="relative">
                  <Building2 className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-primary/50" />
                  <Input
                    id="invite"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    placeholder={t('login.invitePlaceholder', { sample: 'DEMO0001' })}
                    className="h-11 pl-10 font-medium tracking-wide"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="username">{t('login.username')}</Label>
                <div className="relative">
                  <User className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-primary/50" />
                  <Input
                    id="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={t('login.usernamePlaceholder')}
                    autoComplete="username"
                    className="h-11 pl-10"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">{t('login.password')}</Label>
                <div className="relative">
                  <Lock className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-primary/50" />
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('login.passwordPlaceholder')}
                    autoComplete="current-password"
                    className="h-11 pr-10 pl-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="size-3.5 accent-primary"
                />
                {t('login.rememberInvite')}
              </label>

              {error && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                disabled={submitting}
                className="h-11 w-full bg-gradient-to-r from-primary to-[#2f5fe0] text-base font-semibold shadow-lg shadow-primary/30 transition-all hover:ring-2 hover:ring-gold/60"
              >
                {submitting ? (
                  <>
                    <LoaderCircle className="mr-2 size-4 animate-spin" /> {t('login.signing')}
                  </>
                ) : (
                  t('login.signIn')
                )}
              </Button>
            </form>

            <Separator className="my-6" />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {t('login.demoAccount')} <code className="rounded bg-muted px-1.5 py-0.5">admin / admin123</code>
              </span>
              <span className="text-muted-foreground">{t('login.storedLocally')}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
