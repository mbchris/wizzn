import { nativePlugin } from 'src/native/capacitor'

// Shape of @capacitor/haptics; absent until that plugin is added to src-capacitor
interface HapticsPlugin {
  impact(o: { style: 'LIGHT' | 'MEDIUM' | 'HEAVY' }): Promise<void>
  notification(o: { type: 'SUCCESS' | 'WARNING' | 'ERROR' }): Promise<void>
  selectionChanged(): Promise<void>
}

const plugin = (): HapticsPlugin | null => nativePlugin<HapticsPlugin>('Haptics')
const vibrate = (ms: number | number[]): void => {
  try {
    navigator.vibrate?.(ms)
  } catch {
    // vibration unsupported
  }
}

/** LAYOUT.md §4 haptic triggers. Native plugin when present, Vibration API otherwise. */
export function useHaptics() {
  return {
    /** Unit snap in the vertical pager (native only — web vibration on every scroll is noise) */
    snap: () => void plugin()?.impact({ style: 'MEDIUM' }).catch(() => undefined),
    /** Scrubbing the audio waveform */
    tick: () => void plugin()?.selectionChanged().catch(() => undefined),
    /** Unit finished / weekly goal reached */
    success: () => {
      const p = plugin()
      if (p) void p.notification({ type: 'SUCCESS' }).catch(() => undefined)
      else vibrate([12, 40, 18])
    },
    light: () => {
      const p = plugin()
      if (p) void p.impact({ style: 'LIGHT' }).catch(() => undefined)
      else vibrate(8)
    },
  }
}
