import { Notify } from 'quasar'
import { nativePlugin } from 'src/native/capacitor'

interface SharePlugin {
  share(o: { title?: string; text?: string; url?: string; dialogTitle?: string }): Promise<unknown>
}

/** Native share sheet (@capacitor/share when installed) → Web Share API → clipboard fallback */
export async function shareText(title: string, text: string): Promise<void> {
  try {
    const native = nativePlugin<SharePlugin>('Share')
    if (native) {
      await native.share({ title, text, dialogTitle: title })
      return
    }
    if (navigator.share) {
      await navigator.share({ title, text })
      return
    }
    await navigator.clipboard.writeText(text)
    Notify.create({ message: 'In die Zwischenablage kopiert 📋', color: 'dark', position: 'top', timeout: 1600 })
  } catch (e) {
    // User cancelled the share sheet: nothing to report
    if (e instanceof Error && e.name === 'AbortError') return
    console.warn('share failed', e)
  }
}
