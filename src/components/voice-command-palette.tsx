'use client';

import { useEffect, useRef, useState } from 'react';
import { Command } from 'cmdk';
import { cn } from '@/lib/utils';
import { voiceCommandRegistry, type VoiceCommand } from '@/stores/app-store';

/* eslint-disable @typescript-eslint/no-explicit-any */
type SpeechRecognitionInstance = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

function getSpeechRecognition(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => SpeechRecognitionInstance) | null;
}

function registerDefaultCommands(onNavigate: (path: string) => void) {
  const existing = voiceCommandRegistry.getAll();
  if (existing.length > 0) return;

  const nav: VoiceCommand[] = [
    { id: 'nav-dashboard', aliases: ['show dashboard', 'dashboard'], group: 'navigation', action: () => onNavigate('/dashboard'), description: 'Show Dashboard' },
    { id: 'nav-findings', aliases: ['show findings', 'findings'], group: 'navigation', action: () => onNavigate('/findings'), description: 'Show Findings' },
    { id: 'nav-graph', aliases: ['show graph', 'graph'], group: 'navigation', action: () => onNavigate('/graph'), description: 'Show Graph' },
    { id: 'nav-settings', aliases: ['show settings', 'settings'], group: 'navigation', action: () => onNavigate('/settings'), description: 'Show Settings' },
  ];

  for (const cmd of nav) {
    voiceCommandRegistry.register(cmd);
  }
}

export function VoiceCommandPalette({
  onNavigate,
  className,
}: {
  onNavigate: (path: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [mounted, setMounted] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    registerDefaultCommands(onNavigate);
  }, [onNavigate]);

  useEffect(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => {
      const transcript = Array.from(event.results)
        .map((r) => r[0].transcript)
        .join('');
      const action = voiceCommandRegistry.match(transcript);
      if (action) {
        action.action();
        setOpen(false);
      }
      setListening(false);
    };

    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);

    recognitionRef.current = recognition;
  }, []);

  const startListening = () => {
    if (!recognitionRef.current) return;
    setListening(true);
    recognitionRef.current.start();
  };

  const commands = voiceCommandRegistry.getAll();
  const grouped = commands.reduce(
    (acc: Record<string, VoiceCommand[]>, cmd: VoiceCommand) => {
      (acc[cmd.group] ??= []).push(cmd);
      return acc;
    },
    {} as Record<string, VoiceCommand[]>,
  );

  const hasSpeechRecognition = mounted && typeof window !== 'undefined' && getSpeechRecognition() !== null;

  return (
    <div className={cn('relative', className)}>
      <Command.Dialog open={open} onOpenChange={setOpen} label="Command palette">
        <Command.Input placeholder="Type a command..." />
        <Command.List>
          <Command.Empty>No commands found.</Command.Empty>
          {Object.entries(grouped).map(([group, cmds]: [string, VoiceCommand[]]) => (
            <Command.Group key={group} heading={group}>
              {cmds.map((cmd) => (
                <Command.Item
                  key={cmd.id}
                  onSelect={() => {
                    cmd.action();
                    setOpen(false);
                  }}
                >
                  {cmd.description}
                </Command.Item>
              ))}
            </Command.Group>
          ))}
        </Command.List>
      </Command.Dialog>

      <button
        onClick={() => setOpen(true)}
        className={cn(
          'fixed bottom-4 right-4 z-40 p-3 rounded-full transition-all',
          'bg-green-600 hover:bg-green-500 text-white shadow-lg',
          'shadow-green-500/20 hover:shadow-green-500/40',
        )}
        aria-label="Open command palette"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" />
        </svg>
      </button>

      {hasSpeechRecognition && (
        <button
          onClick={startListening}
          disabled={listening}
          className={cn(
            'fixed bottom-4 right-20 z-40 p-3 rounded-full transition-all',
            listening
              ? 'bg-green-400 text-white animate-glyph-pulse'
              : 'bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white',
          )}
          aria-label={listening ? 'Listening...' : 'Voice command'}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </button>
      )}
    </div>
  );
}
