<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Notify } from 'quasar'
import { DEFAULT_FREE_DAILY_CAP } from '@wizzn/shared'
import { api } from 'src/api'
import AccountSheet from 'components/AccountSheet.vue'
import { buy, loadPackages, purchasesAvailable, restore, type StorePackage } from 'src/native/purchases'
import { useProgress } from 'src/composables/useProgress'
import { usePlatform } from 'src/composables/usePlatform'

const router = useRouter()
const { pIcon } = usePlatform()
const { progress, me, refresh } = useProgress()
const packages = ref<StorePackage[]>([])
const selected = ref<StorePackage | null>(null)
const busy = ref(false)
const error = ref('')
const accountOpen = ref(false)
let afterSignIn: (() => Promise<void>) | null = null

const premium = computed(() => progress.value?.premium)
const capLimit = computed(() => progress.value?.cap.limit ?? DEFAULT_FREE_DAILY_CAP)
const canBuy = purchasesAvailable()
const PERIOD: Record<string, string> = { P1W: 'pro Woche', P1M: 'pro Monat', P3M: 'alle 3 Monate', P6M: 'alle 6 Monate', P1Y: 'pro Jahr' }

onMounted(async () => {
  try {
    await refresh()
    if (canBuy && me.value && !premium.value?.active) {
      packages.value = await loadPackages(me.value.id)
      // Yearly first when offered: it is the better deal for daily learners
      selected.value = packages.value.find((p) => p.packageType === 'ANNUAL') ?? packages.value[0] ?? null
    }
  } catch (e) {
    console.warn('premium load failed', e)
    error.value = 'Angebote konnten nicht geladen werden.'
  }
})

/** Spec §2: account prompt before purchase, so the subscription can be restored on any device */
function withAccount(action: () => Promise<void>): void {
  if (me.value && !me.value.isAnonymous) {
    void action()
    return
  }
  afterSignIn = action
  accountOpen.value = true
}

async function settle(message: string): Promise<void> {
  await api.refreshSubscription().catch((e: unknown) => console.warn('subscription refresh failed (webhook will follow)', e))
  await refresh()
  if (progress.value?.premium.active) {
    Notify.create({ message, color: 'positive', position: 'top' })
    await router.replace('/feed')
  }
}

function purchase(): void {
  const pkg = selected.value
  if (!pkg) return
  withAccount(async () => {
    busy.value = true
    error.value = ''
    try {
      if (await buy(me.value!.id, pkg)) await settle('Willkommen bei Premium! ✨')
    } catch (e) {
      console.warn('purchase failed', e)
      error.value = 'Kauf fehlgeschlagen. Es wurde nichts abgebucht.'
    } finally {
      busy.value = false
    }
  })
}

function restorePurchases(): void {
  withAccount(async () => {
    busy.value = true
    error.value = ''
    try {
      await restore(me.value!.id)
      await settle('Premium wiederhergestellt ✨')
      if (!progress.value?.premium.active) error.value = 'Kein aktives Abo gefunden.'
    } catch (e) {
      console.warn('restore failed', e)
      error.value = 'Wiederherstellen fehlgeschlagen.'
    } finally {
      busy.value = false
    }
  })
}

async function onSignedIn(): Promise<void> {
  const next = afterSignIn
  afterSignIn = null
  if (next) await next()
}
</script>

<template>
  <q-layout>
    <q-page-container>
      <q-page class="wz-premium column no-wrap">
        <div class="row items-center q-mb-md">
          <q-btn flat round dense color="white" :icon="pIcon('back')" aria-label="Zurück" @click="router.back()" />
        </div>
        <div style="font-size: 56px">✨</div>
        <div class="wz-title q-mt-sm">wizzn Premium</div>

        <template v-if="premium?.active">
          <div class="q-mt-md" style="color: var(--wz-muted)">
            Du bist Premium{{ premium.until ? ` bis ${new Date(premium.until).toLocaleDateString('de-DE')}` : '' }}. Danke! 💜
          </div>
          <div class="q-mt-sm" style="color: var(--wz-muted)">Kündigen oder ändern kannst du dein Abo in den Einstellungen deines App Stores.</div>
        </template>

        <template v-else>
          <div class="q-mt-sm q-mb-lg" style="color: var(--wz-muted)">Lerne so viel du willst – ohne Tageslimit.</div>
          <ul class="wz-perks q-mb-lg">
            <li><q-icon :name="pIcon('check_circle')" /> Unbegrenzt Einheiten statt {{ capLimit }} pro Tag</li>
            <li><q-icon :name="pIcon('check_circle')" /> 2 Streak-Freezes pro Monat – automatisch eingesetzt</li>
            <li><q-icon :name="pIcon('check_circle')" /> Audio offline hören <span class="wz-soon">bald</span></li>
          </ul>

          <template v-if="canBuy">
            <div class="column q-gutter-sm q-mb-lg">
              <button v-for="p in packages" :key="p.identifier" type="button" class="wz-pkg row items-center" :class="{ on: selected?.identifier === p.identifier }" @click="selected = p">
                <div class="col text-left">
                  <div class="text-weight-bold">{{ p.product.title }}</div>
                  <div style="color: var(--wz-muted)">{{ p.product.priceString }} {{ PERIOD[p.product.subscriptionPeriod ?? ''] ?? '' }}</div>
                </div>
                <q-icon v-if="selected?.identifier === p.identifier" :name="pIcon('check_circle')" size="24px" />
              </button>
              <div v-if="!packages.length && !error" class="text-center"><q-spinner-dots size="32px" color="white" /></div>
            </div>
          </template>
          <div v-else class="wz-glass q-pa-md q-mb-lg">Premium kannst du in der iOS- oder Android-App abschließen.</div>

          <q-space />
          <div v-if="error" class="text-negative q-mb-sm">{{ error }}</div>
          <q-btn v-if="canBuy" unelevated rounded no-caps size="lg" class="wz-cta full-width" :loading="busy" :disable="!selected" label="Premium starten" @click="purchase" />
          <q-btn v-if="canBuy" flat no-caps color="white" class="q-mt-sm" label="Käufe wiederherstellen" :disable="busy" @click="restorePurchases" />
          <div class="wz-legal q-mt-sm">Das Abo verlängert sich automatisch und ist jederzeit in den Store-Einstellungen kündbar.</div>
        </template>

        <AccountSheet v-model="accountOpen" reason="purchase" @signed-in="onSignedIn" />
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<style scoped lang="scss">
.wz-premium { padding: calc(16px + var(--wz-safe-top)) 20px calc(24px + var(--wz-safe-bottom)); min-height: 100dvh; background: radial-gradient(120% 60% at 50% 0%, rgba(108, 75, 244, 0.45), transparent 70%), var(--wz-bg); }
.wz-perks { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px; font-weight: 700; font-size: 16px; }
.wz-perks li { display: flex; align-items: center; gap: 10px; }
.wz-perks .q-icon { color: var(--wz-coral); font-size: 22px; }
.wz-soon { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; padding: 2px 8px; border-radius: 999px; background: rgba(255, 255, 255, 0.15); }
.wz-pkg { border: 2px solid rgba(255, 255, 255, 0.2); border-radius: 18px; padding: 14px 16px; background: rgba(255, 255, 255, 0.06); color: #fff; font: inherit; }
.wz-pkg.on { border-color: var(--wz-coral); background: rgba(255, 138, 101, 0.12); }
.wz-cta { background: var(--wz-coral); color: var(--wz-bg); font-weight: 900; }
.wz-legal { font-size: 12px; text-align: center; color: var(--wz-muted); }
</style>
