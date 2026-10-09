<script setup lang="ts">
import { computed, ref } from 'vue'
import { signInWithIdToken, type SocialProvider } from 'src/api'
import { availableProviders, getIdToken } from 'src/native/socialLogin'
import { useProgress } from 'src/composables/useProgress'
import { usePlatform } from 'src/composables/usePlatform'

const props = defineProps<{ reason: 'streak' | 'purchase' | 'profile' }>()
const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ signedIn: [] }>()
const { refresh } = useProgress()
const { isIos } = usePlatform()
const providers = availableProviders()
const busy = ref<SocialProvider | null>(null)
const error = ref('')

const COPY = {
  streak: { title: 'Sichere deinen Streak 🔥', text: 'Mit einem Konto bleiben Streak, XP und Abzeichen erhalten – auch auf einem neuen Handy.' },
  purchase: { title: 'Erst kurz anmelden', text: 'Dein Premium-Abo hängt an deinem Konto, damit du es auf jedem Gerät wiederherstellen kannst.' },
  profile: { title: 'Konto verbinden', text: 'Dein bisheriger Fortschritt wird übernommen.' },
} as const
const copy = computed(() => COPY[props.reason])

async function signIn(provider: SocialProvider): Promise<void> {
  busy.value = provider
  error.value = ''
  try {
    const idToken = await getIdToken(provider)
    if (!idToken) return
    await signInWithIdToken(provider, idToken)
    await refresh()
    open.value = false
    emit('signedIn')
  } catch (e) {
    console.warn('sign-in failed', e)
    error.value = 'Anmeldung fehlgeschlagen. Versuch es noch einmal.'
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <q-dialog v-model="open" :position="isIos ? 'bottom' : 'standard'">
    <div class="wz-sheet column q-pa-lg">
      <div class="wz-title q-mb-sm">{{ copy.title }}</div>
      <div class="q-mb-lg" style="color: var(--wz-muted)">{{ copy.text }}</div>
      <template v-if="providers.length">
        <!-- Apple HIG: Sign in with Apple is at least as prominent as other providers, so it comes first -->
        <button v-if="providers.includes('apple')" type="button" class="wz-social apple q-mb-sm" :disabled="busy !== null" @click="signIn('apple')">
          <q-spinner v-if="busy === 'apple'" size="20px" />
          <svg v-else viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M16.37 1.43c0 1.14-.49 2.27-1.18 3.08-.74.9-1.99 1.57-2.99 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.57-2.27 1.21-2.98.8-.94 2.14-1.64 3.25-1.68.03.13.05.28.05.43zm4.56 15.71c-.03.07-.46 1.58-1.52 3.12-.94 1.34-1.94 2.71-3.43 2.71-1.52 0-1.9-.88-3.63-.88-1.7 0-2.3.91-3.67.91-1.38 0-2.33-1.26-3.43-2.8C4 18.38 2.96 15.57 2.96 12.92c0-4.28 2.8-6.55 5.55-6.55 1.45 0 2.68.95 3.6.95.87 0 2.22-1.01 3.9-1.01.61 0 2.89.06 4.37 2.19-.13.09-2.38 1.37-2.38 4.19 0 3.26 2.85 4.42 2.96 4.45z" /></svg>
          Mit Apple anmelden
        </button>
        <button v-if="providers.includes('google')" type="button" class="wz-social google" :disabled="busy !== null" @click="signIn('google')">
          <q-spinner v-if="busy === 'google'" size="20px" />
          <svg v-else viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
          </svg>
          Mit Google anmelden
        </button>
      </template>
      <div v-else class="wz-glass q-pa-md text-center">Die Anmeldung ist in der iOS- und Android-App verfügbar.</div>
      <div v-if="error" class="text-negative q-mt-sm">{{ error }}</div>
      <q-btn flat no-caps class="q-mt-md" color="white" label="Später" @click="open = false" />
    </div>
  </q-dialog>
</template>

<style scoped lang="scss">
.wz-sheet { background: var(--wz-bg); color: #fff; border-radius: 24px 24px 0 0; width: 100%; max-width: 480px; padding-bottom: calc(24px + var(--wz-safe-bottom)); }
.wz-social { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; height: 52px; border-radius: 14px; border: 0; font: inherit; font-weight: 800; font-size: 17px; }
.wz-social:disabled { opacity: 0.6; }
.wz-social.apple { background: #fff; color: #000; }
.wz-social.google { background: #fff; color: #1f1f1f; border: 1px solid #dadce0; }
</style>
