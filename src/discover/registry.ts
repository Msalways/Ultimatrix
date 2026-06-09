import type { ParamDiscoverer, DiscoveredParam, DiscoverContext, ParamDiscovererConfig } from './types';

const COST_ORDER: Record<string, number> = {
  free: 0,
  cheap: 1,
  medium: 2,
  expensive: 3,
};

export class ParamRegistry {
  private discoverers = new Map<string, ParamDiscoverer>();

  register(d: ParamDiscoverer): void {
    this.discoverers.set(d.id, d);
  }

  get(id: string): ParamDiscoverer | undefined {
    return this.discoverers.get(id);
  }

  all(): ParamDiscoverer[] {
    return [...this.discoverers.values()];
  }

  async discover(
    ctx: DiscoverContext,
    opts?: { maxCost?: string; ids?: string[] },
  ): Promise<DiscoveredParam[]> {
    const maxCostLevel = opts?.maxCost ? (COST_ORDER[opts.maxCost] ?? 0) : 0;
    const seen = new Map<string, DiscoveredParam>();

    let candidates = this.all();
    if (opts?.ids) {
      candidates = candidates.filter((d) => opts.ids!.includes(d.id));
    }

    for (const d of candidates) {
      const costLevel = COST_ORDER[d.cost] ?? 0;
      if (costLevel > maxCostLevel) continue;

      let params: DiscoveredParam[];
      try {
        params = await d.discover(ctx);
      } catch {
        continue;
      }

      for (const p of params) {
        const key = `${p.name}:${p.type}`;
        const existing = seen.get(key);
        if (!existing || p.confidence > existing.confidence) {
          seen.set(key, p);
        }
      }
    }

    return [...seen.values()].sort((a, b) => b.confidence - a.confidence);
  }

  toConfig(): ParamDiscovererConfig {
    return {
      id: 'param-registry',
      layers: this.all().map((d) => ({ id: d.id })),
    };
  }
}
