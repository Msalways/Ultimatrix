'use client';

import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore, type ToolAnimation } from '@/stores/app-store';
import { StatusGlyph } from '@/components/glyphs';

function AnimationCard({ anim }: { anim: ToolAnimation }) {
  const removeAnimation = useAppStore((s) => s.removeAnimation);

  useEffect(() => {
    if (anim.status === 'complete' || anim.status === 'error') {
      const t = setTimeout(() => removeAnimation(anim.id), 3000);
      return () => clearTimeout(t);
    }
  }, [anim.id, anim.status, removeAnimation]);

  return (
    <motion.div
      initial={{ opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 50 }}
      transition={{ duration: 0.3 }}
      className="panel-holographic rounded-lg p-3"
    >
      <div className="flex items-center gap-2">
        <StatusGlyph
          status={anim.status === 'running' ? 'loading' : anim.status === 'complete' ? 'complete' : 'error'}
        />
        <span className="text-sm text-green-100 font-mono">{anim.toolName}</span>
      </div>

      {anim.status === 'running' && (
        <svg width="180" height="4" className="mt-2">
          <motion.line
            x1="0"
            y1="2"
            x2="180"
            y2="2"
            stroke="var(--ultimatrix-green)"
            strokeWidth="2"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 2, ease: 'easeInOut', repeat: Infinity }}
          />
        </svg>
      )}
    </motion.div>
  );
}

export function AttackAnimationLayer() {
  const animations = useAppStore((s) => s.activeAnimations);
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={containerRef}
      className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none"
      style={{ maxWidth: 220 }}
    >
      <AnimatePresence mode="popLayout">
        {animations.map((anim) => (
          <AnimationCard key={anim.id} anim={anim} />
        ))}
      </AnimatePresence>
    </div>
  );
}
