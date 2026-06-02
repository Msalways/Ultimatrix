import { chromium, type Browser, type Page, type BrowserContext } from 'playwright';

export interface ViewportOptions {
  headless?: boolean;
  width?: number;
  height?: number;
  userAgent?: string;
}

export interface NavigationResult {
  url: string;
  title: string;
  status: number;
  html: string;
  text: string;
}

export class Viewport {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private options: ViewportOptions;
  private networkLog: { url: string; method: string; status: number }[] = [];

  constructor(options: ViewportOptions = {}) {
    this.options = {
      headless: true,
      width: 1280,
      height: 720,
      ...options,
    };
  }

  async launch(): Promise<void> {
    this.browser = await chromium.launch({ headless: this.options.headless });
    this.context = await this.browser.newContext({
      viewport: { width: this.options.width!, height: this.options.height! },
      userAgent: this.options.userAgent,
    });
    this.page = await this.context.newPage();

    this.page.on('response', async (response) => {
      this.networkLog.push({
        url: response.url(),
        method: response.request().method(),
        status: response.status(),
      });
    });
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  async navigate(url: string): Promise<NavigationResult> {
    if (!this.page) throw new Error('Viewport not launched');
    const response = await this.page.goto(url, { waitUntil: 'load', timeout: 30000 });
    return {
      url: this.page.url(),
      title: await this.page.title(),
      status: response?.status() || 0,
      html: await this.page.content(),
      text: await this.page.evaluate(() => {
        const body = document.body;
        return body ? body.innerText : '';
      }),
    };
  }

  async click(selector: string): Promise<void> {
    if (!this.page) throw new Error('Viewport not launched');
    await this.page.click(selector, { timeout: 10000 });
  }

  async type(selector: string, text: string): Promise<void> {
    if (!this.page) throw new Error('Viewport not launched');
    await this.page.fill(selector, text);
  }

  async extract(selector: string): Promise<string> {
    if (!this.page) throw new Error('Viewport not launched');
    return await this.page.locator(selector).textContent() || '';
  }

  async evaluate(script: string): Promise<unknown> {
    if (!this.page) throw new Error('Viewport not launched');
    return await this.page.evaluate(script);
  }

  async screenshot(fullPage: boolean = false): Promise<Buffer> {
    if (!this.page) throw new Error('Viewport not launched');
    return await this.page.screenshot({ fullPage });
  }

  async getPageContent(): Promise<string> {
    if (!this.page) throw new Error('Viewport not launched');
    return await this.page.evaluate(() => {
      const body = document.body;
      return body ? body.innerText : '';
    });
  }

  async getInteractiveElements(): Promise<{ selector: string; type: string; text: string }[]> {
    if (!this.page) throw new Error('Viewport not launched');
    return await this.page.evaluate(() => {
      const elements: { selector: string; type: string; text: string }[] = [];
      const selectors = ['a', 'button', 'input', 'select', 'textarea', '[role="button"]'];
      for (const sel of selectors) {
        const els = document.querySelectorAll(sel);
        els.forEach((el, i) => {
          const tag = el.tagName.toLowerCase();
          const text = (el as HTMLElement).innerText?.slice(0, 100) || (el as HTMLInputElement).placeholder || '';
          elements.push({
            selector: `${tag}:nth-of-type(${i + 1})`,
            type: tag,
            text,
          });
        });
      }
      return elements;
    });
  }

  getNetworkLog(): { url: string; method: string; status: number }[] {
    return [...this.networkLog];
  }

  clearNetworkLog(): void {
    this.networkLog = [];
  }
}
