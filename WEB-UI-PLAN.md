

---

## UNIQUE DESIGN ENHANCEMENTS

> **Super unique visual concepts that differentiate Ultimatrix from every other security tool.**
> These enhancements build on the Omnitrix foundation while introducing signature interactions
> that users will remember and talk about.

### 1. HOLOGRAPHIC TRANSPARENCY SYSTEM

**Concept:** Glassmorphism meets alien hologram technology. Panels are semi-transparent with backdrop blur, creating depth and a futuristic feel.

**Implementation:**

```css
/* Holographic panel base */
.panel-holographic {
  background: rgba(10, 11, 15, 0.65);          /* 65% opacity */
  backdrop-filter: blur(12px);                  /* Glassmorphism */
  -webkit-backdrop-filter: blur(12px);          /* Safari support */
  border: 1px solid rgba(43, 224, 138, 0.1);
  box-shadow: 
    0 8px 32px rgba(0, 0, 0, 0.4),              /* Depth shadow */
    inset 0 0 32px rgba(43, 224, 138, 0.02),    /* Inner glow */
    0 0 0 1px rgba(43, 224, 138, 0.05);         /* Edge highlight */
}

/* On hover: increase border glow */
.panel-holographic:hover {
  border-color: rgba(43, 224, 138, 0.2);
  box-shadow: 
    0 8px 32px rgba(0, 0, 0, 0.4),
    inset 0 0 48px rgba(43, 224, 138, 0.04),
    0 0 0 1px rgba(43, 224, 138, 0.08);
}

/* Active panel: stronger glow */
.panel-holographic.active {
  border-color: rgba(43, 224, 138, 0.3);
  box-shadow: 
    0 8px 48px rgba(43, 224, 138, 0.15),
    inset 0 0 64px rgba(43, 224, 138, 0.05),
    0 0 0 1px rgba(43, 224, 138, 0.15);
}
```

**Key Visual Effects:**
- **Layered depth:** Background content is visible but blurred through panels
- **Edge highlight:** Thin green glow on panel borders creates "hologram edge" effect
- **Hover interaction:** Border glow intensifies on hover
- **No solid backgrounds:** Everything feels like it's floating in the void

**Use Cases:**
- Sidebar navigation
- Chat message cards
- Finding detail sheets
- Tool invocation cards
- Worker status panels

**Anti-Bandaid Note:** This is implemented via CSS custom properties and backdrop-filter (platform-native). No JavaScript animations needed for the base effect.

---

### 2. OMNITRIX DIAL LOADER

**Concept:** Replace traditional spinners with an animated Omnitrix dial that rotates and pulses during loading states.

**Visual Design:**

```
        ╱───────╲
      ╱           ╲
     │  ◇   ◇   ◇  │     ← 3 dots in triangular pattern
     │    ◇─◇─◇    │     ← Central hourglass shape
     │  ◇   ◇   ◇  │     ← Bottom triangle
      ╲           ╱
        ╲───────╱
```

**Animation Sequence:**

1. **Idle state:** Dial is dim (opacity: 0.4), no animation
2. **Loading state:** 
   - Dial rotates 360° over 2s (ease-in-out, continuous)
   - Green dots pulse sequentially (0.3s each, staggered)
   - Central hourglass glows brighter
3. **Complete state:** 
   - Rotation stops
   - All dots flash green simultaneously
   - Fade out over 0.5s

**Implementation:**

```tsx
// src/components/omnitrix-loader.tsx
export function OmnitrixLoader({ 
  size = 48, 
  phase = 'idle' 
}: { 
  size?: number; 
  phase: 'idle' | 'loading' | 'complete' 
}) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 100 100"
      className={cn(
        "transition-all duration-300",
        phase === 'idle' && "opacity-40",
        phase === 'loading' && "opacity-100 animate-spin-slow",
        phase === 'complete' && "opacity-100 scale-110"
      )}
    >
      {/* Outer ring */}
      <circle 
        cx="50" cy="50" r="45" 
        fill="none" 
        stroke="var(--green-400)" 
        strokeWidth="2"
        opacity="0.3"
      />
      
      {/* Central hourglass */}
      <path
        d="M35,30 L65,30 L50,50 L65,70 L35,70 L50,50 Z"
        fill="var(--green-400)"
        className={cn(
          phase === 'loading' && "animate-pulse-glow"
        )}
      />
      
      {/* Triangular dots */}
      {[0, 120, 240].map((angle, i) => (
        <circle
          key={i}
          cx={50 + 35 * Math.cos((angle - 90) * Math.PI / 180)}
          cy={50 + 35 * Math.sin((angle - 90) * Math.PI / 180)}
          r="4"
          fill="var(--green-400)"
          style={{
            animationDelay: `${i * 0.1}s`
          }}
          className={cn(
            phase === 'loading' && "animate-ping"
          )}
        />
      ))}
    </svg>
  );
}
```

**CSS Animations:**

```css
@keyframes spin-slow {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes pulse-glow {
  0%, 100% { filter: drop-shadow(0 0 4px var(--green-glow)); }
  50% { filter: drop-shadow(0 0 16px var(--green-glow)); }
}

.animate-spin-slow {
  animation: spin-slow 2s ease-in-out infinite;
}

.animate-pulse-glow {
  animation: pulse-glow 1.5s ease-in-out infinite;
}
```

**Use Cases:**
- Page loading states (replace skeleton loaders)
- Solver initialization
- Target creation
- Report generation
- Graph data loading

---

### 3. DNA HELIX PROGRESS INDICATOR

**Concept:** Security testing phases visualized as a DNA helix that unwinds and rewinds as the solver progresses through phases.

**Visual Design:**

```
Phase 1 (Observe):  ════════  (double helix, tightly wound)
Phase 2 (Reason):   ════╪════  (starting to unwind)
Phase 3 (Explore):  ══╪══╪══   (middle separation)
Phase 4 (Conclude): ╪══════╪   (fully unwound, complete)
```

**Animation:**

1. **Phase 0:** Helix is tightly wound, both strands together
2. **Phase progression:** Strands separate progressively
3. **Phase complete:** Strand snaps back together with green flash
4. **All phases complete:** Full helix pulses with success glow

**Implementation:**

```tsx
// src/components/dna-progress.tsx
export function DNAProgress({ 
  phases, 
  currentPhase 
}: { 
  phases: string[];
  currentPhase: number;
}) {
  return (
    <div className="flex items-center gap-2">
      {/* Left strand */}
      <div className="relative h-16 w-2">
        <div 
          className="absolute top-0 left-0 h-full w-full bg-gradient-to-b from-green-400 to-green-600"
          style={{
            transform: `translateX(${currentPhase * 8}px)`,
            transition: 'transform 0.5s ease-in-out'
          }}
        />
      </div>
      
      {/* Phase markers */}
      <div className="flex flex-col gap-1">
        {phases.map((phase, i) => (
          <div 
            key={i}
            className={cn(
              "h-3 w-24 rounded-full transition-all",
              i < currentPhase && "bg-green-400",
              i === currentPhase && "bg-green-500 animate-pulse",
              i > currentPhase && "bg-gray-700"
            )}
          >
            <span className="sr-only">{phase}</span>
          </div>
        ))}
      </div>
      
      {/* Right strand */}
      <div className="relative h-16 w-2">
        <div 
          className="absolute top-0 right-0 h-full w-full bg-gradient-to-b from-cyan-400 to-cyan-600"
          style={{
            transform: `translateX(-${currentPhase * 8}px)`,
            transition: 'transform 0.5s ease-in-out'
          }}
        />
      </div>
    </div>
  );
}
```

**Use Cases:**
- Status bar phase indicator (replaces simple text)
- Dashboard progress visualization
- Session header during active attack
- Campaign progress tracker

---

### 4. PLASMIC BACKGROUND EFFECT

**Concept:** Subtle animated background that resembles alien plasma or energy fields. Creates a living, breathing interface.

**Implementation:**

```css
/* Background container */
.bg-plasmic {
  position: relative;
  overflow: hidden;
}

.bg-plasmic::before {
  content: '';
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  background: 
    radial-gradient(circle at 20% 30%, rgba(43, 224, 138, 0.03) 0%, transparent 50%),
    radial-gradient(circle at 80% 70%, rgba(54, 201, 230, 0.02) 0%, transparent 50%),
    radial-gradient(circle at 50% 50%, rgba(43, 224, 138, 0.01) 0%, transparent 70%);
  animation: plasmic-drift 20s ease-in-out infinite;
  pointer-events: none;
}

@keyframes plasmic-drift {
  0%, 100% {
    transform: translate(0, 0) rotate(0deg);
  }
  25% {
    transform: translate(2%, 2%) rotate(1deg);
  }
  50% {
    transform: translate(-1%, 3%) rotate(-1deg);
  }
  75% {
    transform: translate(1%, -2%) rotate(0.5deg);
  }
}
```

**Key Characteristics:**
- **Ultra-subtle:** Maximum opacity is 3% (barely perceptible)
- **Slow animation:** 20s cycle to avoid distraction
- **Multi-layer:** Multiple radial gradients create depth
- **No performance impact:** CSS-only, GPU-accelerated transforms

**Use Cases:**
- Page background (all pages)
- Modal backdrop
- Panel backgrounds (subtle variant)

---

### 5. ALIEN GLYPH DECORATORS

**Concept:** Decorative alien glyphs/symbols that appear in specific contexts, adding visual interest and reinforcing the Omnitrix theme.

**Glyph Types:**

1. **Threat glyphs:** Appear next to findings (severity indicators)
   - Critical: ⚡ (lightning bolt)
   - High: ⚠ (warning triangle)
   - Medium: ◆ (diamond)
   - Low: ○ (circle)
   - Info: ◇ (empty diamond)

2. **Action glyphs:** Appear next to tool invocations
   - HTTP request: ↯ (arrow)
   - Browser action: ◈ (square with X)
   - Analysis: ⚙ (gear)
   - Worker spawn: ⬡ (hexagon)

3. **Status glyphs:** Circular indicators for system state
   - Active: ● (solid dot, pulsing green)
   - Idle: ○ (empty circle, dim)
   - Loading: ◌ (dotted circle, rotating)
   - Complete: ◉ (dot in circle, solid green)
   - Error: ◗ (half circle, red)

**Implementation:**

```tsx
// src/components/glyphs.tsx
export const ThreatGlyph = ({ 
  severity 
}: { 
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info' 
}) => {
  const glyphs = {
    critical: '⚡',
    high: '⚠',
    medium: '◆',
    low: '○',
    info: '◇'
  };
  
  const colors = {
    critical: 'text-red-400',
    high: 'text-orange-400',
    medium: 'text-yellow-400',
    low: 'text-blue-400',
    info: 'text-gray-400'
  };
  
  return (
    <span 
      className={cn(
        "text-lg select-none",
        colors[severity]
      )}
      aria-hidden="true"
    >
      {glyphs[severity]}
    </span>
  );
};

export const StatusGlyph = ({ 
  status 
}: { 
  status: 'active' | 'idle' | 'loading' | 'complete' | 'error' 
}) => {
  const glyphs = {
    active: '●',
    idle: '○',
    loading: '◌',
    complete: '◉',
    error: '◗'
  };
  
  return (
    <span 
      className={cn(
        "text-sm font-mono",
        status === 'active' && "text-green-400 animate-pulse",
        status === 'idle' && "text-gray-600",
        status === 'loading' && "text-green-400 animate-spin",
        status === 'complete' && "text-green-500",
        status === 'error' && "text-red-400"
      )}
      aria-label={`Status: ${status}`}
    >
      {glyphs[status]}
    </span>
  );
};
```

**Use Cases:**
- Finding severity badges (threat glyphs)
- Tool invocation indicators (action glyphs)
- Worker status badges (status glyphs)
- Navigation icons (decorative glyphs in sidebar)

---

### 6. TEMPORAL SHADOW EFFECT

**Concept:** UI elements cast a "temporal shadow" that suggests they exist across time, reinforcing the security testing timeline concept.

**Implementation:**

```css
/* Temporal shadow for cards */
.temporal-shadow {
  position: relative;
}

.temporal-shadow::after {
  content: '';
  position: absolute;
  top: 4px;
  left: 4px;
  right: -4px;
  bottom: -4px;
  background: linear-gradient(
    135deg,
    transparent 0%,
    rgba(43, 224, 138, 0.03) 50%,
    transparent 100%
  );
  border-radius: inherit;
  pointer-events: none;
  z-index: -1;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.temporal-shadow:hover::after {
  opacity: 1;
}
```

**Key Effects:**
- **Offset shadow:** Shadow is offset 4px right/down
- **Green tint:** Shadow has subtle green glow
- **Hover trigger:** Only appears on hover
- **No extra elements:** Pure CSS, no DOM impact

**Use Cases:**
- Finding cards
- Tool invocation cards
- Worker status cards
- Dashboard stat cards

---

### 7. PHASE TRANSITION RIPPLE

**Concept:** When the solver transitions between phases, a green ripple emanates from the phase indicator, visually confirming the transition.

**Implementation:**

```tsx
// src/hooks/use-phase-ripple.ts
export function usePhaseRipple() {
  const [ripple, setRipple] = useState(false);
  
  const triggerRipple = useCallback(() => {
    setRipple(true);
    setTimeout(() => setRipple(false), 600);
  }, []);
  
  return { ripple, triggerRipple };
}

// src/components/phase-indicator.tsx (updated)
export function PhaseIndicator({ 
  currentPhase 
}: { 
  currentPhase: number 
}) {
  const { ripple, triggerRipple } = usePhaseRipple();
  
  useEffect(() => {
    triggerRipple();
  }, [currentPhase, triggerRipple]);
  
  return (
    <div className="relative">
      {/* Phase dial */}
      <CircularPhaseDial phase={currentPhase} />
      
      {/* Ripple overlay */}
      {ripple && (
        <div 
          className="absolute inset-0 rounded-full border-2 border-green-400 animate-ripple"
          style={{ 
            width: '100%', 
            height: '100%' 
          }}
        />
      )}
    </div>
  );
}
```

```css
@keyframes ripple {
  0% {
    transform: scale(0.8);
    opacity: 1;
  }
  100% {
    transform: scale(2);
    opacity: 0;
  }
}

.animate-ripple {
  animation: ripple 0.6s ease-out forwards;
}
```

**Use Cases:**
- Phase transitions in status bar
- Session state changes (pause/resume)
- Target activation
- Finding discovery

---

### 8. NEURAL PATHWAY GRAPH LAYOUT

**Concept:** Knowledge graph visualization that looks like neural pathways rather than traditional node-link diagrams. Edges pulse with "data flow" when actions occur.

**Implementation:**

```tsx
// src/components/graph-explorer.tsx (enhanced)
export function GraphExplorer({ 
  data 
}: { 
  data: GraphData 
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [activeFlows, setActiveFlows] = useState<string[]>([]);
  
  // D3.js force simulation
  useEffect(() => {
    if (!svgRef.current) return;
    
    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;
    
    // Force simulation with custom curve links
    const simulation = d3.forceSimulation(data.nodes)
      .force('link', d3.forceLink(data.edges)
        .distance(80)
        .strength(0.5)
      )
      .force('charge', d3.forceManyBody()
        .strength(-200)
      )
      .force('center', d3.forceCenter(width / 2, height / 2));
    
    // Draw edges as curved paths with gradient
    const links = svg.append('g')
      .selectAll('path')
      .data(data.edges)
      .join('path')
      .attr('class', 'edge')
      .attr('stroke', 'url(#edgeGradient)')
      .attr('stroke-width', 1.5)
      .attr('fill', 'none')
      .attr('opacity', 0.3);
    
    // Edge gradient definition
    const defs = svg.append('defs');
    const gradient = defs.append('linearGradient')
      .attr('id', 'edgeGradient')
      .attr('gradientUnits', 'userSpaceOnUse');
    
    gradient.append('stop')
      .attr('offset', '0%')
      .attr('stop-color', 'var(--green-400)');
    
    gradient.append('stop')
      .attr('offset', '100%')
      .attr('stop-color', 'var(--cyan-400)');
    
    // Draw nodes as circles with glow
    const nodes = svg.append('g')
      .selectAll('circle')
      .data(data.nodes)
      .join('circle')
      .attr('r', 8)
      .attr('fill', d => getNodeColor(d.type))
      .attr('stroke', 'var(--green-400)')
      .attr('stroke-width', 2)
      .attr('filter', 'url(#nodeGlow)')
      .call(d3.drag()
        .on('start', dragStarted)
        .on('drag', dragged)
        .on('end', dragEnded)
      );
    
    // Node glow filter
    const filter = defs.append('filter')
      .attr('id', 'nodeGlow')
      .attr('x', '-50%')
      .attr('y', '-50%')
      .attr('width', '200%')
      .attr('height', '200%');
    
    filter.append('feGaussianBlur')
      .attr('stdDeviation', '3')
      .attr('result', 'coloredBlur');
    
    const feMerge = filter.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'coloredBlur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');
    
    // Simulation tick
    simulation.on('tick', () => {
      links.attr('d', d => {
        const dx = d.target.x - d.source.x;
        const dy = d.target.y - d.source.y;
        const dr = Math.sqrt(dx * dx + dy * dy);
        return `M${d.source.x},${d.source.y}A${dr},${dr} 0 0,1 ${d.target.x},${d.target.y}`;
      });
      
      nodes
        .attr('cx', d => d.x!)
        .attr('cy', d => d.y!);
    });
    
    // Cleanup
    return () => {
      simulation.stop();
    };
  }, [data]);
  
  return (
    <svg 
      ref={svgRef}
      className="w-full h-full bg-plasmic"
    />
  );
}
```

**Key Visual Effects:**
- **Curved edges:** Links are curved paths, not straight lines
- **Gradient edges:** Edges have green→cyan gradient
- **Node glow:** Nodes have subtle glow filter
- **Neural aesthetic:** Overall look resembles neural pathways
- **Pulse animation:** Active edges pulse with data flow (via CSS animation)

**Use Cases:**
- Knowledge graph explorer (Phase 5)
- Attack chain visualization
- Session replay graph

---

### 9. HOLOGRAPHIC DATA TABLE

**Concept:** Data tables with holographic rows that glow when hovered, and columns that can be "torn off" into separate panels.

**Implementation:**

```tsx
// src/components/holo-table.tsx
export function HoloTable<T>({ 
  data, 
  columns 
}: { 
  data: T[];
  columns: ColumnDef<T>[];
}) {
  const [detachedColumns, setDetachedColumns] = useState<string[]>([]);
  
  return (
    <div className="relative">
      <div className="panel-holographic rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-green-400/20">
              {columns.map(col => (
                <th 
                  key={col.id}
                  className="px-4 py-3 text-left text-sm font-medium text-green-100"
                >
                  <div className="flex items-center gap-2">
                    {col.header}
                    <button
                      onClick={() => detachColumn(col.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label={`Detach ${col.header} column`}
                    >
                      <DetachIcon className="w-4 h-4 text-green-400" />
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr 
                key={i}
                className="border-b border-gray-800/50 hover:bg-green-400/5 transition-colors group"
              >
                {columns.map(col => (
                  <td 
                    key={col.id}
                    className="px-4 py-3 text-sm text-gray-300"
                  >
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {/* Detached column panels */}
      {detachedColumns.map(colId => (
        <DetachedColumnPanel 
          key={colId}
          column={columns.find(c => c.id === colId)!}
          data={data}
          onClose={() => setDetachedColumns(prev => prev.filter(id => id !== colId))}
        />
      ))}
    </div>
  );
}
```

**Key Features:**
- **Holographic rows:** Rows glow on hover
- **Column detach:** Click to detach column into floating panel
- **Floating panels:** Detached columns are draggable
- **Sync:** Detached panels stay synced with table data

**Use Cases:**
- Findings table (Phase 4)
- Campaign coverage matrix (Phase 6)
- Forensic event log (Phase 6)

---

### 10. VOICE-ACTIVATED COMMAND PALETTE

**Concept:** Command palette that accepts voice commands in addition to keyboard input. "Omnitrix, show findings" triggers the findings page.

**Implementation:**

```tsx
// src/components/voice-command-palette.tsx
// Commands are config-driven via VoiceCommandRegistry — no hardcoded string maps.
// Registry is populated from: (1) static nav routes, (2) solver action definitions,
// (3) user-registered custom commands.
// See: src/components/voice-command-registry.ts
export function VoiceCommandPalette() {
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  
  useEffect(() => {
    if (!('webkitSpeechRecognition' in window)) return;
    
    const recognition = new webkitSpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map(result => result[0].transcript)
        .join('');
      
      setTranscript(transcript);
      
      if (event.results[0].isFinal) {
        processCommand(transcript);
      }
    };
    
    recognition.onend = () => {
      setListening(false);
    };
    
    recognitionRef.current = recognition;
  }, []);
  
  const startListening = () => {
    if (!recognitionRef.current) return;
    setListening(true);
    recognitionRef.current.start();
  };
  
  // Config-driven: commands registered via VoiceCommandRegistry, not hardcoded
  const processCommand = (command: string) => {
    const normalized = command.toLowerCase().trim();
    const action = voiceCommandRegistry.match(normalized);
    if (action) {
      action();
      setOpen(false);
    }
  };
  
  return (
    <Command.Dialog 
      open={open} 
      onOpenChange={setOpen}
    >
      <Command.Input 
        placeholder="Type a command or click the microphone..."
        value={transcript}
        onValueChange={setTranscript}
      />
      
      <button
        onClick={startListening}
        className={cn(
          "absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full",
          listening ? "bg-green-500/20 text-green-400" : "bg-gray-800 text-gray-400"
        )}
        aria-label={listening ? "Listening..." : "Start voice command"}
      >
        <MicrophoneIcon className="w-5 h-5" />
      </button>
      
      <Command.List>
        <Command.Empty>
          No results found. Try saying "show findings"
        </Command.Empty>
        
        <Command.Group heading="Navigation">
          <Command.Item onSelect={() => navigateTo('/dashboard')}>
            Show Dashboard
          </Command.Item>
          <Command.Item onSelect={() => navigateTo('/findings')}>
            Show Findings
          </Command.Item>
        </Command.Group>
        
        <Command.Group heading="Actions">
          <Command.Item onSelect={startSolver}>
            Start Attack
          </Command.Item>
          <Command.Item onSelect={pauseSolver}>
            Pause Attack
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
```

**Key Features:**
- **Voice activation:** Say "Omnitrix, [command]" to trigger
- **Visual feedback:** Microphone icon pulses while listening
- **Fallback:** Works with keyboard input if voice unavailable
- **No hardcoded lists:** Commands are registered dynamically

**Use Cases:**
- Global command palette (Phase 8)
- Quick navigation
- Hands-free operation during active testing

**VoiceCommandRegistry (config-driven):**

```ts
// src/components/voice-command-registry.ts
export interface VoiceCommand {
  id: string;
  aliases: string[];          // multiple spoken forms, e.g. ['start attack', 'begin attack']
  group: 'navigation' | 'actions' | 'tools';
  action: () => void | Promise<void>;
  description: string;
}

// Singleton registry — populated at app init, not hardcoded
class VoiceCommandRegistry {
  private commands: VoiceCommand[] = [];

  register(cmd: VoiceCommand) { this.commands.push(cmd); }

  match(transcript: string): (() => void) | undefined {
    const lower = transcript.toLowerCase().trim();
    for (const cmd of this.commands) {
      if (cmd.aliases.some(a => lower.includes(a))) {
        return cmd.action;
      }
    }
    return undefined;
  }

  list(): VoiceCommand[] { return [...this.commands]; }
}

export const voiceCommandRegistry = new VoiceCommandRegistry();
```

Commands are registered from:
1. `src/app/page.tsx` navigation routes (show dashboard, show findings, etc.)
2. Solver brain action definitions (start attack, pause, stop)
3. User custom commands (via settings panel)

---

### 11. REAL-TIME ATTACK ANIMATION LAYER

**Concept:** When tools are invoked, an animation layer shows the attack path in real-time. Visualizes HTTP requests, browser actions, and analysis steps as they happen.

**Implementation:**

```tsx
// src/components/attack-animation-layer.tsx
export function AttackAnimationLayer({ 
  stream 
}: { 
  stream: SolverStreamMessage[];
}) {
  const [animations, setAnimations] = useState<Animation[]>([]);
  
  useEffect(() => {
    const newAnimations = stream
      .filter(msg => msg.type === 'tool')
      .map(tool => ({
        id: tool.toolCallId,
        type: tool.toolName,
        timestamp: Date.now(),
        status: 'running' as const
      }));
    
    setAnimations(newAnimations);
  }, [stream]);
  
  return (
    <div className="fixed inset-0 pointer-events-none z-50">
      {animations.map(anim => (
        <motion.div
          key={anim.id}
          initial={{ opacity: 0, x: -50 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 50 }}
          className="absolute top-4 right-4"
        >
          <div className="panel-holographic rounded-lg p-4">
            <div className="flex items-center gap-3">
              <StatusGlyph status={anim.status} />
              <span className="text-sm text-green-100">{anim.type}</span>
            </div>
            
            {/* Attack path visualization */}
            <svg width="200" height="50" className="mt-2">
              <motion.path
                d="M0,25 Q50,10 100,25 T200,25"
                stroke="var(--green-400)"
                strokeWidth="2"
                fill="none"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 2, ease: "easeInOut" }}
              />
            </svg>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
```

**Key Features:**
- **Non-blocking:** Overlay doesn't interfere with main UI
- **Real-time:** Updates as tools execute
- **Attack path:** Shows trajectory of current attack
- **Auto-dismiss:** Fades out when complete

**Use Cases:**
- Active attack visualization
- Tool invocation feedback
- Session replay

---

### 12. THEMED ERROR STATES

**Concept:** Error states that match the Omnitrix theme. Instead of generic error messages, show "System Malfunction" with alien-themed visuals.

**Visual Design:**

```
┌─────────────────────────────────────┐
│  ⚠ SYSTEM MALFUNCTION              │
│                                     │
│  Connection lost to target.         │
│  Retrying in 3... 2... 1...        │
│                                     │
│  [⚡ Retry] [◇ Cancel]             │
└─────────────────────────────────────┘
```

**Implementation:**

```tsx
// src/components/error-boundary.tsx
export function OmnitrixErrorBoundary({ 
  children 
}: { 
  children: React.ReactNode 
}) {
  return (
    <ErrorBoundary
      fallback={({ error, resetErrorBoundary }) => (
        <div className="min-h-screen bg-void flex items-center justify-center">
          <div className="panel-holographic rounded-lg p-8 max-w-md">
            <div className="flex items-center gap-4 mb-4">
              <div className="text-4xl">⚠</div>
              <div>
                <h2 className="text-lg font-semibold text-green-100">
                  System Malfunction
                </h2>
                <p className="text-sm text-gray-400">
                  {error.message}
                </p>
              </div>
            </div>
            
            <div className="flex gap-3">
              <Button 
                onClick={resetErrorBoundary}
                className="bg-green-600 hover:bg-green-500"
              >
                ⚡ Restart
              </Button>
              <Button 
                variant="outline"
                className="border-green-400/30 text-green-400"
              >
                ◇ Report
              </Button>
            </div>
          </div>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
```

**Key Features:**
- **Themed messaging:** "System Malfunction" instead of "Error"
- **Alien glyphs:** Use threat glyphs for error indicators
- **Auto-retry:** Countdown timer with retry
- **Recovery actions:** Clear action buttons

**Use Cases:**
- Global error boundary
- API error states
- Connection failures
- Solver crashes

---

## IMPLEMENTATION PRIORITY

These enhancements are prioritized by visual impact and implementation effort.

| Priority | Enhancement | Effort | Phase | Impact | Composite Score |
|----------|-------------|--------|-------|--------|-----------------|
| 1 | Holographic Transparency System | M | P0 | ★★★★★ | 5M |
| 2 | Omnitrix Dial Loader | S | P0 | ★★★★☆ | 4S |
| 3 | Status Glyphs | XS | P0 | ★★★☆☆ | 3XS |
| 4 | Plasmic Background Effect | S | P0 | ★★★☆☆ | 3S |
| 5 | Phase Transition Ripple | M | P2 | ★★★☆☆ | 3M |
| 6 | DNA Helix Progress | M | P2 | ★★★☆☆ | 3M |
| 7 | Real-time Attack Animation | M | P2 | ★★★★☆ | 4M |
| 8 | Temporal Shadow Effect | XS | P4 | ★★☆☆☆ | 2XS |
| 9 | Neural Pathway Graph Layout | L | P5 | ★★★★★ | 5L |
| 10 | Holographic Data Table | L | P4 | ★★★★☆ | 4L |
| 11 | Voice Command Palette | M | P8 | ★★★★☆ | 4M |
| 12 | Themed Error States | S | P8 | ★★★☆☆ | 3S |

**Composite Score = Impact rating × Effort size.** Lower effort + higher impact = higher priority.

**Recommended Implementation Order:**

1. **P0 Enhancements:** Holographic panels, Omnitrix loader, Status glyphs, Plasmic background
2. **P2 Enhancements:** Phase ripple, DNA progress, Attack animation layer
3. **P4-P5 Enhancements:** Temporal shadows, Holographic table, Neural graph
4. **P8 Enhancements:** Voice commands, Themed error states

---

## DESIGN TOKEN EXTENSIONS

Add these tokens to `globals.css` to support the new enhancements:

```css
:root {
  /* Holographic transparency */
  --hologram-opacity: 0.65;
  --hologram-blur: 12px;
  
  /* Plasmic background */
  --plasmic-green: rgba(43, 224, 138, 0.03);
  --plasmic-cyan: rgba(54, 201, 230, 0.02);
  --plasmic-drift-duration: 20s;
  
  /* Neural graph */
  --neural-node-glow: rgba(43, 224, 138, 0.4);
  --neural-edge-width: 1.5;
  
  /* Temporal shadow */
  --temporal-offset: 4px;
  --temporal-tint: rgba(43, 224, 138, 0.03);
  
  /* Animation timings */
  --ripple-duration: 0.6s;
  --pulse-duration: 1.5s;
  --spin-slow-duration: 2s;
  --drift-duration: 20s;
}
```

---

## ANTI-BANDAID CHECKLIST FOR ENHANCEMENTS

Before implementing any enhancement:

- [ ] **No JavaScript where CSS suffices** (hover effects, animations)
- [ ] **No hardcoded glyph mappings** (read from config or data)
- [ ] **No regex for command parsing** (use structured matching)
- [ ] **Performance budget:** Each enhancement adds <10ms to render time
- [ ] **Accessibility:** All visual enhancements have accessible alternatives
- [ ] **Mobile support:** Animations gracefully degrade on mobile
- [ ] **No blocking overlays:** Attack animation layer is non-blocking

---

## SUMMARY

This plan now includes **12 super unique design enhancements** that will differentiate Ultimatrix from every other security tool:

1. **Holographic Transparency System** - Glassmorphism meets alien hologram tech
2. **Omnitrix Dial Loader** - Custom loading animations with hourglass symbol
3. **DNA Helix Progress Indicator** - Phases visualized as unwinding DNA
4. **Plasmic Background Effect** - Subtle animated plasma/energy fields
5. **Alien Glyph Decorators** - Contextual alien symbols for severity/status
6. **Temporal Shadow Effect** - Time-travel-inspired shadow effects
7. **Phase Transition Ripple** - Visual feedback for phase changes
8. **Neural Pathway Graph Layout** - Brain-inspired knowledge graph visualization
9. **Holographic Data Table** - Interactive tables with detachable columns
10. **Voice-Activated Command Palette** - Say "Omnitrix, show findings"
11. **Real-Time Attack Animation Layer** - Live visualization of attack paths
12. **Themed Error States** - "System Malfunction" with alien styling

These enhancements transform Ultimatrix from a standard security tool into a visually striking, memorable experience that users will talk about and remember.

---

## ARCHITECTURE INTEGRATION

The 12 enhancements integrate into two existing surfaces:

### Terminal REPL (Ink TUI)
- **Location:** `src/components/ui/` (Ink-based, uses `ink` primitives: `Box`, `Text`, `useInput`)
- **Entry:** `ultimatrix interact` → `lifecycle.runREPL` → Ink rendering
- **Status:** Retained as-is. Terminal components use Ink-specific APIs (`Box`, `Text`, `useAnimation`).
- **New components (enhancements #2, #3, #5)**: If they need to appear in terminal, they must use Ink primitives (`Text`, `Box`) — NOT React DOM.
- **Existing spinner:** `src/components/ui/spinner.tsx` uses `cli-spinners` + `useAnimation`. The Omnitrix Dial Loader (#2) replaces this.

### Web UI (Next.js)
- **Location:** `src/app/` + `src/components/`
- **Entry:** `ultimatrix web` → Next.js dev server → `src/app/page.tsx`
- **Layout:** Sidebar nav (`lucide-react` icons) + tab content (`ChatPanel`, `FindingsPanel`, `CodePanel`, `ActivityPanel`, `SettingsPanel`, `StatusBar`)
- **Providers:** `next-themes` (ThemeProvider with dark mode default)
- **Existing UI primitives:** `src/components/ui/` — Tailwind CSS classes + `class-variance-authority` + `tailwind-merge` + `clsx` (for `cn()` utility)
- **New components (enhancements #1, #4, #6, #7, #8, #9, #10, #11, #12)**: All belong in `src/components/` as React DOM components using Tailwind + CSS custom properties.

### Integration Point
- Enhancements #2 (OmnitrixLoader), #3 (DNAProgress), #5 (Glyphs), #6 (TemporalShadow) have dual variants: Ink (terminal) and React DOM (web).
- Enhancements #1 (Holographic), #4 (Plasmic), #7 (Ripple), #8 (NeuralGraph), #9 (HoloTable), #10 (VoicePalette), #11 (AttackAnimation), #12 (ErrorBoundary) are web-only.

### Component Home Map

| Enhancement | Web (`src/components/`) | Terminal (`src/components/ui/`) |
|-------------|------------------------|-------------------------------|
| #1 Holographic Panels | `panel-holographic.tsx` (CSS class) | N/A — CSS only |
| #2 Omnitrix Loader | `omnitrix-loader.tsx` | `spinner.tsx` (replace) |
| #3 DNA Progress | `dna-progress.tsx` | `dna-progress-ink.tsx` |
| #4 Plasmic Background | `bg-plasmic.tsx` (CSS class) | N/A — CSS only |
| #5 Status Glyphs | `glyphs.tsx` | `glyphs-ink.tsx` |
| #6 Temporal Shadow | `temporal-shadow.tsx` (CSS class) | N/A — CSS only |
| #7 Phase Ripple | `phase-indicator.tsx` + `use-phase-ripple.ts` | N/A |
| #8 Neural Graph | `graph-explorer.tsx` | N/A |
| #9 Holo Table | `holo-table.tsx` | N/A |
| #10 Voice Palette | `voice-command-palette.tsx` + `voice-command-registry.ts` | N/A |
| #11 Attack Animation | `attack-animation-layer.tsx` | N/A |
| #12 Error Boundary | `error-boundary.tsx` | N/A |

---

## DEPENDENCY AUDIT

### Already Installed (verified in `package.json`)
| Dependency | Version | Used By |
|------------|---------|---------|
| `cmdk` | ^1.1.1 | Voice Command Palette (#10) |
| `class-variance-authority` | ^0.7.1 | All `cn()` class variants |
| `clsx` | ^2.1.1 | `cn()` utility |
| `tailwind-merge` | ^2.6.1 | `cn()` utility |
| `tailwindcss` | ^3.4.19 | All Tailwind classes |
| `tailwindcss-animate` | ^1.0.7 | Animation utilities |
| `lucide-react` | ^0.400.0 | Icon system |
| `next-themes` | ^0.4.6 | Theme provider |
| `@radix-ui/react-dialog` | ^1.1.16 | Modal/backdrop for #9, #12 |
| `@radix-ui/react-scroll-area` | ^1.2.11 | Scroll for #9 table |
| `@radix-ui/react-tabs` | ^1.1.14 | Tab system |
| `@ai-sdk/react` | ^1.2.12 | Chat streaming |

### Must Be Added
| Dependency | Used By | Notes |
|------------|---------|-------|
| `d3` | Neural Graph (#8) | ~300KB. Consider `@xyflow/react` as lighter alternative if graph is needed. |
| `framer-motion` | Attack Animation (#11) | ~50KB. Alternatively, use CSS `@keyframes` + `transition` (no JS animation needed). |
| `react-error-boundary` | Error Boundary (#12) | Lightweight. Or implement from scratch (~20 lines). |
| `d3-force` | Neural Graph (#8) | If using d3 selectively. Or full `d3` for gradients + simulation. |

### Dependency Decision Points
1. **d3 vs @xyflow/react for graph:** d3 is more flexible (custom neural pathway look). `@xyflow/react` is easier but constrains to node-link diagrams. Recommend: `d3` for the custom visual.
2. **framer-motion vs CSS animations:** framer-motion adds ~50KB but simplifies AttackAnimationLayer (#11). CSS-only is lighter but more boilerplate. Recommend: framer-motion for the complex path animation; CSS for simple effects.
3. **react-error-boundary vs hand-rolled:** The existing `ErrorBoundary` pattern is ~20 lines. Hand-rolled is simpler and avoids a dependency. Recommend: hand-rolled.

---

## TERMINAL REPL vs WEB UI RELATIONSHIP

The two surfaces coexist — they are **parallel interfaces**, not replacements.

| Aspect | Terminal REPL | Web UI |
|--------|--------------|--------|
| **Entry** | `ultimatrix interact -t <url>` | `ultimatrix web` |
| **Rendering** | Ink (React terminal renderer) | Next.js (browser) |
| **State** | In-process, single session | HTTP API polling (`/api/*`) |
| **Enhancements** | Loader (#2), DNA Progress (#3), Glyphs (#5) | All 12 |
| **Solver output** | Streamed to terminal | Streamed via `/api/chat` → `@ai-sdk/react` |
| **Config** | `ultimatrix.yaml` | `ultimatrix.yaml` |

**The Web UI is the primary surface for all visual enhancements.** The terminal gets the lightweight variants (loader, progress, glyphs) via Ink-compatible implementations. The Web UI gets the full holographic/D3/framer-motion experience.

---

## STATE MANAGEMENT STRATEGY

### Current State
- Web UI uses `useState` in `page.tsx` for tab state + `useEffect` polling for findings count.
- Chat uses `@ai-sdk/react` `useChat` hook (manages message stream internally).
- No shared state store — panels are independent.

### Proposed: Zustand Store
Lightweight (~2KB), no boilerplate, works with React 19.

```ts
// src/stores/app-store.ts
import { create } from 'zustand';

interface AppState {
  // Session
  target: string | null;
  setTarget: (url: string) => void;

  // Solver phase
  solverPhase: 'idle' | 'observe' | 'reason' | 'explore' | 'conclude';
  setSolverPhase: (phase: AppState['solverPhase']) => void;

  // Findings
  findings: Finding[];
  addFinding: (f: Finding) => void;
  setFindings: (fs: Finding[]) => void;

  // Selected finding
  selectedFindingId: string | null;
  selectFinding: (id: string | null) => void;

  // Attack animation queue
  activeAnimations: Animation[];
  addAnimation: (a: Animation) => void;
  removeAnimation: (id: string) => void;

  // Voice commands
  commands: VoiceCommand[];
  registerCommand: (cmd: VoiceCommand) => void;
}
```

### Data Flow
```
Solver stream → /api/chat → @ai-sdk/react useChat
                             ↓
Zustand store ← POST /api/state ← solver output
     ↓
  Components subscribe via useAppStore(selector)
```

### Key Principle
- **Single source of truth** — solver state lives in Zustand, not in each component's local state.
- **Optimistic updates** — UI updates immediately, reconciles with server on next poll.
- **No prop drilling** — components subscribe directly to store slices.

---

## RESPONSIVE DESIGN NOTES

| Enhancement | Desktop | Tablet (≤1024px) | Mobile (≤640px) |
|-------------|---------|-------------------|-----------------|
| #1 Holographic Panels | Full backdrop blur | Reduce blur to 8px | No backdrop-filter (perf) |
| #2 Omnitrix Loader | 48px, full animation | 40px, same animation | 32px, reduced animation |
| #3 DNA Progress | Horizontal layout | Horizontal, smaller | Vertical stack |
| #4 Plasmic Background | Full effect | Reduce opacity to 1.5% | Disable (perf) |
| #5 Status Glyphs | Full size + animation | Same | Same (tiny, no issue) |
| #6 Temporal Shadow | 4px offset, full | 2px offset | 0px (no shadow) |
| #7 Phase Ripple | Full ripple | Same | Same (CSS only) |
| #8 Neural Graph | Full D3 force sim | Reduce node count | Lazy load or skeleton |
| #9 Holo Table | Full columns + detach | Hide detach button | Card layout (no table) |
| #10 Voice Palette | Keyboard + voice | Voice only (mic btn) | Voice only |
| #11 Attack Animation | Full overlay | Same, fewer particles | Disable overlay |
| #12 Error Boundary | Full panel | Same | Same |

**Mobile-first rule:** Every enhancement degrades gracefully. CSS effects (`backdrop-filter`, `animation`, `transform`) are progressively disabled at lower breakpoints via `@media` queries. No enhancement should cause jank on mobile.

---

## PERFORMANCE OPTIMIZATIONS

### Per-Enhancement Budget
Each enhancement must add **<10ms to first paint** and **<5ms per re-render**.

### Specific Optimizations

| Enhancement | Concern | Mitigation |
|-------------|---------|------------|
| #1 Holographic | `backdrop-filter` is GPU-intensive | Use `will-change: backdrop-filter` on panels; limit to 3-5 simultaneous panels |
| #8 Neural Graph | D3 force simulation on every data change | Memoize simulation: `useMemo(() => d3.forceSimulation(nodes), [nodes.length])`; throttle tick updates to 16ms |
| #9 Holo Table | Column detach creates floating DOM panels | Limit detached columns to 3; use `position: fixed` not `absolute` |
| #10 Voice Palette | `webkitSpeechRecognition` blocks main thread | Run in Web Worker if available; timeout after 10s |
| #11 Attack Animation | `framer-motion` re-renders on every stream message | Throttle: only animate the latest 5 tool calls; use `AnimatePresence` for exit animations |
| #4 Plasmic Background | 20s CSS animation on `::before` pseudo-element | Use `will-change: transform` for GPU acceleration; `pointer-events: none` |

### Bundle Size Budget
| Package | Size | Acceptable |
|---------|------|------------|
| d3 | ~300KB | Yes — graph is the heaviest feature |
| framer-motion | ~50KB | Yes — used for complex path animations |
| Existing (cmdk, Radix, tailwind) | ~150KB | Already in bundle |

---

## TESTING STRATEGY

### Per-Component Test Plan

| Enhancement | Test Type | File | Tests |
|-------------|-----------|------|-------|
| #1 Holographic Panels | CSS class presence, opacity | `test/ui/holographic.test.tsx` | Renders with correct class, hover state |
| #2 Omnitrix Loader | Phase rendering, SVG structure | `test/ui/omnitrix-loader.test.tsx` | Idle/loading/complete states, SVG elements |
| #3 DNA Progress | Phase progression, strand separation | `test/ui/dna-progress.test.tsx` | Phase 0-4 rendering, transitions |
| #4 Plasmic Background | CSS class presence, animation | `test/ui/plasmic.test.tsx` | Renders correctly, no perf regression |
| #5 Status Glyphs | Severity rendering, color mapping | `test/ui/glyphs.test.tsx` | All 5 threat glyphs, all 5 status glyphs |
| #6 Temporal Shadow | Hover state, CSS class | `test/ui/temporal-shadow.test.tsx` | Renders, hover activates |
| #7 Phase Ripple | Ripple trigger, animation | `test/ui/phase-ripple.test.tsx` | Fires on phase change, cleanup |
| #8 Neural Graph | D3 simulation, node/edge rendering | `test/ui/graph-explorer.test.tsx` | Renders nodes, handles empty data |
| #9 Holo Table | Column detach, data rendering | `test/ui/holo-table.test.tsx` | Renders rows, detach/re-attach |
| #10 Voice Palette | Registry matching, command dispatch | `test/ui/voice-palette.test.tsx` | Match success/fail, command groups |
| #11 Attack Animation | Animation lifecycle, auto-dismiss | `test/ui/attack-animation.test.tsx` | Appears on stream, fades on complete |
| #12 Error Boundary | Error catch, fallback render | `test/ui/error-boundary.test.tsx` | Catches error, shows themed fallback |

### Anti-Bandaid Checklist (Updated)
Before implementing any enhancement:

- [ ] **No JavaScript where CSS suffices** (hover effects, animations)
- [ ] **No hardcoded glyph mappings** (read from config or data)
- [ ] **No regex for command parsing** (use structured matching)
- [ ] **No hardcoded command lists in voice palette** (use VoiceCommandRegistry)
- [ ] **Performance budget:** Each enhancement adds <10ms to render time
- [ ] **Accessibility:** All visual enhancements have `aria-label` or `aria-hidden`
- [ ] **Mobile support:** Animations gracefully degrade via `@media` queries
- [ ] **No blocking overlays:** Attack animation layer is non-blocking
- [ ] **Each component has a test file** in `test/ui/`
- [ ] **Dependency audit complete** before implementing (see DEPENDENCY AUDIT)
- [ ] **Zustand store used** for shared state, not prop drilling
- [ ] **Dual-surface check:** Enhancement works on both web and terminal (or is web-only by design)
