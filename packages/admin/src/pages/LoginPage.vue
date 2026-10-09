<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authApi, errorMessage } from 'src/api'

const route = useRoute()
const router = useRouter()
const mode = ref<'signin' | 'signup'>('signin')
const email = ref('')
const password = ref('')
const name = ref('')
const error = ref('')
const loading = ref(false)

async function submit(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    if (mode.value === 'signup') await authApi.signUp(email.value, password.value, name.value || email.value)
    else await authApi.signIn(email.value, password.value)
    await router.push(typeof route.query.redirect === 'string' ? route.query.redirect : '/units')
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <q-layout>
    <q-page-container>
      <q-page class="flex flex-center">
        <q-card style="width: 360px">
          <q-card-section>
            <div class="text-h5 text-weight-bold text-primary">wizzn Redaktion</div>
            <div class="text-caption text-grey-7">Zugang nur für Adressen aus ADMIN_EMAILS</div>
          </q-card-section>
          <q-card-section>
            <q-btn-toggle v-model="mode" spread no-caps class="q-mb-md" :options="[{ label: 'Anmelden', value: 'signin' }, { label: 'Konto anlegen', value: 'signup' }]" />
            <q-form class="q-gutter-sm" @submit.prevent="submit">
              <q-input v-if="mode === 'signup'" v-model="name" label="Name" outlined dense />
              <q-input v-model="email" type="email" label="E-Mail" outlined dense autocomplete="username" />
              <q-input v-model="password" type="password" label="Passwort (min. 8 Zeichen)" outlined dense autocomplete="current-password" />
              <div v-if="error" class="text-negative text-caption">{{ error }}</div>
              <q-btn type="submit" color="primary" :label="mode === 'signup' ? 'Konto anlegen' : 'Anmelden'" :loading="loading" class="full-width" />
            </q-form>
          </q-card-section>
        </q-card>
      </q-page>
    </q-page-container>
  </q-layout>
</template>
