/**
 * Environment-aware logger utility
 * Only outputs debug logs in non-production environments (localhost, dev.vapai.studio)
 * Suppresses logs in production (app.vapai.studio)
 */

interface TimingEntry {
  step: string;
  startTime: number;
  endTime?: number;
  duration?: number;
}

class Logger {
  private isDebugMode: boolean;
  private timings: Map<string, TimingEntry>;

  constructor() {
    // Check if we're in a debug-enabled environment
    const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
    this.isDebugMode =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === 'dev.vapai.studio' ||
      hostname.includes('localhost');

    this.timings = new Map();
  }

  /**
   * Log a debug message (only in non-production)
   */
  debug(message: string, ...args: any[]): void {
    if (this.isDebugMode) {
      console.log(`[DEBUG] ${message}`, ...args);
    }
  }

  /**
   * Log an info message (only in non-production)
   */
  info(message: string, ...args: any[]): void {
    if (this.isDebugMode) {
      console.info(`[INFO] ${message}`, ...args);
    }
  }

  /**
   * Log a warning message (only in non-production)
   */
  warn(message: string, ...args: any[]): void {
    if (this.isDebugMode) {
      console.warn(`[WARN] ${message}`, ...args);
    }
  }

  /**
   * Log an error message (always logged, even in production)
   */
  error(message: string, ...args: any[]): void {
    console.error(`[ERROR] ${message}`, ...args);
  }

  /**
   * Start timing a step
   */
  startTiming(step: string): void {
    if (this.isDebugMode) {
      this.timings.set(step, {
        step,
        startTime: performance.now()
      });
      this.debug(`⏱️  Starting: ${step}`);
    }
  }

  /**
   * End timing a step and log duration
   */
  endTiming(step: string): number | null {
    if (!this.isDebugMode) return null;

    const timing = this.timings.get(step);
    if (!timing) {
      this.warn(`No timing found for step: ${step}`);
      return null;
    }

    timing.endTime = performance.now();
    timing.duration = timing.endTime - timing.startTime;

    const durationSeconds = (timing.duration / 1000).toFixed(2);
    this.debug(`✓ Completed: ${step} - ${durationSeconds}s`);

    return timing.duration;
  }

  /**
   * Get timing for a specific step
   */
  getTiming(step: string): number | null {
    const timing = this.timings.get(step);
    return timing?.duration ?? null;
  }

  /**
   * Log a complete breakdown of all timings
   */
  logTimingSummary(): void {
    if (!this.isDebugMode) return;

    const completedTimings = Array.from(this.timings.values())
      .filter(t => t.duration !== undefined);

    if (completedTimings.length === 0) {
      this.debug('No timing data available');
      return;
    }

    const totalDuration = completedTimings.reduce((sum, t) => sum + (t.duration || 0), 0);
    const totalSeconds = (totalDuration / 1000).toFixed(2);

    console.log('\n' + '='.repeat(50));
    console.log('⏱️  TIMING BREAKDOWN - 3x3 Grid Flow');
    console.log('='.repeat(50));

    completedTimings.forEach((timing, index) => {
      const durationSeconds = ((timing.duration || 0) / 1000).toFixed(2);
      const percentage = ((timing.duration || 0) / totalDuration * 100).toFixed(1);
      console.log(`${index + 1}. ${timing.step}: ${durationSeconds}s (${percentage}%)`);
    });

    console.log('-'.repeat(50));
    console.log(`TOTAL: ${totalSeconds}s`);
    console.log('='.repeat(50) + '\n');
  }

  /**
   * Clear all timing data
   */
  clearTimings(): void {
    this.timings.clear();
  }

  /**
   * Check if debug mode is enabled
   */
  isDebug(): boolean {
    return this.isDebugMode;
  }
}

// Export singleton instance
export const logger = new Logger();

// Also export the class for testing
export { Logger };
