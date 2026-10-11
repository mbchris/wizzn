<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { BADGES, BADGE_KEYS } from '@wizzn/shared'
import { signOut } from 'src/api'
import AccountSheet from 'components/AccountSheet.vue'
import DopamineShield from 'components/DopamineShield.vue'
import WeekSlots from 'components/WeekSlots.vue'
import { useProgress } from 'src/composables/useProgress'
import { usePlatform } from 'src/composables/usePlatform'
import { useVault } from 'src/composables/useVault'
import { shareText } from 'src/utils/share'

/** Tab 3 "Progress & Streaks": weekly sprint HUD, badge cabinet, account (LAYOUT.md §1, §3) */
const router = useRouter()
const { pIcon } = usePlatform()
const { progress, me, refresh } = useProgress()
const { saved } = useVault()
const error = ref('')
const accountOpen = ref(false)
const signingOut = ref(false)

onMounted(async () => {
  try {
    await refresh()
  } catch (e) {
    console.warn('progress load failed', e)
    error.value = 'Fortschritt konnte nicht geladen werden.'
  }
})

const earned = computed(() => new Set(progress.value?.badges.map((b) => b.key) ?? []))
const levelPct = computed(() => {
  const l = progress.value?.level
  return l ? (l.totalXp - l.levelStartXp) / (l.nextLevelXp - l.levelStartXp) : 0
})
const week = computed(() => progress.value?.week ?? { done: 0, goal: 5, start: '' })
const weekPct = computed(() => Math.min(100, Math.round((week.value.done / week.value.goal) * 100)))
const remaining = computed(() => Math.max(0, week.value.goal - week.value.done))
const streakDays = computed(() => progress.value?.streak.current ?? 0)
const streakHint = computed(() => {
  const s = progress.value?.streak
  if (!s) return ''
  if (s.doneToday) return 'Heute erledigt – stark!'
  if (s.atRisk) return 'Schließ heute eine Einheit ab, damit dein Streak weiterläuft.'
  return 'Starte heute einen neuen Streak.'
})

function shareWeek(): void {
  void shareText('wizzn', `🛡️🔥 Wochenziel geschafft: ${week.value.done}/${week.value.goal} Wissenseinheiten auf wizzn – Brainrot gegen echtes Wissen getauscht.`)
}

async function logout(): Promise<void> {
  signingOut.value = true
  try {
    await signOut()
    await refresh()
  } finally {
    signingOut.value = false
  }
}
</script>

<template>
  <div class="wz-tab-page">
    <div v-if="error" class="wz-glass q-pa-md">
      {{ error }}
      <q-btn flat no-caps color="white" :icon="pIcon('refresh')" label="Nochmal" @click="refresh" />
    </div>
    <div v-else-if="!progress" class="flex flex-center q-pa-xl"><q-spinner-dots size="48px" color="white" /></div>

    <template v-else>
      <header class="wz-sprint-head">
        <h1>Wochen-Sprint</h1>
        <div class="wz-streak-line">Streak: <b>{{ streakDays }} {{ streakDays === 1 ? 'Tag' : 'Tage' }}</b> 🔥</div>
      </header>

      <q-btn unelevated rounded no-caps class="wz-glass full-width q-mt-sm" color="white" text-color="white" :icon="pIcon('saved_grid')" label="Mein Gehirn – gespeicherte Wissenshappen" @click="router.push('/saved')" />

      <DopamineShield :done="week.done" :goal="week.goal" :size="190" class="q-my-md" />

      <section class="wz-hud">
        <WeekSlots :done="week.done" :goal="week.goal" />
        <div class="wz-hud-line">Fortschritt: {{ Math.min(week.done, week.goal) }} von {{ week.goal }} ({{ weekPct }}%)</div>
        <div class="wz-hud-bar"><div :style="{ width: `${weekPct}%` }" /></div>
        <p v-if="remaining > 0" class="wz-hud-msg">
          „Noch {{ remaining }} {{ remaining === 1 ? 'Einheit' : 'Einheiten' }} bis zu deinem Dopamin-Schild!“
        </p>
        <template v-else>
          <p class="wz-hud-msg">Du hast diese Woche {{ week.done }} Einheiten Brainrot gegen echtes Wissen getauscht!</p>
          <q-btn unelevated rounded no-caps class="wz-claim full-width" @click="shareWeek">
            <span class="row no-wrap items-center">Belohnung teilen<q-icon :name="pIcon('share')" size="18px" class="q-ml-sm" /></span>
          </q-btn>
        </template>
        <div class="wz-small q-mt-sm">{{ streakHint }} · Woche läuft Mo–So</div>
      </section>

      <div class="wz-stats">
        <section class="wz-glass q-pa-md">
          <div class="wz-small">Level</div>
          <div class="wz-big">{{ progress.level.level }}</div>
          <q-linear-progress :value="levelPct" rounded size="8px" color="cyan-4" track-color="grey-9" class="q-mt-sm" />
          <div class="wz-small q-mt-xs">{{ progress.level.totalXp }} / {{ progress.level.nextLevelXp }} XP</div>
        </section>
        <section class="wz-glass q-pa-md">
          <div class="wz-small">Rekord-Streak</div>
          <div class="wz-big">{{ progress.streak.longest }}</div>
          <div class="wz-small q-mt-sm">{{ progress.stats.totalUnits }} Einheiten gesamt</div>
          <div v-if="progress.premium.active" class="wz-small">🧊 {{ progress.streak.freezesLeft }} Freezes</div>
        </section>
      </div>

      <section class="wz-glass q-pa-md q-mb-md">
        <div class="wz-section-title">Abzeichen-Vitrine</div>
        <div class="wz-badges">
          <div v-for="key in BADGE_KEYS" :key="key" class="wz-badge" :class="{ locked: !earned.has(key) }">
            <div class="wz-badge-icon">{{ BADGES[key].emoji }}</div>
            <div class="text-weight-bold" style="font-size: 13px">{{ BADGES[key].nameDe }}</div>
            <div class="wz-small">{{ BADGES[key].descriptionDe }}</div>
          </div>
        </div>
      </section>

      <section class="wz-glass wz-row q-mb-md">
        <div class="col">
          <div class="text-weight-bold">🧠 Im Gehirn gespeichert</div>
          <div class="wz-small">{{ saved.size }} {{ saved.size === 1 ? 'Einheit' : 'Einheiten' }} · Doppeltippen im Stream speichert</div>
        </div>
      </section>

      <section class="wz-glass wz-row q-mb-md">
        <div class="col">
          <div class="text-weight-bold">Premium</div>
          <div class="wz-small">
            {{ progress.premium.active ? `Aktiv${progress.premium.until ? ` bis ${new Date(progress.premium.until).toLocaleDateString('de-DE')}` : ''}` : `Heute ${progress.cap.done}/${progress.cap.limit} Einheiten` }}
          </div>
        </div>
        <q-btn unelevated rounded no-caps color="white" text-color="dark" :label="progress.premium.active ? 'Verwalten' : 'Upgrade ✨'" @click="router.push('/premium')" />
      </section>

      <section class="wz-glass wz-row q-mb-md">
        <div class="col">
          <div class="text-weight-bold">Konto</div>
          <div class="wz-small">{{ me?.isAnonymous ? 'Gast – Fortschritt nur auf diesem Gerät' : me?.email }}</div>
        </div>
        <q-btn v-if="me?.isAnonymous" unelevated rounded no-caps color="white" text-color="dark" label="Verbinden" @click="accountOpen = true" />
        <q-btn v-else flat rounded no-caps color="white" label="Abmelden" :loading="signingOut" @click="logout" />
      </section>

      <q-btn flat rounded no-caps color="white" class="full-width" :icon="pIcon('settings')" label="Interessen ändern" @click="router.push('/onboarding')" />
    </template>

    <AccountSheet v-model="accountOpen" reason="profile" />
  </div>
</template>

<style scoped lang="scss">
.wz-sprint-head { text-align: center; }
.wz-sprint-head h1 { margin: 0; font-family: var(--wz-font-display); font-size: 28px; line-height: 1.1; font-weight: 900; letter-spacing: 0.04em; text-transform: uppercase; }
.wz-streak-line { margin-top: 4px; color: var(--wz-muted); font-size: 16px; }
.wz-streak-line b { color: #ffb347; }

.wz-hud { text-align: center; padding: 18px 16px; margin-bottom: 14px; border-radius: 24px; background: var(--wz-surface); border: 1px solid var(--wz-faint); }
.wz-hud-line { margin-top: 14px; font-weight: 700; font-size: 15px; }
.wz-hud-bar { margin-top: 8px; height: 10px; border-radius: 5px; background: rgba(255, 255, 255, 0.08); overflow: hidden; }
.wz-hud-bar div { height: 100%; border-radius: 5px; background: linear-gradient(90deg, #00ff87, #60efff, #c86dd7); box-shadow: 0 0 12px rgba(96, 239, 255, 0.6); transition: width 0.6s cubic-bezier(0.3, 1.3, 0.5, 1); }
.wz-hud-msg { margin: 12px 0 0; font-size: 15px; color: rgba(255, 255, 255, 0.9); }
.wz-claim { margin-top: 12px; background: linear-gradient(90deg, #ff5f6d, #e94057 40%, #a35bff); color: #fff; font-weight: 800; box-shadow: 0 0 20px rgba(233, 64, 87, 0.4); }

.wz-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
.wz-big { font-family: var(--wz-font-display); font-weight: 900; font-size: 40px; line-height: 1.05; }
.wz-small { font-size: 13px; color: var(--wz-muted); }
.wz-section-title { font-weight: 800; margin-bottom: 12px; }
.wz-row { display: flex; align-items: center; gap: 12px; padding: 16px; }
.wz-badges { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px 8px; }
.wz-badge { display: flex; flex-direction: column; align-items: center; text-align: center; }
.wz-badge-icon { font-size: 30px; width: 58px; height: 58px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 4px; background: radial-gradient(circle at 30% 25%, rgba(255, 200, 120, 0.35), rgba(255, 255, 255, 0.06)); border: 1.5px solid rgba(255, 190, 110, 0.55); box-shadow: 0 0 12px rgba(255, 150, 60, 0.25); }
.wz-badge.locked { opacity: 0.35; }
.wz-badge.locked .wz-badge-icon { filter: grayscale(1); border-color: var(--wz-line); box-shadow: none; background: rgba(255, 255, 255, 0.06); }
</style>
