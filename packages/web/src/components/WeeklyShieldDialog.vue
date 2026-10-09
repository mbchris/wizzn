<script setup lang="ts">
import { computed } from 'vue'
import { WEEKLY_GOAL } from '@wizzn/shared'
import { usePlatform } from 'src/composables/usePlatform'
import { useProgress } from 'src/composables/useProgress'
import { shareText } from 'src/utils/share'
import DopamineShield from 'components/DopamineShield.vue'
import WeekSlots from 'components/WeekSlots.vue'

const open = defineModel<boolean>({ required: true })
const { isIos, pIcon } = usePlatform()
const { progress } = useProgress()
const done = computed(() => progress.value?.week.done ?? WEEKLY_GOAL)
const goal = computed(() => progress.value?.week.goal ?? WEEKLY_GOAL)

async function claim(): Promise<void> {
  await shareText('wizzn', `🛡️🔥 Wochenziel geschafft: ${done.value}/${goal.value} Wissenseinheiten auf wizzn – Brainrot gegen echtes Wissen getauscht.`)
  open.value = false
}
</script>

<template>
  <q-dialog v-model="open" :position="isIos ? 'bottom' : 'standard'" transition-show="scale">
    <div class="wz-shield-sheet">
      <div class="wz-kicker">Wochen-Streak freigeschaltet</div>
      <DopamineShield :done="done" :goal="goal" :size="200" />
      <WeekSlots :done="done" :goal="goal" />
      <p>Du hast diese Woche {{ done }} Einheiten Brainrot gegen echtes Wissen getauscht.</p>
      <q-btn unelevated rounded no-caps class="wz-claim full-width" @click="claim">
        <span class="row no-wrap items-center">Belohnung holen &amp; teilen<q-icon :name="pIcon('share')" size="20px" class="q-ml-sm" /></span>
      </q-btn>
      <q-btn flat rounded no-caps color="white" label="Weiter lernen" @click="open = false" />
    </div>
  </q-dialog>
</template>

<style scoped lang="scss">
.wz-shield-sheet { width: min(420px, 100vw); display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 28px 20px calc(20px + var(--wz-safe-bottom)); background: radial-gradient(100% 60% at 50% 20%, rgba(255, 110, 30, 0.22), transparent 70%), #121419; border-radius: 28px; color: #fff; text-align: center; }
.wz-kicker { font-weight: 900; font-size: 18px; letter-spacing: 0.08em; text-transform: uppercase; }
p { margin: 0; color: rgba(255, 255, 255, 0.86); font-size: 16px; }
/* 52px: LAYOUT.md hit targets */
.wz-claim { min-height: 52px; font-size: 16px; background: linear-gradient(90deg, #ff5f6d, #e94057 40%, #a35bff); color: #fff; font-weight: 800; box-shadow: 0 0 24px rgba(233, 64, 87, 0.45); }
</style>
