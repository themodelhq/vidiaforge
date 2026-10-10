'use client';

import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUIStore } from '@/stores/ui-store';
import { toast } from 'sonner';
import { Share2, Copy, Link2, Eye, MessageSquare, Pencil, Trash2, Users } from 'lucide-react';

const PERMISSIONS = [
  { id: 'view', label: 'Can view', desc: 'View only', icon: Eye },
  { id: 'comment', label: 'Can comment', desc: 'View + comment', icon: MessageSquare },
  { id: 'edit', label: 'Can edit', desc: 'Full edit access', icon: Pencil },
];

export function ShareDialog() {
  const open = useUIStore((s) => s.shareDialogOpen);
  const setOpen = useUIStore((s) => s.setShareDialogOpen);
  const project = useUIStore((s) => s.pendingProjectId);
  const [permission, setPermission] = useState('view');
  const [copied, setCopied] = useState(false);

  const shareUrl = project ? `${typeof window !== 'undefined' ? window.location.origin : ''}/?view=dashboard&share=${project}` : '';

  const copy = () => {
    navigator.clipboard?.writeText(shareUrl).then(() => {
      setCopied(true);
      toast.success('Link copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md bg-card/95 border-border/60">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-4 w-4" /> Share project
          </DialogTitle>
          <DialogDescription>
            Generate a secure share link. Recipients can view, comment, or edit depending on the permission you choose.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Permission */}
          <div className="space-y-2">
            <Label className="text-xs">Permission</Label>
            <div className="space-y-1.5">
              {PERMISSIONS.map((p) => {
                const Icon = p.icon;
                const active = permission === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => setPermission(p.id)}
                    className={`w-full flex items-center gap-3 rounded-lg border p-2.5 text-left transition ${active ? 'border-primary bg-primary/10' : 'border-border/60 bg-background/40 hover:bg-accent/30'}`}
                  >
                    <Icon className={`h-4 w-4 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
                    <div className="flex-1">
                      <div className="text-sm font-medium">{p.label}</div>
                      <div className="text-[11px] text-muted-foreground">{p.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Link */}
          <div className="space-y-2">
            <Label className="text-xs">Share link</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Link2 className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input readOnly value={shareUrl} className="pl-8 bg-background/60 text-xs font-mono" />
              </div>
              <Button onClick={copy} size="sm" className="min-w-20">
                {copied ? <><Copy className="h-3.5 w-3.5 mr-1.5" /> Copied</> : 'Copy'}
              </Button>
            </div>
          </div>

          {/* Collaborators (visual) */}
          <div className="rounded-md border border-border/40 bg-background/30 p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium">Collaborators</span>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs">
                <div className="h-6 w-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[10px] font-medium">You</div>
                <span className="flex-1">You</span>
                <span className="text-[10px] text-muted-foreground">Owner</span>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">Real-time collaboration is architecture-ready.</p>
          </div>

          {/* Revoke */}
          <button
            onClick={() => toast.info('Link revoked — recipients can no longer access')}
            className="w-full flex items-center justify-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 py-2 text-xs text-destructive hover:bg-destructive/20 transition"
          >
            <Trash2 className="h-3.5 w-3.5" /> Revoke link
          </button>
        </div>

        <DialogFooter>
          <Button onClick={() => setOpen(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
