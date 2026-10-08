'use client';

import { useState } from 'react';
import { useUIStore } from '@/stores/ui-store';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import {
  ArrowLeft, User, Mail, Lock, Palette, Bell, Globe, Shield, CreditCard,
  HardDrive, LogOut, Camera, Check, Crown,
} from 'lucide-react';

export function SettingsView() {
  const setView = useUIStore((s) => s.setView);
  const openDashboard = useUIStore((s) => s.openDashboard);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const refresh = useAuthStore((s) => s.refresh);

  const [name, setName] = useState(user?.name ?? '');
  const [email] = useState(user?.email ?? '');
  const [tab, setTab] = useState('account');

  const saveProfile = async () => {
    toast.info('Profile editing — coming soon');
  };

  const initials = (user?.name || user?.email || 'U').slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-30 border-b border-border/50 glass">
        <div className="flex h-14 items-center px-4 sm:px-6 gap-3">
          <Button variant="ghost" size="icon" onClick={() => openDashboard()} className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-base font-semibold">Settings</h1>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="grid grid-cols-2 sm:grid-cols-5 w-full mb-6">
              <TabsTrigger value="account" className="text-xs"><User className="h-3.5 w-3.5 mr-1.5" /> Account</TabsTrigger>
              <TabsTrigger value="appearance" className="text-xs"><Palette className="h-3.5 w-3.5 mr-1.5" /> Theme</TabsTrigger>
              <TabsTrigger value="notifications" className="text-xs"><Bell className="h-3.5 w-3.5 mr-1.5" /> Alerts</TabsTrigger>
              <TabsTrigger value="billing" className="text-xs"><CreditCard className="h-3.5 w-3.5 mr-1.5" /> Billing</TabsTrigger>
              <TabsTrigger value="security" className="text-xs"><Shield className="h-3.5 w-3.5 mr-1.5" /> Security</TabsTrigger>
            </TabsList>

            <TabsContent value="account" className="space-y-4">
              <Card className="p-6 bg-card/50 border-border/50">
                <div className="flex items-center gap-4 mb-6">
                  <div className="relative">
                    <Avatar className="h-16 w-16">
                      <AvatarFallback className="bg-primary/20 text-primary text-lg font-medium">{initials}</AvatarFallback>
                    </Avatar>
                    <button className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-card border border-border flex items-center justify-center hover:bg-accent">
                      <Camera className="h-3 w-3" />
                    </button>
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold">{user?.name || 'Creator'}</h2>
                    <p className="text-sm text-muted-foreground">{user?.email}</p>
                    <Badge variant="secondary" className="mt-1.5 capitalize text-[10px]">{user?.plan || 'free'} plan</Badge>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Display name</Label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} className="bg-background/60" />
                  </div>
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input value={email} readOnly className="pl-9 bg-background/40 text-muted-foreground" />
                    </div>
                  </div>
                  <Button onClick={saveProfile}>Save changes</Button>
                </div>
              </Card>

              <Card className="p-6 bg-card/50 border-border/50">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Globe className="h-4 w-4 text-muted-foreground" /> Language & region
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-xs">Language</Label>
                    <Select defaultValue="en">
                      <SelectTrigger className="bg-background/60"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en">English</SelectItem>
                        <SelectItem value="fr">Français</SelectItem>
                        <SelectItem value="es">Español</SelectItem>
                        <SelectItem value="yo">Yorùbá</SelectItem>
                        <SelectItem value="ha">Hausa</SelectItem>
                        <SelectItem value="ig">Igbo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Timezone</Label>
                    <Select defaultValue="Africa/Lagos">
                      <SelectTrigger className="bg-background/60"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Africa/Lagos">Africa/Lagos (WAT)</SelectItem>
                        <SelectItem value="UTC">UTC</SelectItem>
                        <SelectItem value="America/New_York">America/New_York</SelectItem>
                        <SelectItem value="Europe/London">Europe/London</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground mt-3">Interface translations are architecture-ready.</p>
              </Card>
            </TabsContent>

            <TabsContent value="appearance" className="space-y-4">
              <Card className="p-6 bg-card/50 border-border/50">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Palette className="h-4 w-4 text-muted-foreground" /> Theme
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border-2 border-primary p-3 bg-background">
                    <div className="h-16 rounded bg-[#0a0a0f] mb-2 flex items-center justify-center">
                      <span className="text-amber-500 text-xs font-medium">Cinematic Dark</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs">
                      <Check className="h-3.5 w-3.5 text-primary" /> Dark (active)
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/60 p-3 bg-background opacity-50 cursor-not-allowed">
                    <div className="h-16 rounded bg-white mb-2 flex items-center justify-center">
                      <span className="text-zinc-900 text-xs font-medium">Light</span>
                    </div>
                    <div className="text-xs text-muted-foreground">Coming soon</div>
                  </div>
                </div>
              </Card>
              <Card className="p-6 bg-card/50 border-border/50">
                <h3 className="text-sm font-semibold mb-3">Accent color</h3>
                <div className="flex gap-2">
                  {['#f5a623', '#fb923c', '#facc15', '#22c55e', '#ec4899', '#a855f7'].map((c, i) => (
                    <button key={c} className={`h-8 w-8 rounded-full ring-2 ${i === 0 ? 'ring-primary ring-offset-2 ring-offset-background' : 'ring-transparent'}`} style={{ backgroundColor: c }} />
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">Cinematic amber is the default. More themes coming soon.</p>
              </Card>
            </TabsContent>

            <TabsContent value="notifications" className="space-y-4">
              <Card className="p-6 bg-card/50 border-border/50 space-y-1">
                {[
                  { label: 'Render completed', desc: 'When an export finishes processing' },
                  { label: 'AI job done', desc: 'When an AI task (transcription, captions) completes' },
                  { label: 'Project shared', desc: 'When someone shares a project with you' },
                  { label: 'Comments', desc: 'When someone comments on your project' },
                  { label: 'Product updates', desc: 'Occasional product news' },
                ].map((n, i) => (
                  <div key={n.label} className="flex items-center justify-between py-3 border-b border-border/30 last:border-0">
                    <div>
                      <div className="text-sm font-medium">{n.label}</div>
                      <div className="text-[11px] text-muted-foreground">{n.desc}</div>
                    </div>
                    <Switch defaultChecked={i < 3} />
                  </div>
                ))}
              </Card>
            </TabsContent>

            <TabsContent value="billing" className="space-y-4">
              <Card className="p-6 bg-card/50 border-border/50">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-semibold">Current plan</h3>
                    <p className="text-xs text-muted-foreground">You are on the {user?.plan || 'free'} plan.</p>
                  </div>
                  <Badge className="capitalize"><Crown className="h-3 w-3 mr-1" /> {user?.plan || 'free'}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { id: 'free', name: 'Free', price: '$0', features: '1080p · 5 projects · limited AI' },
                    { id: 'creator', name: 'Creator', price: '$12/mo', features: '4K · 50 projects · AI features' },
                  ].map((p) => (
                    <div key={p.id} className={`rounded-lg border p-3 ${user?.plan === p.id ? 'border-primary bg-primary/5' : 'border-border/60'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">{p.name}</span>
                        <span className="text-sm font-semibold">{p.price}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">{p.features}</p>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground mt-4">Billing is architecture-ready and not yet enforced.</p>
              </Card>
            </TabsContent>

            <TabsContent value="security" className="space-y-4">
              <Card className="p-6 bg-card/50 border-border/50 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-2"><Lock className="h-4 w-4 text-muted-foreground" /> Password</h3>
                  <Button variant="outline" size="sm" onClick={() => toast.info('Password change — coming soon')}>Change password</Button>
                </div>
                <div className="border-t border-border/40 pt-4">
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-2"><Shield className="h-4 w-4 text-muted-foreground" /> Two-factor authentication</h3>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">Add an extra layer of security.</p>
                    <Switch onCheckedChange={(v) => toast.info(v ? '2FA setup — coming soon' : '2FA disabled')} />
                  </div>
                </div>
                <div className="border-t border-border/40 pt-4">
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-2"><HardDrive className="h-4 w-4 text-muted-foreground" /> Active sessions</h3>
                  <p className="text-xs text-muted-foreground">You are signed in on this browser.</p>
                </div>
                <div className="border-t border-border/40 pt-4">
                  <Button variant="destructive" size="sm" onClick={async () => { await logout(); setView('landing'); }}>
                    <LogOut className="h-3.5 w-3.5 mr-1.5" /> Sign out
                  </Button>
                </div>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
